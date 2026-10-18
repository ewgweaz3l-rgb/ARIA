#!/usr/bin/env python3
"""ARIA squad server — the leaderboard + game lobby on its own, for a box that
just hosts (Thoth). No browser, no game data, no Windows bits. Python 3.9+, stdlib.

    python squad_server.py                 # port 8777, key made on first run
    python squad_server.py --name Thoth --port 8777 --key mykey

Friends put  http://<this box>:8777  and the key into ARIA → Settings → Squad.
State lives next to this file: squad_config.json, scores.json, lobbies.json.
Run it as a service: Windows → Task Scheduler "At startup", pythonw squad_server.py;
Linux → the systemd unit printed by --systemd.
"""
import argparse
import json
import os
import secrets
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import squad as squadmod  # noqa: E402

# Cloud hosts (Railway, Fly, Render…) configure through the environment:
#   PORT        port to listen on (the host sets it)
#   DATA_DIR    where boards, reports and lobbies live — point it at a persistent volume (e.g. /data)
#   SQUAD_KEY   the key friends use (overrides squad_config.json)
#   SQUAD_NAME  name shown on the boards
DATA = os.environ.get("DATA_DIR") or os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") or ROOT
os.makedirs(DATA, exist_ok=True)
PERSIST = DATA != ROOT or not os.environ.get("RAILWAY_ENVIRONMENT")  # on Railway without a volume, data dies with each deploy
CFG = os.path.join(DATA, "squad_config.json")
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"}
STARTED = time.time()


def load_cfg():
    try:
        with open(CFG, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_cfg(c):
    with open(CFG, "w", encoding="utf-8") as f:
        json.dump(c, f, indent=1)


def version():
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return "?"


cfg = load_cfg()
if os.environ.get("SQUAD_KEY"):
    cfg["key"] = os.environ["SQUAD_KEY"]
if os.environ.get("SQUAD_NAME"):
    cfg["name"] = os.environ["SQUAD_NAME"]
SQ = squadmod.Squad(DATA, lambda: cfg.get("key", ""), lambda: cfg.get("name", "SQUAD"))

PAGE = """<!doctype html><meta charset="utf-8"><title>ARIA squad · {name}</title>
<style>body{{font:14px/1.5 system-ui,sans-serif;background:#0b0f0c;color:#bfe3c6;margin:0;padding:28px}}h1{{font-weight:600;color:#7cf59a;margin:0 0 4px}}
.sub{{color:#6f8f76;margin-bottom:22px}}.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}}.c{{border:1px solid #1f3a26;border-radius:10px;padding:12px 14px;background:#0f1711}}
.c h2{{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7cf59a;margin:0 0 8px}}table{{width:100%;border-collapse:collapse}}td{{padding:2px 0;font-variant-numeric:tabular-nums}}td:last-child{{text-align:right}}
.lob{{margin-top:22px}}.k{{color:#6f8f76}}</style>
<h1>{name}</h1><div class="sub">ARIA squad server {ver} · up {up} · {n} boards · {nl} open lobbies · {nr} pilot reports{warn}</div>
<div class="g">{boards}</div><div class="lob"><h2 style="color:#7cf59a;font-size:13px;letter-spacing:.08em">LOBBIES</h2>{lobbies}</div>
"""


def page():
    sc = SQ.load_scores()
    boards = "".join(
        f'<div class="c"><h2>{g}</h2><table>' + "".join(f"<tr><td>{i + 1}. {e['name']}</td><td>{e['score']:,}</td></tr>" for i, e in enumerate(l[:10])) + "</table></div>"
        for g, l in sorted(sc.items())) or '<div class="k">No scores yet.</div>'
    lobs = SQ.list_lobbies()
    lob_html = "".join(f"<div>{L['game'].upper()} · {L['host']} · {len(L['players'])}/{L['max']} · {L['state']} · <span class='k'>{L['id']}</span></div>" for L in lobs) or '<div class="k">None open.</div>'
    up = int(time.time() - STARTED)
    warn = "" if PERSIST else \
        " · <b style='color:#f2a83b'>no DATA_DIR volume — scores reset on every deploy</b>"
    return PAGE.format(name=cfg.get("name", "SQUAD"), ver=version(), up=f"{up // 3600}h {(up % 3600) // 60}m", n=len(sc), nl=len(lobs),
                       nr=len(SQ.load_reports()), warn=warn, boards=boards, lobbies=lob_html)


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):  # quiet unless asked
        if cfg.get("verbose"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    def out(self, code, obj, html=False):
        body = obj.encode() if html else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8" if html else "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        path, q = squadmod.parse_query(self.path)
        if path in ("/", "/index.html"):
            return self.out(200, page(), html=True)
        if path == "/api/status":  # enough for ARIA's Settings → Test and the boot screen
            return self.out(200, {"ok": True, "squad_server": True, "persistent": PERSIST, "squad_host": True, "name": cfg.get("name", "SQUAD"), "version": version(), "up": int(time.time() - STARTED)})
        r = SQ.handle("GET", path, q, {})
        if r:
            return self.out(*r)
        self.out(404, {"error": "not found"})

    def do_POST(self):
        path, _ = squadmod.parse_query(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(n) if n else b"{}")
        except Exception:
            payload = {}
        r = SQ.handle("POST", path, {}, payload if isinstance(payload, dict) else {})
        if r:
            return self.out(*r)
        self.out(404, {"error": "not found"})


SYSTEMD = """[Unit]
Description=ARIA squad server
After=network.target

[Service]
ExecStart={py} {here}/squad_server.py
WorkingDirectory={here}
Restart=always
User={user}

[Install]
WantedBy=multi-user.target
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description="ARIA squad leaderboard + lobby server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT") or cfg.get("port", 8777)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--key", help="squad key friends must use (saved; made for you the first time)")
    ap.add_argument("--name", help="name shown on boards")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--systemd", action="store_true", help="print a systemd unit and exit")
    a = ap.parse_args(argv)
    if a.systemd:
        print(SYSTEMD.format(py=sys.executable, here=ROOT, user=os.environ.get("USER", "aria")))
        return
    changed = False
    if a.key:
        cfg["key"] = a.key; changed = True
    if a.name:
        cfg["name"] = a.name; changed = True
    if not cfg.get("key"):
        cfg["key"] = secrets.token_hex(4); changed = True
    if not cfg.get("name"):
        cfg["name"] = os.environ.get("COMPUTERNAME") or (os.uname().nodename if hasattr(os, "uname") else "SQUAD"); changed = True
    cfg["port"] = a.port; cfg["verbose"] = a.verbose
    if changed or not os.path.exists(CFG):
        save_cfg(cfg)
    srv = ThreadingHTTPServer((a.host, a.port), H)
    srv.daemon_threads = True
    print(f"ARIA squad server '{cfg['name']}' on port {a.port}")
    print(f"  squad key : {cfg['key']}")
    print(f"  friends use: http://<this machine's address>:{a.port}  (status page at the same address)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
