#!/usr/bin/env python3
"""
ARIA local data server.

Runs on your own PC. Serves the ARIA page and proxies two public Star Citizen
data sources, caching every response on disk so the page keeps working when a
source is slow or down:

  UEX Corp API 2.0        trade prices, terminals, commodities, in-game ship prices
  Star Citizen Wiki API   ships (game-file stats), crafting blueprints, missions

Standard library only. Python 3.9+.

    python server.py               start and open the browser
    python server.py --no-browser  start only
    python server.py --port 9000   use another port
"""
import argparse
import hashlib
import subprocess
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import keys
import ptt as ptt_mod
import mfd as mfd_mod
import scbinds
import updater
import dcs
import vjoy as vjoy_mod
import winsys

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
CACHE = os.path.join(ROOT, "cache")
CONFIG = os.path.join(ROOT, "config.json")

UEX_HOSTS = ["https://api.uexcorp.uk/2.0", "https://api.uexcorp.space/2.0"]
WIKI = "https://api.star-citizen.wiki/api"
UA = "ARIA-local/1.0 (personal Star Citizen assistant)"

# Cache lifetimes in seconds; first matching substring wins.
TTL_RULES = [
    ("commodities_prices", 30 * 60),
    ("commodities_routes", 30 * 60),
    ("commodities_status", 6 * 3600),
    ("vehicles_purchases_prices", 6 * 3600),
    ("vehicles_rentals_prices", 6 * 3600),
    ("terminals", 12 * 3600),
    ("commodities", 12 * 3600),
    ("vehicles", 12 * 3600),
    ("blueprints", 24 * 3600),
    ("locations", 7 * 24 * 3600),
    ("", 12 * 3600),
]

MACROS = os.path.join(ROOT, "macros.json")
import squad as squadmod
SQUAD = squadmod.Squad(ROOT, lambda: load_config().get("squad_key") or "", lambda: AI_NAME())


def local_ips():
    import socket
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    try:  # the interface that reaches the internet
        s_ = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s_.connect(("8.8.8.8", 80)); ip = s_.getsockname()[0]; s_.close()
        if ip not in ips:
            ips.insert(0, ip)
    except Exception:
        pass
    return ips
# Starter profile. Bindings differ per player and per patch: check these against
# your own Star Citizen keybinds and edit them in the Voice Macros room.
DEFAULT_MACROS = [
    {"phrases": ["call atc", "hail station", "request landing", "request docking"], "keys": "lctrl+n", "reply": "Hailing station."},
    {"phrases": ["landing gear", "gear down", "gear up", "deploy gear"], "keys": "n", "reply": "Gear cycling."},
    {"phrases": ["flight ready", "power up", "systems on"], "keys": "r", "reply": "Bringing systems online."},
    {"phrases": ["lights", "toggle lights"], "keys": "l", "reply": "Lights."},
    {"phrases": ["vtol", "toggle vtol"], "keys": "k", "reply": "VTOL toggled."},
    {"phrases": ["open mobi", "mobiglas", "mobi glass"], "keys": "f1", "reply": ""},
    {"phrases": ["open star map", "starmap", "star map"], "keys": "f2", "reply": ""},
    {"phrases": ["exit seat", "get up"], "keys": "y:1.2", "reply": "Leaving the seat."},
]

os.makedirs(CACHE, exist_ok=True)
_locks = {}
_locks_guard = threading.Lock()


def load_config():
    try:
        with open(CONFIG, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg):
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def load_macros():
    try:
        with open(MACROS, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return DEFAULT_MACROS


def clean_macros(items):
    """Validate a macro list from the page. Returns (macros, errors)."""
    out, errors = [], []
    for i, m in enumerate(items if isinstance(items, list) else []):
        phrases = [str(p).strip().lower() for p in (m.get("phrases") or []) if str(p).strip()]
        spec = str(m.get("keys") or "").strip()
        if not phrases and not spec:
            continue
        if not phrases:
            errors.append(f"Macro {i + 1}: needs at least one phrase")
            continue
        try:
            keys.parse(spec)
        except ValueError as e:
            errors.append(f"“{phrases[0]}”: {e}")
            continue
        out.append({"phrases": phrases, "keys": spec, "reply": str(m.get("reply") or "").strip()})
    return out, errors


def ttl_for(key):
    for needle, ttl in TTL_RULES:
        if needle in key:
            return ttl
    return 3600


def lock_for(key):
    with _locks_guard:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]


def http_get(url, headers=None, timeout=45):
    h = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def cache_path(key):
    return os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest() + ".json")


def cached(key, fetcher, fresh=False):
    """Return (body_bytes, source, age_seconds). source: live | cache | stale."""
    path = cache_path(key)
    ttl = ttl_for(key)
    with lock_for(key):
        entry = None
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    entry = json.load(f)
            except Exception:
                entry = None
        now = time.time()
        if entry and not fresh and now - entry["fetched"] < ttl:
            return entry["body"].encode(), "cache", int(now - entry["fetched"])
        try:
            body = fetcher()
            text = body.decode("utf-8")
            json.loads(text)  # must be valid JSON before it is cached
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"key": key, "fetched": now, "body": text}, f)
            return body, "live", 0
        except Exception as e:
            if entry:
                sys.stderr.write(f"[aria] upstream failed, serving stale cache: {key} ({e})\n")
                return entry["body"].encode(), "stale", int(now - entry["fetched"])
            raise


def uex_fetch(resource, query):
    cfg = load_config()
    headers = {}
    token = (cfg.get("uex_token") or os.environ.get("UEX_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token
    last = None
    for host in UEX_HOSTS:
        url = f"{host}/{resource}" + (("?" + query) if query else "")
        try:
            body = http_get(url, headers)
            j = json.loads(body)
            status = j.get("status") if isinstance(j, dict) else None
            if status and status != "ok":
                raise RuntimeError(f"UEX status: {status}")
            return body
        except Exception as e:
            last = e
    raise last


def wiki_fetch(path, query):
    url = f"{WIKI}/{path}" + (("?" + query) if query else "")
    return http_get(url)


def wiki_fetch_all(path, query):
    """Walk every page of a paginated wiki list and merge into one response."""
    params = [(k, v) for k, v in urllib.parse.parse_qsl(query, keep_blank_values=True)
              if not k.startswith("page")]
    params.append(("page[size]", "200"))
    out, page, last_page = [], 1, None
    while True:
        q = urllib.parse.urlencode(params + [("page[number]", str(page))])
        j = json.loads(wiki_fetch(path, q))
        data = j.get("data") or []
        out.extend(data)
        meta = j.get("meta") or {}
        last_page = meta.get("last_page") or last_page
        nxt = (j.get("links") or {}).get("next")
        if not data or (last_page and page >= last_page) or (not last_page and not nxt):
            break
        page += 1
        if page > 60:  # safety stop
            break
        time.sleep(0.25)  # stay well inside the wiki's rate limits
    return json.dumps({"data": out, "meta": {"total": len(out)}}).encode()


GAME_STATE = {"t": 0, "running": False}
# Mining charts by @RedMonsterSC (CC BY-SA 4.0) — https://redmonstergaming.com/mining-cheat-sheets/
_RMG = "https://redmonstergaming.com/wp-content/uploads/2025/05/RedMonsterGaming_4-1-1_CheatSheets__"
REF_IMAGES = {"rmg-minerals": _RMG + "0005_MineralPropertiesLight.png", "rmg-rocktypes": _RMG + "0003_RockTypeMatrixLight.png",
              "rmg-detection": _RMG + "0001_DetectionDistancesLight.png"}


def launcher_icon(custom=None):
    """PNG of the launcher's own icon (Windows: extracted from the exe with .NET, cached in cache/)."""
    return exe_icon(find_launcher(custom))


def exe_icon(exe):
    """The icon Windows shows for an installed program, as PNG — taken from YOUR copy of it."""
    if not exe or not sys.platform.startswith("win"):
        return None
    out = os.path.join(CACHE, "launcher_icon_%s.png" % hashlib.sha1(exe.encode()).hexdigest()[:10])
    if not os.path.exists(out):
        ps = ("Add-Type -AssemblyName System.Drawing;"
              "$i=[System.Drawing.Icon]::ExtractAssociatedIcon($env:ARIA_EXE);"
              "$b=$i.ToBitmap(); $b.Save($env:ARIA_OUT,[System.Drawing.Imaging.ImageFormat]::Png)")
        try:
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=15, capture_output=True,
                           env={**os.environ, "ARIA_EXE": exe, "ARIA_OUT": out}, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:
            return None
    try:
        with open(out, "rb") as f:
            return f.read()
    except OSError:
        return None


def find_launcher(custom=None):
    """RSI Launcher.exe: the path you set, else the usual install places on every drive."""
    cands = []
    if custom:
        c = custom.strip().strip('"')
        cands += [c, os.path.join(c, "RSI Launcher.exe")]
    if sys.platform.startswith("win"):
        import string
        for d in [f"{x}:\\" for x in string.ascii_uppercase if os.path.exists(f"{x}:\\")]:
            for sub in (("Program Files", "Roberts Space Industries", "RSI Launcher"), ("Roberts Space Industries", "RSI Launcher"),
                        ("Program Files (x86)", "Roberts Space Industries", "RSI Launcher"), ("Games", "Roberts Space Industries", "RSI Launcher")):
                cands.append(os.path.join(d, *sub, "RSI Launcher.exe"))
        la = os.environ.get("LOCALAPPDATA")
        if la:
            cands.append(os.path.join(la, "Programs", "rsi-launcher", "RSI Launcher.exe"))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"}


def AI_NAME():
    return load_config().get("squad_name") or "ARIA"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            sys.stderr.write("[aria] " + (fmt % args) + "\n")

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, code, obj, extra=None):
        body = json.dumps(obj).encode() if not isinstance(obj, bytes) else obj
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, str(v))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if not u.path.startswith("/api/"):
            return super().do_GET()
        qs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
        fresh = any(k == "fresh" for k, _ in qs)
        query = urllib.parse.urlencode([(k, v) for k, v in qs if k != "fresh"])
        parts = u.path.split("/", 3)  # ['', 'api', kind, rest]
        kind = parts[2] if len(parts) > 2 else ""
        rest = parts[3] if len(parts) > 3 else ""
        try:
            if kind == "uex" and rest:
                key = f"uex:{rest}?{query}"
                body, src, age = cached(key, lambda: uex_fetch(rest, query), fresh)
            elif kind == "wiki" and rest:
                key = f"wiki:{rest}?{query}"
                body, src, age = cached(key, lambda: wiki_fetch(rest, query), fresh)
            elif kind == "wiki_all" and rest:
                key = f"wikiall:{rest}?{query}"
                body, src, age = cached(key, lambda: wiki_fetch_all(rest, query), fresh)
            elif kind == "status":
                cfg = load_config()
                files = [f for f in os.listdir(CACHE) if f.endswith(".json")]
                return self.send_json(200, {
                    "ok": True,
                    "uex_token": bool(cfg.get("uex_token") or os.environ.get("UEX_TOKEN")),
                    "cache_files": len(files),
                    "keys_live": keys.IS_WINDOWS,
                    "platform": sys.platform,
                    "version": updater.current_version(),
                    "update_repo": updater.settings()[0],
                    "squad_host": bool(cfg.get("squad_host")), "squad_key": cfg.get("squad_key", ""), "squad_url": cfg.get("squad_url", ""),
                    "ips": local_ips() if cfg.get("squad_host") else [], "port": self.server.server_address[1],
                    "launcher": find_launcher(cfg.get("launcher_path")), "launcher_path": cfg.get("launcher_path", ""),
                    "locate_open": cfg.get("locate_open", ""), "locate_send": cfg.get("locate_send", ""),
                })
            elif kind == "macros":
                return self.send_json(200, {"macros": load_macros(), "file": os.path.basename(MACROS)})
            elif kind == "refimg":  # community reference charts, fetched once and kept in cache/ (fixed list — no open proxy)
                name = rest.strip("/")
                url = REF_IMAGES.get(name)
                if not url:
                    return self.send_json(404, {"error": "unknown chart"})
                path = os.path.join(CACHE, "ref_" + name + ".png")
                if not os.path.exists(path):
                    try:
                        data = http_get(url, {"Accept": "image/png,image/*,*/*"}, timeout=30)
                        if not data.startswith(b"\x89PNG"):
                            raise ValueError("not a png")
                        with open(path, "wb") as f:
                            f.write(data)
                    except Exception as e:
                        return self.send_json(502, {"error": f"couldn't download the chart: {e}"})
                with open(path, "rb") as f:
                    png = f.read()
                self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(png)))
                self.send_header("Cache-Control", "max-age=604800"); self.end_headers(); self.wfile.write(png); return
            elif kind in ("launcher_icon", "gameicon"):  # the icon of YOUR installed RSI Launcher / DCS, pulled from the exe itself
                cfg_ = load_config()
                png = exe_icon(dcs.find_exe(cfg_.get("dcs_path"))) if (kind == "gameicon" and rest.strip("/") == "dcs") else launcher_icon(cfg_.get("launcher_path"))
                if not png:
                    return self.send_json(404, {"error": "no icon"})
                self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(png)))
                self.send_header("Cache-Control", "max-age=86400"); self.end_headers(); self.wfile.write(png); return
            elif kind == "dcs":
                cfg_ = load_config()
                if rest == "stream":  # server-sent events: live flight data
                    self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-store"); self.end_headers()
                    n = -1
                    try:
                        for _ in range(100000):
                            n, snap = dcs.FEED.wait(n, 5)
                            self.wfile.write(("data: " + json.dumps(snap) + "\n\n").encode()); self.wfile.flush()
                    except Exception:
                        pass
                    return
                return self.send_json(200, dcs.status(cfg_))
            elif kind == "game":  # is Star Citizen running? (cached a few seconds; tasklist is slow)
                now = time.time()
                if now - GAME_STATE["t"] > 8:
                    GAME_STATE["running"] = scbinds.game_running(); GAME_STATE["t"] = now
                return self.send_json(200, {"running": GAME_STATE["running"], "windows": sys.platform.startswith("win")})
            elif kind == "report":  # this PC's own job reports
                return self.send_json(200, {"reports": SQUAD.load_reports()})
            elif kind in ("scores", "lobby", "reports"):
                cfg = load_config()
                if not cfg.get("squad_host"):
                    return self.send_json(404, {"error": "This ARIA isn't hosting a squad board."}, CORS)
                r = SQUAD.handle("GET", u.path, dict(qs), {})
                if r:
                    return self.send_json(r[0], r[1], CORS)
                return self.send_json(404, {"error": "unknown"}, CORS)
            elif kind == "voicepack":
                vdir = os.path.join(WEB, "voice")
                files = sorted(f for f in os.listdir(vdir) if f.lower().endswith((".wav", ".mp3", ".ogg", ".m4a", ".flac"))) if os.path.isdir(vdir) else []
                return self.send_json(200, {"files": files})
            elif kind == "binds":
                cat = scbinds.catalog(load_config())
                cat["vjoy"] = VJ.status()
                return self.send_json(200, cat)
            elif kind == "vjoy":
                return self.send_json(200, VJ.status())
            elif kind == "mfd" and rest == "stream":
                return self.mfd_stream()
            elif kind == "mfd":
                return self.send_json(200, MFD.state())
            elif kind == "displays":
                cfg = load_config()
                return self.send_json(200, {"displays": winsys.monitors(), "current": cfg.get("display"), "fullscreen": cfg.get("fullscreen", False)})
            elif kind == "ptt" and rest == "stream":
                return self.ptt_stream()
            elif kind == "ptt":
                return self.send_json(200, PTT.state())
            else:
                return self.send_json(404, {"error": "unknown endpoint"})
            return self.send_json(200, body, {"X-Aria-Source": src, "X-Aria-Age": age})
        except Exception as e:
            return self.send_json(502, {"error": f"{type(e).__name__}: {e}"})

    def mfd_stream(self):
        """Server-sent events: every Cougar MFD button press/release."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        last = MFD.seq
        try:
            self.wfile.write(f"event: state\ndata: {json.dumps(MFD.state())}\n\n".encode()); self.wfile.flush()
            while True:
                was_learning = MFD.learning
                evs, last = MFD.wait(last, timeout=15)
                for e in evs:
                    self.wfile.write(f"data: {json.dumps(e)}\n\n".encode())
                if was_learning != MFD.learning or not evs:
                    self.wfile.write(f"event: state\ndata: {json.dumps(MFD.state())}\n\n".encode())
                self.wfile.flush()
                if MFD.learning:
                    import time as _t; _t.sleep(0.2)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def ptt_stream(self):
        """Server-sent events: one message per push-to-talk change. Event-driven,
        so it keeps working when the browser throttles timers in a background window."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        st = PTT.state()
        try:
            while True:
                self.wfile.write(f"data: {json.dumps(st)}\n\n".encode())
                self.wfile.flush()
                st = PTT.wait(st["seq"], st["down"], timeout=15)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def from_aria_page(self):
        """Only ARIA's own page may change settings or press keys. Browsers always
        send Origin on cross-site POSTs, so a random website can't drive this."""
        origin = self.headers.get("Origin")
        if origin is None:
            return True  # not a browser cross-site request (e.g. curl on this PC)
        host = urllib.parse.urlsplit(origin).hostname or ""
        return host in ("localhost", "127.0.0.1", "::1")

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path == "/api/scores" or u.path == "/api/reports" or u.path.startswith("/api/lobby"):  # squad: friends post here from their own ARIA
            n = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(n) if n else b"{}")
            except Exception:
                payload = {}
            if not load_config().get("squad_host"):
                return self.send_json(404, {"error": "Not hosting."}, CORS)
            r = SQUAD.handle("POST", u.path, {}, payload if isinstance(payload, dict) else {})
            return self.send_json(r[0], r[1], CORS) if r else self.send_json(404, {"error": "unknown"}, CORS)
        if not self.from_aria_page() or "json" not in (self.headers.get("Content-Type") or ""):
            return self.send_json(403, {"error": "forbidden"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except Exception:
            payload = {}
        if u.path == "/api/config":
            cfg = load_config()
            for k in ("uex_token", "sc_path", "update_repo", "squad_key", "squad_url", "squad_name", "launcher_path", "locate_open", "locate_send", "dcs_path", "dcs_saved"):
                if k in payload:
                    cfg[k] = str(payload[k]).strip()
            if "squad_host" in payload:
                cfg["squad_host"] = bool(payload["squad_host"])
                if cfg["squad_host"] and not cfg.get("squad_key"):
                    import secrets
                    cfg["squad_key"] = secrets.token_hex(4)
            if "vjoy_instance" in payload:
                v = str(payload["vjoy_instance"]).strip()
                if v.isdigit():
                    cfg["vjoy_instance"] = int(v)
                else:
                    cfg.pop("vjoy_instance", None)
            save_config(cfg)
            return self.send_json(200, {"ok": True})
        if u.path == "/api/ptt/learn":
            if not PTT.available:
                return self.send_json(400, {"ok": False, "error": "Push-to-talk needs ARIA running on Windows."})
            PTT.learn()
            return self.send_json(200, {"ok": True})
        if u.path == "/api/ptt/clear":
            PTT.clear()
            cfg = load_config(); cfg.pop("ptt", None); save_config(cfg)
            return self.send_json(200, {"ok": True})
        if u.path == "/api/keys":
            spec = str(payload.get("keys") or "")
            try:
                steps = keys.run_async(spec, focus=bool(payload.get("focus")))
            except ValueError as e:
                return self.send_json(400, {"ok": False, "error": str(e)})
            sys.stderr.write(f"[aria] keys: {spec}{'' if keys.IS_WINDOWS else '  (simulated: not Windows)'}\n")
            return self.send_json(200, {"ok": True, "steps": len(steps), "simulated": not keys.IS_WINDOWS})
        if u.path.startswith("/api/dcs/"):
            cfg_ = load_config(); act = u.path.rsplit("/", 1)[1]
            try:
                if act == "install":
                    return self.send_json(200, dcs.install_export(cfg_))
                if act == "uninstall":
                    return self.send_json(200, dcs.uninstall_export(cfg_))
                if act == "monitorsetup":
                    layout = payload.get("layout") or {}
                    if payload.get("preview"):
                        return self.send_json(200, {"ok": True, "lua": dcs.monitor_setup_lua(layout)})
                    path = dcs.write_monitor_setup(cfg_, layout)
                    return self.send_json(200, {"ok": True, "path": path, "lua": dcs.monitor_setup_lua(layout)})
                if act == "window":  # move ARIA's window to an exact desktop rectangle
                    r = payload.get("rect") or {}
                    return self.send_json(200, {"ok": winsys.place_aria(r.get("x", 0), r.get("y", 0), r.get("w", 800), r.get("h", 600))})
                if act == "launch":
                    exe = dcs.find_exe(cfg_.get("dcs_path"))
                    if not exe:
                        return self.send_json(404, {"ok": False, "error": "DCS not found. Set its folder in ARIA → DCS → Setup."})
                    if os.name == "nt":
                        os.startfile(exe)  # noqa
                    return self.send_json(200, {"ok": True, "path": exe, "simulated": os.name != "nt"})
            except (OSError, KeyError, ValueError, TypeError) as e:
                return self.send_json(400, {"ok": False, "error": str(e)})
            return self.send_json(404, {"ok": False, "error": "unknown"})
        if u.path == "/api/locate":  # /showlocation → clipboard → coordinates
            import locate
            r = locate.locate(load_config())
            if r.get("ok"):
                sys.stderr.write(f"[aria] located: {r['x']:.0f} {r['y']:.0f} {r['z']:.0f}\n")
            return self.send_json(200 if r.get("ok") else 409, r)
        if u.path == "/api/report":  # save a job report on this PC (the page also posts it to the squad host)
            r = SQUAD.add_report(payload.get("report"))
            return self.send_json(200, {"ok": True, "id": r["id"]}) if r else self.send_json(400, {"ok": False, "error": "empty report"})
        if u.path == "/api/launcher":  # start the RSI Launcher (or bring it forward if it's already open)
            exe = find_launcher(load_config().get("launcher_path"))
            if not exe:
                return self.send_json(404, {"ok": False, "error": "RSI Launcher not found. Set its location in Settings → Assistant."})
            if os.name == "nt":
                try: os.startfile(exe)  # noqa — the launcher is single-instance, a second start just focuses it
                except Exception as e: return self.send_json(500, {"ok": False, "error": str(e)})
            return self.send_json(200, {"ok": True, "path": exe, "simulated": os.name != "nt"})
        if u.path == "/api/open":  # open a Windows settings page (fixed list, nothing user-supplied)
            targets = {"sound": "ms-settings:sound", "privacy-mic": "ms-settings:privacy-microphone", "display": "ms-settings:display"}
            uri = targets.get(payload.get("what") or "")
            if not uri:
                return self.send_json(400, {"ok": False, "error": "unknown target"})
            if os.name == "nt":
                try: os.startfile(uri)  # noqa
                except Exception as e: return self.send_json(500, {"ok": False, "error": str(e)})
            return self.send_json(200, {"ok": True, "opened": uri, "simulated": os.name != "nt"})
        if u.path == "/api/mfd/learn":
            if not MFD.available:
                return self.send_json(400, {"ok": False, "error": "MFD buttons need ARIA running on Windows."})
            MFD.learn("R" if payload.get("side") == "R" else "L")
            return self.send_json(200, {"ok": True})
        if u.path == "/api/mfd/test":  # simulate a press (testing without the hardware)
            MFD.inject("R" if payload.get("side") == "R" else "L", int(payload.get("btn") or 1), bool(payload.get("down", True)))
            return self.send_json(200, {"ok": True})
        if u.path == "/api/display":
            cfg = load_config()
            if "device" in payload:
                cfg["display"] = payload["device"]
            if "fullscreen" in payload:
                cfg["fullscreen"] = bool(payload["fullscreen"])
            save_config(cfg)
            moved = winsys.move_aria(winsys.find_monitor(cfg.get("display"))) if payload.get("move") else False
            return self.send_json(200, {"ok": True, "moved": moved})
        if u.path == "/api/update/check":
            return self.send_json(200, updater.check())
        if u.path == "/api/update/apply":
            launcher = os.path.join(ROOT, "launcher.pyw")
            if not os.path.exists(launcher):
                return self.send_json(400, {"ok": False, "error": "Updating needs the installed desktop app (install.bat)."})
            import subprocess
            exe = sys.executable
            if exe.lower().endswith("python.exe") and os.path.exists(exe[:-10] + "pythonw.exe"):
                exe = exe[:-10] + "pythonw.exe"
            subprocess.Popen([exe, launcher, "--wait-pid", str(os.getpid()), "--no-window"], cwd=ROOT)
            threading.Timer(0.5, lambda: SRV and SRV.shutdown()).start()
            return self.send_json(200, {"ok": True})
        if u.path == "/api/quit":
            threading.Timer(0.3, lambda: SRV and SRV.shutdown()).start()
            return self.send_json(200, {"ok": True})
        if u.path == "/api/bind":
            return self.send_json(*do_bind(payload))
        if u.path == "/api/macros":
            macros, errors = clean_macros(payload.get("macros"))
            if errors:
                return self.send_json(400, {"ok": False, "errors": errors})
            with open(MACROS, "w", encoding="utf-8") as f:
                json.dump(macros, f, indent=2)
            return self.send_json(200, {"ok": True, "count": len(macros)})
        if u.path == "/api/cache/clear":
            for f in os.listdir(CACHE):
                if f.endswith(".json"):
                    os.remove(os.path.join(CACHE, f))
            return self.send_json(200, {"ok": True})
        return self.send_json(404, {"error": "unknown endpoint"})


_bind_lock = threading.Lock()


def do_bind(payload):
    """Give a game action a new input: a free vJoy button or a keyboard key.
    Writes actionmaps.xml when the game is closed; otherwise queues it."""
    amap, action = str(payload.get("map") or ""), str(payload.get("action") or "")
    target = payload.get("target") or "vjoy"
    if not amap or not action:
        return 400, {"ok": False, "error": "Missing action"}
    with _bind_lock:
        cfg = load_config()
        cat = scbinds.catalog(cfg)
        if not cat["install"]:
            return 400, {"ok": False, "error": "Can't find your Star Citizen install. Set the game folder in Settings."}
        if not cat["can_write"]:
            return 400, {"ok": False, "error": "No actionmaps.xml yet — change any one keybind in game once so Star Citizen creates it."}
        if target == "vjoy":
            st = VJ.status()
            if not st["ok"]:
                return 400, {"ok": False, "error": st["error"]}
            if not cat["vjoy_instance"]:
                return 400, {"ok": False, "error": "Star Citizen hasn't listed the vJoy device yet. Start the game once with vJoy installed, "
                                                   "or set its joystick number (Options → Keybindings shows it) in Settings."}
            used = set(cat["vjoy_used"])
            spec = next((f"vj{i}" for i in range(1, st["buttons"] + 1) if i not in used), None)
            if not spec:
                return 400, {"ok": False, "error": f"All {st['buttons']} vJoy buttons are used."}
        else:
            spec = str(payload.get("keys") or "").strip()
            try:
                keys.parse(spec)
            except ValueError as e:
                return 400, {"ok": False, "error": str(e)}
        try:
            sc_input = scbinds.aria_to_sc(spec, cat["vjoy_instance"])
        except ValueError as e:
            return 400, {"ok": False, "error": str(e)}
        if cat["game_running"]:
            pend = [p for p in cfg.get("pending_binds", [])
                    if not (p["map"] == amap and p["action"] == action and p["input"].split("_")[0] == sc_input.split("_")[0])]
            pend.append({"map": amap, "action": action, "input": sc_input})
            cfg["pending_binds"] = pend
            save_config(cfg)
            return 200, {"ok": True, "keys": spec, "input": sc_input, "applied": False, "queued": True}
        scbinds.write_rebind(cat["install"], amap, action, sc_input)
        sys.stderr.write(f"[aria] bound {action} -> {sc_input}\n")
        return 200, {"ok": True, "keys": spec, "input": sc_input, "applied": True, "queued": False}


def apply_pending_loop():
    """Star Citizen rewrites actionmaps.xml when it exits, so binds made while it
    runs wait here and are written the moment the game has closed."""
    while True:
        time.sleep(15)
        try:
            cfg = load_config()
            pend = cfg.get("pending_binds") or []
            if not pend or scbinds.game_running():
                continue
            time.sleep(5)  # let the game finish writing its own file
            with _bind_lock:
                install = scbinds.find_install(cfg.get("sc_path"))
                for p in pend:
                    scbinds.write_rebind(install, p["map"], p["action"], p["input"])
                    sys.stderr.write(f"[aria] applied queued bind {p['action']} -> {p['input']}\n")
                cfg = load_config(); cfg["pending_binds"] = []; save_config(cfg)
        except Exception as e:
            sys.stderr.write(f"[aria] pending binds: {e}\n")


def _save_ptt(binding):
    cfg = load_config()
    cfg["ptt"] = binding
    save_config(cfg)
    sys.stderr.write(f"[aria] push-to-talk bound to {binding.get('label')}\n")


PTT = ptt_mod.PTT(load_config().get("ptt"), on_learn=_save_ptt)


def _save_mfd(assign):
    cfg = load_config(); cfg["mfd"] = assign; save_config(cfg)
    sys.stderr.write(f"[aria] MFDs: {assign}\n")


MFD = mfd_mod.MFDs(load_config().get("mfd"), on_change=_save_mfd)
SRV = None
VJ = vjoy_mod.VJoy(load_config().get("vjoy_device", 1))
keys.VJOY = VJ
threading.Thread(target=apply_pending_loop, daemon=True).start()


def open_app_window(url):
    cfg = load_config()
    mon = winsys.find_monitor(cfg.get("display")) if cfg.get("display") else None
    """Open ARIA in its own Edge/Chrome window with background throttling off, so
    voice and push-to-talk keep working while the game is fullscreen in front.
    Uses a separate browser profile in aria/browser-profile (mic permission is asked once)."""
    if sys.platform.startswith("win"):
        import subprocess
        pf = [os.environ.get(v) for v in ("ProgramFiles(x86)", "ProgramFiles", "LocalAppData")]
        cands = []
        for base in filter(None, pf):
            cands += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                      os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
        for exe in cands:
            if os.path.exists(exe):
                try:
                    args = [exe, f"--app={url}", f"--user-data-dir={os.path.join(ROOT, 'browser-profile')}",
                            "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                            "--disable-backgrounding-occluded-windows"]
                    if mon:
                        args += [f"--window-position={mon['x']},{mon['y']}", f"--window-size={mon['w']},{mon['h']}"]
                        if cfg.get("fullscreen"):
                            args.append("--start-fullscreen")
                    else:
                        args.append("--window-size=1500,950")
                    subprocess.Popen(args)
                    if mon:  # Chromium sometimes ignores the position on first run; put it there ourselves
                        threading.Timer(2.5, lambda: winsys.move_aria(mon)).start()
                    return
                except Exception:
                    pass
    webbrowser.open(url)


def main(argv=None):
    global SRV
    ap = argparse.ArgumentParser(description="ARIA local Star Citizen assistant")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--normal-browser", action="store_true", help="open in your default browser instead of an app window")
    a = ap.parse_args(argv)
    if load_config().get("squad_host") and a.host == "127.0.0.1":
        a.host = "0.0.0.0"  # hosting the squad board: reachable from the network
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
        dcs.FEED.start()  # DCS flight data arrives here over UDP (127.0.0.1:7778)
    except OSError:  # already running: just bring up a window
        print(f"ARIA is already running on port {a.port}.")
        if not a.no_browser:
            open_app_window(f"http://localhost:{a.port}/")
        return
    srv.daemon_threads = True
    SRV = srv
    url = f"http://localhost:{a.port}/"
    print(f"ARIA online at {url}  (Ctrl+C to stop)")
    if PTT.binding:
        print(f"Push-to-talk: {PTT.binding.get('label')}")
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url) if a.normal_browser else open_app_window(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nARIA offline.")


if __name__ == "__main__":
    main()
