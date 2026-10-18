"""
Self-update for ARIA from a GitHub repository.

The repo holds the app files (server.py etc. at the top level, or inside one
folder). ARIA compares the VERSION file in the repo with its own and, if the repo
is newer, downloads the repo zip and copies the new app files over the old ones.
Your own files are never touched: config.json, macros.json, cache/, backups/,
browser-profile/, your voice clips and your scdata game files.

Public repos need nothing else. A private repo needs a GitHub token in
config.json ("update_token").
"""
import io
import json
import os
import shutil
import urllib.request
import time
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
KEEP = {"config.json", "macros.json", "aria.log", "cache", "backups", "browser-profile", "__pycache__"}


def current_version():
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "0"


def _vt(v):
    out = []
    for p in str(v).strip().lstrip("vV").split("."):
        num = "".join(ch for ch in p if ch.isdigit())
        out.append(int(num) if num else 0)
    return tuple(out)


def settings():
    """(repo, branch, token) from config.json, falling back to update.json shipped with the app."""
    repo, branch, token = "", "main", ""
    for name in ("update.json", "config.json"):
        try:
            with open(os.path.join(ROOT, name), encoding="utf-8") as f:
                j = json.load(f)
            repo = (j.get("update_repo") or j.get("repo") or repo).strip()
            branch = (j.get("update_branch") or j.get("branch") or branch).strip()
            token = (j.get("update_token") or token).strip()
        except (OSError, ValueError):
            pass
    return repo.strip("/").replace("https://github.com/", ""), branch or "main", token


def _get(url, token="", timeout=8):
    h = {"User-Agent": "ARIA-updater"}
    if token:
        h["Authorization"] = "token " + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read()


def check():
    """-> {current, latest, available, repo, error}"""
    repo, branch, token = settings()
    cur = current_version()
    if not repo:
        return {"current": cur, "latest": None, "available": False, "repo": "", "error": "No update repo set."}
    try:
        if token:  # private repo: go through the API
            latest = json.loads(_get(f"https://api.github.com/repos/{repo}/contents/VERSION?ref={branch}", token))
            import base64
            latest = base64.b64decode(latest["content"]).decode().strip()
        else:
            # The contents API is live the moment a push lands; raw.githubusercontent.com lags up to
            # 5 minutes behind its CDN cache. API first (60 checks/hour without a token), raw as fallback.
            try:
                import base64
                j = json.loads(_get(f"https://api.github.com/repos/{repo}/contents/VERSION?ref={branch}"))
                latest = base64.b64decode(j["content"]).decode().strip()
            except Exception:
                latest = _get(f"https://raw.githubusercontent.com/{repo}/{branch}/VERSION").decode().strip()
        return {"current": cur, "latest": latest, "available": _vt(latest) > _vt(cur), "repo": repo, "error": None}
    except Exception as e:
        return {"current": cur, "latest": None, "available": False, "repo": repo, "error": f"{type(e).__name__}: {e}"}


def apply(progress=None):
    """Download the repo and copy its app files over this install. Returns the new version."""
    repo, branch, token = settings()
    say = progress or (lambda m: None)
    say("Downloading…")
    url = (f"https://api.github.com/repos/{repo}/zipball/{branch}" if token
           else f"https://codeload.github.com/{repo}/zip/refs/heads/{branch}")
    data = _get(url, token, timeout=60)
    say("Installing…")
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    # the app lives in whichever folder of the zip holds server.py
    app_root = min((n[:-len("server.py")] for n in names if n.endswith("server.py")), key=len, default=None)
    if app_root is None:
        raise RuntimeError("That repo doesn't contain ARIA (no server.py).")
    for n in names:
        if not n.startswith(app_root) or n.endswith("/"):
            continue
        rel = n[len(app_root):]
        parts = rel.split("/")
        if not rel or parts[0] in KEEP:
            continue
        # your voice clips and extracted game files stay; only the READMEs in those folders update
        if parts[:2] == ["web", "voice"] and not rel.endswith("README.txt"):
            continue
        if parts[0] == "scdata" and not rel.endswith("README.txt"):
            continue
        dest = os.path.join(ROOT, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".new"
        with z.open(n) as src, open(tmp, "wb") as out:
            shutil.copyfileobj(src, out)
        os.replace(tmp, dest)
    return current_version()
