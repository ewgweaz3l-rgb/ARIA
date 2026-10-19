"""ARIA for DCS World — the PC side.

* Finds DCS (install + Saved Games), and the DCS.exe icon for the game picker.
* Writes a MonitorSetup lua so DCS draws the real DDIs / AMPCD onto the screen
  rectangles you aligned in ARIA (Helios-style viewports).
* Installs a small Export.lua add-on that streams your own aircraft's data over
  UDP to ARIA (127.0.0.1), the same mechanism Tacview / SRS / DCS-BIOS use.
  It only reads your own jet — nothing that needs server permission.
* Listens for that stream and keeps the latest state for the web page.
"""
import json
import os
import shutil
import socket
import sys
import threading
import time

IS_WINDOWS = sys.platform.startswith("win")
UDP_PORT = 7781  # 7778 belongs to DCS-BIOS (its command port); stay clear of it
EXPORT_LINE = "local ariaLfs = require('lfs'); dofile(ariaLfs.writedir() .. 'Scripts/ARIA/ARIAExport.lua') -- ARIA flight data"


# ---------------- where things are ----------------
def saved_games(custom=None):
    """Saved Games\\DCS (or DCS.openbeta) — whichever exists, newest first."""
    cands = []
    if custom:
        cands.append(custom)
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    for name in ("DCS", "DCS.openbeta", "DCS.release_server", "DCS.server"):
        cands.append(os.path.join(home, "Saved Games", name))
    found = [c for c in cands if c and os.path.isdir(c)]
    if not found:
        return None
    if custom and custom in found:
        return custom
    return max(found, key=lambda p: os.path.getmtime(p))


def _registry_dirs():
    out = []
    if not IS_WINDOWS:
        return out
    try:
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for sub in (r"Software\Eagle Dynamics\DCS World", r"Software\Eagle Dynamics\DCS World OpenBeta"):
                try:
                    with winreg.OpenKey(hive, sub) as k:
                        out.append(winreg.QueryValueEx(k, "Path")[0])
                except OSError:
                    pass
    except Exception:
        pass
    return out


def find_exe(custom=None):
    cands = []
    for d in _registry_dirs():
        cands += [os.path.join(d, "bin-mt", "DCS.exe"), os.path.join(d, "bin", "DCS.exe")]
    if custom:
        c = custom.strip().strip('"')
        cands += [c, os.path.join(c, "bin", "DCS.exe"), os.path.join(c, "bin-mt", "DCS.exe")]
    if IS_WINDOWS:
        import string
        for d in [f"{x}:\\" for x in string.ascii_uppercase if os.path.exists(f"{x}:\\")]:
            for sub in (("Program Files", "Eagle Dynamics", "DCS World"), ("Program Files", "Eagle Dynamics", "DCS World OpenBeta"),
                        ("Eagle Dynamics", "DCS World"), ("DCS World",), ("Games", "DCS World"),
                        ("Program Files (x86)", "Steam", "steamapps", "common", "DCSWorld"), ("SteamLibrary", "steamapps", "common", "DCSWorld")):
                for b in ("bin-mt", "bin"):
                    cands.append(os.path.join(d, *sub, b, "DCS.exe"))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def status(cfg):
    sg = saved_games(cfg.get("dcs_saved"))
    exp = os.path.join(sg, "Scripts", "Export.lua") if sg else None
    installed = False
    if exp and os.path.exists(exp):
        try:
            with open(exp, "r", encoding="utf-8", errors="ignore") as f:
                installed = "ARIAExport.lua" in f.read()
        except OSError:
            pass
    mon = os.path.join(sg, "Config", "MonitorSetup") if sg else None
    setups = sorted(f for f in os.listdir(mon) if f.lower().endswith(".lua")) if mon and os.path.isdir(mon) else []
    return {"saved_games": sg, "exe": find_exe(cfg.get("dcs_path")), "export_installed": installed,
            "monitor_setups": setups, "feed": FEED.snapshot(), "windows": IS_WINDOWS, "bios": bios_status(cfg)}


# ---------------- MonitorSetup (viewports) ----------------
def _n(v):
    return int(round(float(v)))


def monitor_setup_lua(layout):
    """layout = {name, center:{x,y,w,h}, views:{LEFT_MFCD:{x,y,w,h}, ...}} in DCS-window pixels."""
    name = str(layout.get("name") or "ARIA").replace("'", "")[:40]
    c = layout["center"]
    lines = [
        "-- Written by ARIA. Pick it in DCS: Options → System → Monitors.",
        "-- Resolution in DCS must cover every viewport below (see ARIA → DCS → Viewports).",
        "_ = function(p) return p; end;",
        f"name = _('{name}');",
        "Description = 'ARIA: main view + aircraft displays on the MFD screen'",
        "Viewports = {",
        f"  Center = {{ x = {_n(c['x'])}; y = {_n(c['y'])}; width = {_n(c['w'])}; height = {_n(c['h'])}; viewDx = 0; viewDy = 0; aspect = {_n(c['w'])}/{_n(c['h'])}; }}",
        "}",
    ]
    for key, r in (layout.get("views") or {}).items():
        if not key.replace("_", "").isalnum():
            continue
        lines.append(f"{key} = {{ x = {_n(r['x'])}; y = {_n(r['y'])}; width = {_n(r['w'])}; height = {_n(r['h'])}; }}")
    lines += ["UIMainView = Viewports.Center", "GU_MAIN_VIEWPORT = Viewports.Center", ""]
    return "\n".join(lines)


def write_monitor_setup(cfg, layout):
    sg = saved_games(cfg.get("dcs_saved"))
    if not sg:
        raise FileNotFoundError("Couldn't find Saved Games\\DCS. Start DCS once, or set the folder in ARIA → DCS → Setup.")
    folder = os.path.join(sg, "Config", "MonitorSetup")
    os.makedirs(folder, exist_ok=True)
    fname = "ARIA_" + "".join(ch for ch in (layout.get("name") or "Cockpit") if ch.isalnum() or ch in "-_")[:30] + ".lua"
    path = os.path.join(folder, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(monitor_setup_lua(layout))
    return path


# ---------------- Export.lua add-on ----------------
ARIA_EXPORT = r'''-- ARIA flight data export (own aircraft only). Installed by ARIA; safe to delete.
-- Sends a small JSON packet to ARIA on 127.0.0.1:%(port)d five times a second.
local ARIA = { host = "127.0.0.1", port = %(port)d, every = 0.2, next = 0 }
package.path  = package.path  .. ";.\\LuaSocket\\?.lua"
package.cpath = package.cpath .. ";.\\LuaSocket\\?.dll"
local okSock, socket = pcall(require, "socket")

local function enc(v)
  local t = type(v)
  if t == "number" then if v ~= v or v == math.huge or v == -math.huge then return "null" end return string.format("%%.9g", v)
  elseif t == "boolean" then return v and "true" or "false"
  elseif t == "string" then return '"' .. v:gsub('[%%c"\\]', function(c) return string.format("\\u%%04x", c:byte()) end) .. '"'
  elseif t == "table" then
    local parts, isArr = {}, (#v > 0)
    if isArr then for i = 1, #v do parts[#parts + 1] = enc(v[i]) end return "[" .. table.concat(parts, ",") .. "]" end
    for k, x in pairs(v) do if type(k) == "string" then parts[#parts + 1] = enc(k) .. ":" .. enc(x) end end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
local function get(f, ...) if type(f) ~= "function" then return nil end local ok, r = pcall(f, ...) if ok then return r end return nil end

-- Hornet UFC text (scratchpad, option windows, COMM channels) from the cockpit's own indicator,
-- parsed like DCS-BIOS does. The indicator number is found once by looking for UFC_ keys.
local function parseInd(id)
  local li = get(list_indication, id)
  if not li or li == "" then return nil end
  local r, n = {}, 0
  for name, value in li:gmatch("%%-%%-%%-+\n([^\n]+)\n([^\n]*)\n") do r[name] = value; n = n + 1 end
  if n == 0 then return nil end
  return r
end
local function ufcText(unit)
  if not unit or not tostring(unit):find("FA%%-18") then ARIA.ufcId = nil; return nil end
  if ARIA.ufcId then return parseInd(ARIA.ufcId) end
  for i = 0, 24 do
    local r = parseInd(i)
    if r then for k in pairs(r) do if tostring(k):find("^UFC_") then ARIA.ufcId = i; return r end end end
  end
  return nil
end

local function snapshot()
  local s = get(LoGetSelfData) or {}
  local lla = s.LatLongAlt or {}
  local eng = get(LoGetEngineInfo) or {}
  local fuel = eng.fuel_internal and { internal = eng.fuel_internal, external = eng.fuel_external } or nil
  local acc = get(LoGetAccelerationUnits) or {}
  return {
    t = get(LoGetModelTime), mission_start = get(LoGetMissionStartTime), pilot = get(LoGetPilotName), unit = s.Name,
    lat = lla.Lat, lon = lla.Long, alt = get(LoGetAltitudeAboveSeaLevel), agl = get(LoGetAltitudeAboveGroundLevel),
    hdg = s.Heading, pitch = s.Pitch, bank = s.Bank, mag_hdg = get(LoGetMagneticYaw),
    ias = get(LoGetIndicatedAirSpeed), tas = get(LoGetTrueAirSpeed), mach = get(LoGetMachNumber),
    vvi = get(LoGetVerticalVelocity), aoa = get(LoGetAngleOfAttack), g = acc.y, fuel = fuel,
    x = (s.Position or {}).x, z = (s.Position or {}).z,
    ufc = ufcText(s.Name)
  }
end

local prevStart, prevStop, prevAfter = LuaExportStart, LuaExportStop, LuaExportAfterNextFrame
LuaExportStart = function()
  if prevStart then pcall(prevStart) end
  if okSock then ARIA.udp = socket.udp(); ARIA.udp:settimeout(0) end
end
LuaExportAfterNextFrame = function()
  if prevAfter then pcall(prevAfter) end
  if not ARIA.udp then return end
  local now = get(LoGetModelTime) or 0
  if now < ARIA.next then return end
  ARIA.next = now + ARIA.every
  local ok, msg = pcall(function() return enc(snapshot()) end)
  if ok and msg then pcall(function() ARIA.udp:sendto(msg, ARIA.host, ARIA.port) end) end
end
LuaExportStop = function()
  if prevStop then pcall(prevStop) end
  if ARIA.udp then pcall(function() ARIA.udp:sendto('{"stop":true}', ARIA.host, ARIA.port); ARIA.udp:close() end); ARIA.udp = nil end
end
'''


def install_export(cfg):
    sg = saved_games(cfg.get("dcs_saved"))
    if not sg:
        raise FileNotFoundError("Couldn't find Saved Games\\DCS. Start DCS once, or set the folder in ARIA → DCS → Setup.")
    scripts = os.path.join(sg, "Scripts")
    os.makedirs(os.path.join(scripts, "ARIA"), exist_ok=True)
    with open(os.path.join(scripts, "ARIA", "ARIAExport.lua"), "w", encoding="utf-8") as f:
        f.write(ARIA_EXPORT % {"port": UDP_PORT})
    exp = os.path.join(scripts, "Export.lua")
    text = ""
    if os.path.exists(exp):
        with open(exp, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        if "ARIAExport.lua" in text:
            return {"ok": True, "already": True, "path": exp}
        shutil.copy2(exp, exp + ".aria-backup")
    with open(exp, "a", encoding="utf-8") as f:
        f.write(("\n" if text and not text.endswith("\n") else "") + EXPORT_LINE + "\n")
    return {"ok": True, "path": exp, "backup": exp + ".aria-backup" if text else None}


def refresh_export(cfg):
    """Keep the add-on script current after an ARIA update (only if it's already installed)."""
    try:
        sg = saved_games(cfg.get("dcs_saved"))
        f = os.path.join(sg, "Scripts", "ARIA", "ARIAExport.lua") if sg else None
        if f and os.path.exists(f):
            new = ARIA_EXPORT % {"port": UDP_PORT}
            with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                if fh.read() == new:
                    return False
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(new)
            return True
    except Exception:
        pass
    return False


def uninstall_export(cfg):
    sg = saved_games(cfg.get("dcs_saved"))
    exp = os.path.join(sg, "Scripts", "Export.lua") if sg else None
    if not exp or not os.path.exists(exp):
        return {"ok": True}
    with open(exp, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.read().splitlines()
    with open(exp, "w", encoding="utf-8") as f:
        f.write("\n".join(l for l in lines if "ARIAExport.lua" not in l) + "\n")
    return {"ok": True}


# ---------------- DCS-BIOS (clickable cockpit) ----------------
# DCS-BIOS takes plain text commands on UDP 7778: "UFC_1 1" (press) / "UFC_1 0" (release),
# "UFC_COMM1_CHANNEL_SELECT INC", "LEFT_DDI_BRT_CTL +3200" ... ARIA only sends; it never edits DCS-BIOS.
BIOS_PORT = 7778
_bios_sock = None
_bios_ids = {"t": 0, "ids": None, "path": None}


def bios_status(cfg):
    sg = saved_games(cfg.get("dcs_saved"))
    if not sg:
        return {"installed": False}
    folder = os.path.join(sg, "Scripts", "DCS-BIOS")
    hooked = False
    exp = os.path.join(sg, "Scripts", "Export.lua")
    try:
        with open(exp, "r", encoding="utf-8", errors="ignore") as f:
            hooked = "dcs-bios" in f.read().lower()
    except OSError:
        pass
    ids = bios_ids(folder) if os.path.isdir(folder) else None
    return {"installed": os.path.isdir(folder), "hooked": hooked, "folder": folder if os.path.isdir(folder) else None,
            "hornet_ids": sorted(ids) if ids else None}


def bios_ids(folder):
    """Control names in DCS-BIOS's Hornet reference (doc/json/FA-18C_hornet.json), so ARIA can tell you
    if a button it draws has no matching DCS-BIOS control in your version."""
    path = None
    for sub in (("doc", "json"), ("json",), ("lib", "modules", "aircraft_modules")):
        c = os.path.join(folder, *sub, "FA-18C_hornet.json")
        if os.path.isfile(c):
            path = c
            break
    if not path:
        return None
    if _bios_ids["path"] == path and time.time() - _bios_ids["t"] < 300:
        return _bios_ids["ids"]
    ids = set()
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            data = json.load(f)
        for cat in data.values():
            if isinstance(cat, dict):
                for k, v in cat.items():
                    if isinstance(v, dict) and v.get("inputs"):
                        ids.add(k)
    except Exception:
        return None
    _bios_ids.update(t=time.time(), ids=ids, path=path)
    return ids


def bios_send(cmd, val):
    import re
    global _bios_sock
    cmd, val = str(cmd or ""), str(val if val is not None else "")
    if not re.fullmatch(r"[A-Z0-9_]{2,48}", cmd) or not re.fullmatch(r"[-+A-Z0-9]{1,12}", val):
        raise ValueError("bad DCS-BIOS command")
    if _bios_sock is None:
        _bios_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    _bios_sock.sendto(f"{cmd} {val}\n".encode("ascii"), ("127.0.0.1", BIOS_PORT))
    return True


# ---------------- the live feed ----------------
class Feed:
    def __init__(self):
        self.state, self.t, self.count = None, 0, 0
        self.cond = threading.Condition()
        self.sock = None

    def start(self):
        if self.sock:
            return
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.bind(("127.0.0.1", UDP_PORT))
            self.sock = s
        except OSError as e:
            sys.stderr.write(f"[aria] DCS feed port {UDP_PORT} busy: {e}\n")
            return
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                data, _ = self.sock.recvfrom(65535)
                msg = json.loads(data.decode("utf-8", "ignore"))
            except Exception:
                continue
            with self.cond:
                if msg.get("stop"):
                    self.state = None
                else:
                    self.state = msg
                self.t = time.time(); self.count += 1
                self.cond.notify_all()

    def snapshot(self):
        live = self.state is not None and time.time() - self.t < 3
        return {"live": live, "age": round(time.time() - self.t, 1) if self.t else None, "state": self.state if live else None}

    def wait(self, count, timeout=10):
        with self.cond:
            if self.count == count:
                self.cond.wait(timeout)
            return self.count, self.snapshot()


FEED = Feed()


def write_kneeboard(cfg, aircraft, pages):
    """pages = [{name, png (base64)}] → Saved Games\\DCS\\Kneeboard\\<aircraft>\\ARIA_<n>_<name>.png"""
    import base64, re
    sg = saved_games(cfg.get("dcs_saved"))
    if not sg:
        raise FileNotFoundError("Couldn't find Saved Games\\DCS. Start DCS once first.")
    ac = re.sub(r"[^A-Za-z0-9_\-]", "", str(aircraft or ""))[:40] or "FA-18C_hornet"
    folder = os.path.join(sg, "Kneeboard", ac)
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        if f.startswith("ARIA_") and f.endswith(".png"):
            os.remove(os.path.join(folder, f))
    written = []
    for i, p in enumerate(pages[:20]):
        data = base64.b64decode(str(p.get("png", "")).split(",")[-1])
        if not data.startswith(b"\x89PNG"):
            continue
        name = re.sub(r"[^A-Za-z0-9_\-]", "", str(p.get("name") or "page"))[:30]
        path = os.path.join(folder, f"ARIA_{i + 1:02d}_{name}.png")
        with open(path, "wb") as fh:
            fh.write(data)
        written.append(path)
    return {"ok": True, "folder": folder, "pages": len(written)}
