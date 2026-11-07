"""Envia o cookies.txt do YouTube para os segredos do GitHub e apaga o arquivo do PC.

Uso:
  1. Exporte os cookies (conta Google SECUNDÁRIA) como  cookies.txt  nesta pasta do projeto.
  2. python tools/salvar_cookies_youtube.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

REPO = "MatheusUnreal/iosmusic"
f = Path(__file__).resolve().parent.parent / "cookies.txt"
if not f.exists():
    sys.exit(f"Não achei {f}. Exporte os cookies com esse nome nessa pasta.")
data = f.read_text("utf-8", errors="ignore")
if "youtube.com" not in data:
    sys.exit("Esse arquivo não tem cookies do youtube.com. Abra o YouTube logado e exporte de novo.")

gh = shutil.which("gh") or r"C:\Program Files\GitHub CLI\gh.exe"
r = subprocess.run([gh, "secret", "set", "YT_COOKIES", "--repo", REPO], input=data, text=True,
                   capture_output=True)
if r.returncode != 0:
    sys.exit("Falhou: " + (r.stderr or r.stdout))
f.unlink()
print("Cookies salvos no GitHub (segredo YT_COOKIES) e cookies.txt apagado do PC. Pronto!")
