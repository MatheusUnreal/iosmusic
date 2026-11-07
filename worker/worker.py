"""IOSMusic – baixador. Roda no GitHub Actions.

Pega os links pendentes na tabela `jobs` do Supabase, baixa o áudio com yt-dlp,
envia para o Storage do Supabase e registra a música na tabela `tracks`.
"""
import os
import shutil
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yt_dlp

SB = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
BUCKET = "music"
MAX_PLAYLIST = int(os.getenv("MAX_PLAYLIST_ITEMS", "100"))
MAX_BYTES = 49 * 1024 * 1024  # limite do plano grátis do Supabase: 50 MB por arquivo
# Chave antiga (service_role, um JWT "eyJ...") vai também no Authorization;
# a nova (sb_secret_...) vai só no apikey.
H = {"apikey": KEY, **({"Authorization": f"Bearer {KEY}"} if KEY.startswith("eyJ") else {})}

COOKIE_FILE = None
if os.getenv("YT_COOKIES", "").strip():
    COOKIE_FILE = Path(tempfile.gettempdir()) / "yt_cookies.txt"
    COOKIE_FILE.write_text(os.environ["YT_COOKIES"], "utf-8")


# ------------------------------------------------------------------ Supabase
def rest(method, path, **kw):
    r = requests.request(
        method, f"{SB}/rest/v1/{path}",
        headers={**H, "Content-Type": "application/json", "Prefer": "return=representation"},
        timeout=60, **kw,
    )
    if not r.ok:
        raise RuntimeError(f"Supabase {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


def upload(path, file, ctype):
    with open(file, "rb") as f:
        r = requests.post(
            f"{SB}/storage/v1/object/{BUCKET}/{path}",
            headers={**H, "Content-Type": ctype, "x-upsert": "true", "cache-control": "31536000"},
            data=f, timeout=600,
        )
    if not r.ok:
        raise RuntimeError(f"Upload falhou ({r.status_code}): {r.text[:300]}")


def update_job(jid, **fields):
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    rest("PATCH", f"jobs?id=eq.{jid}", json=fields)


def claim_next():
    """Pega o próximo job da fila (só um runner por vez, garantido pelo workflow)."""
    rows = rest("GET", "jobs?status=eq.queued&order=created_at.asc&limit=1")
    if not rows:
        return None
    job = rows[0]
    got = rest("PATCH", f"jobs?id=eq.{job['id']}&status=eq.queued",
               json={"status": "downloading", "progress": 0,
                     "updated_at": datetime.now(timezone.utc).isoformat()})
    return got[0] if got else claim_next()


def requeue_stuck():
    """Jobs que ficaram travados (runner caiu) voltam para a fila."""
    limit = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    rest("PATCH", f"jobs?status=in.(downloading,converting,uploading)&updated_at=lt.{limit}",
         json={"status": "queued"})


def add_to_playlist(pid, tid):
    if not pid:
        return
    rows = rest("GET", f"playlists?id=eq.{pid}&select=track_ids")
    if rows and tid not in rows[0]["track_ids"]:
        rest("PATCH", f"playlists?id=eq.{pid}", json={"track_ids": rows[0]["track_ids"] + [tid]})


# ------------------------------------------------------------------ yt-dlp
def base_opts():
    o = {
        "quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True,
        "socket_timeout": 30, "retries": 3,
        "js_runtimes": {"deno": {}, "node": {}},
    }
    if COOKIE_FILE:
        o["cookiefile"] = str(COOKIE_FILE)
    return o


def clean_err(e):
    msg = str(e).replace("ERROR: ", "")
    if "Sign in to confirm" in msg or "not a bot" in msg:
        return "O YouTube bloqueou o GitHub (pediu login). Configure o segredo YT_COOKIES — veja o README."
    return msg[:400]


def is_single_video(url):
    return "watch?v=" in url or "youtu.be/" in url or "/shorts/" in url


def expand_playlist(job):
    """Se o link for uma playlist, cria um job para cada música. Retorna True se expandiu."""
    if is_single_video(job["url"]):
        return False
    opts = base_opts() | {"extract_flat": "in_playlist", "noplaylist": False, "playlistend": MAX_PLAYLIST}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(job["url"], download=False)
    if info.get("_type") != "playlist":
        return False
    rows = []
    for ent in (info.get("entries") or [])[:MAX_PLAYLIST]:
        u = ent.get("url") or ent.get("webpage_url")
        if not u:
            continue
        if not u.startswith("http") and ent.get("ie_key") == "Youtube":
            u = f"https://www.youtube.com/watch?v={u}"
        rows.append({"url": u, "title": ent.get("title"), "playlist_id": job.get("playlist_id")})
    if rows:
        rest("POST", "jobs", json=rows)
    update_job(job["id"], status="done", progress=100, title=info.get("title") or job["url"],
               note=f"{len(rows)} músicas adicionadas à fila")
    return True


def process(job):
    jid = job["id"]
    print(f"-> {job['url']}", flush=True)
    if expand_playlist(job):
        return

    tmp = Path(tempfile.mkdtemp(prefix="iosm_"))
    last = [0.0]

    def hook(d):
        if d["status"] == "downloading" and time.time() - last[0] > 3:
            last[0] = time.time()
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                try:
                    update_job(jid, progress=int(d.get("downloaded_bytes", 0) * 100 / total))
                except Exception:  # noqa: BLE001
                    pass
        elif d["status"] == "finished":
            update_job(jid, status="converting", progress=100)

    try:
        opts = base_opts() | {
            # m4a (AAC) toca nativamente no iPhone
            "format": "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best",
            "outtmpl": str(tmp / "audio.%(ext)s"),
            "writethumbnail": True,
            "progress_hooks": [hook],
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "160"},
                {"key": "FFmpegThumbnailsConvertor", "format": "jpg"},
            ],
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(job["url"], download=True)

        source_id = f'{info.get("extractor_key", "x")}:{info.get("id")}'
        found = rest("GET", f"tracks?source_id=eq.{requests.utils.quote(source_id, safe='')}&select=id,title")
        if found:
            add_to_playlist(job.get("playlist_id"), found[0]["id"])
            update_job(jid, status="done", title=found[0]["title"], track_id=found[0]["id"],
                       note="já estava na biblioteca")
            return

        audio = tmp / "audio.m4a"
        if not audio.exists():
            raise RuntimeError("Arquivo de áudio não foi gerado")
        if audio.stat().st_size > MAX_BYTES:
            raise RuntimeError("Arquivo maior que 50 MB (limite do Supabase grátis). Use um vídeo mais curto.")
        cover = next(tmp.glob("*.jpg"), None)

        update_job(jid, status="uploading")
        tid = str(uuid.uuid4())
        audio_path = f"audio/{tid}.m4a"
        upload(audio_path, audio, "audio/mp4")
        cover_path = None
        if cover:
            cover_path = f"covers/{tid}.jpg"
            upload(cover_path, cover, "image/jpeg")

        artist = (info.get("artist") or info.get("creator") or info.get("uploader")
                  or info.get("channel") or "").removesuffix(" - Topic")
        title = info.get("track") or info.get("title") or "Sem título"
        rest("POST", "tracks", json={
            "id": tid, "title": title, "artist": artist,
            "album": info.get("album") or "",
            "duration": int(info.get("duration") or 0),
            "source_url": info.get("webpage_url") or job["url"],
            "source_id": source_id,
            "audio_path": audio_path, "cover_path": cover_path,
            "size": audio.stat().st_size,
        })
        add_to_playlist(job.get("playlist_id"), tid)
        update_job(jid, status="done", title=title, track_id=tid, error=None)
        print(f"  OK {title}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"  ERRO {e}", flush=True)
        update_job(jid, status="error", error=clean_err(e))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    requeue_stuck()
    done = 0
    deadline = time.time() + 50 * 60  # o workflow tem limite de 60 min
    while time.time() < deadline:
        job = claim_next()
        if not job:
            break
        try:
            process(job)
        except Exception as e:  # noqa: BLE001
            update_job(job["id"], status="error", error=clean_err(e))
        done += 1
    print(f"Fim: {done} job(s) processado(s).")


if __name__ == "__main__":
    sys.exit(main())
