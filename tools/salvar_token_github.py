"""Guarda o token do GitHub no Supabase (para o app conseguir disparar os downloads).

Uso:  python tools/salvar_token_github.py
O token é digitado sem aparecer na tela e vai direto para o banco.
"""
import getpass
import subprocess
import sys

PROJECT_REF = "irsmpzbrrktxsjukrwrh"
REPO = "MatheusUnreal/iosmusic"

tok = getpass.getpass("Cole o token do GitHub (não aparece na tela) e aperte Enter: ").strip()
if not tok.startswith(("github_pat_", "ghp_")):
    sys.exit("Isso não parece um token do GitHub (deveria começar com github_pat_). Nada foi salvo.")
if "'" in tok:
    sys.exit("Token inválido. Nada foi salvo.")

sql = (
    "insert into private.config (key, value) values "
    f"('github_repo', '{REPO}'), ('github_token', '{tok}') "
    "on conflict (key) do update set value = excluded.value"
)
npx = "npx.cmd" if sys.platform == "win32" else "npx"
r = subprocess.run([npx, "-y", "supabase@latest", "db", "query", f"--remote={PROJECT_REF}", "--yes", sql],
                   capture_output=True, text=True)
if r.returncode != 0:
    sys.exit("Falhou ao salvar:\n" + (r.stderr or r.stdout)[-800:])
print("Token salvo no Supabase. Pronto!")
