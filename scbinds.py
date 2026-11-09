"""
Star Citizen keybinds for ARIA.

Builds one catalog of game actions and the keyboard key each is on, from the
best files available:

  1. defaultProfile.xml + global.ini   every action, its default key and its real
     name. These live inside Data.p4k; extract them once with the community tool
     unp4k and drop them in aria/scdata/ (see README).
  2. actionmaps.xml                    YOUR changes, read straight from the game
     install (LIVE/PTU/...\\user\\client\\0\\Profiles\\default\\actionmaps.xml).
  3. A small starter list               used only until (1) is available.

Every entry says where its key came from, so ARIA never presents a guess as fact.
"""
import os
import re
import shutil
import string
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

import keys

HERE = os.path.dirname(os.path.abspath(__file__))
SCDATA = os.path.join(HERE, "scdata")
BACKUPS = os.path.join(HERE, "backups")
CHANNELS = ["LIVE", "PTU", "EPTU", "TECH-PREVIEW", "HOTFIX"]

# Starter entries: common actions whose default keys are widely documented.
# Shown as "starter" until your own game files are loaded.
STARTER = [
    ("starter_landing_gear", "Toggle landing gear", "Flight", "n", "press"),
    ("starter_flight_ready", "Flight ready", "Flight", "r", "press"),
    ("starter_lights", "Toggle headlights", "Flight", "l", "press"),
    ("starter_vtol", "Toggle VTOL", "Flight", "k", "press"),
    ("starter_quantum_mode", "Quantum travel mode", "Flight", "b", "press"),
    ("starter_exit_seat", "Exit seat", "General", "y", "hold"),
    ("starter_mobiglas", "Open mobiGlas", "General", "f1", "press"),
    ("starter_starmap", "Open starmap", "General", "f2", "press"),
    ("starter_power", "Toggle power (all)", "Power", "u", "press"),
]

SC_TO_ARIA = {"escape": "esc", "pgup": "pageup", "pgdn": "pagedown", "np_add": "npplus",
              "np_subtract": "npminus", "np_multiply": "npmultiply", "np_divide": "npdivide",
              "np_period": "npperiod", "np_enter": "npenter", "return": "enter"}
for _i in range(10):
    SC_TO_ARIA[f"np_{_i}"] = f"np{_i}"


def find_install(cfg_path=None):
    """Return the first game channel folder that has a user profile."""
    roots = []
    if cfg_path:
        roots.append(cfg_path)
    drives = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")] if sys.platform.startswith("win") else []
    for d in drives:
        roots += [os.path.join(d, "Program Files", "Roberts Space Industries", "StarCitizen"),
                  os.path.join(d, "Roberts Space Industries", "StarCitizen"),
                  os.path.join(d, "Games", "Roberts Space Industries", "StarCitizen"),
                  os.path.join(d, "StarCitizen")]
    for root in roots:
        cands = [root] + [os.path.join(root, ch) for ch in CHANNELS]
        for c in cands:
            if os.path.exists(os.path.join(c, "user", "client", "0", "Profiles", "default", "actionmaps.xml")):
                return c
    for root in roots:  # an install with no custom binds yet still counts
        for c in [root] + [os.path.join(root, ch) for ch in CHANNELS]:
            if os.path.exists(os.path.join(c, "Data.p4k")):
                return c
    return None


def sc_input_to_aria(inp):
    """'kb1_lalt+n' -> 'lalt+n'. Returns (aria_keys or None, device)."""
    inp = (inp or "").strip()
    if not inp:
        return None, None
    dev = "keyboard"
    if "_" in inp and re.match(r"^(kb|mo|js|gp)\d*_", inp):
        pre, inp = inp.split("_", 1)
        dev = {"kb": "keyboard", "mo": "mouse", "js": "joystick", "gp": "gamepad"}.get(re.sub(r"\d", "", pre), pre)
    inp = inp.strip()
    if not inp or inp == " ":
        return None, dev
    if dev in ("joystick", "gamepad"):
        return None, dev
    parts = [SC_TO_ARIA.get(p.strip().lower(), p.strip().lower()) for p in inp.split("+")]
    spec = "+".join(parts)
    try:
        keys.parse(spec)
        return spec, dev
    except ValueError:
        return None, dev


def load_ini(path):
    out = {}
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        for line in f:
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.split(",")[0].strip().lower()] = v.strip()
    return out


def label(ui, ini, fallback):
    if ui and ui.startswith("@"):
        t = ini.get(ui[1:].lower())
        if t:
            return t
    return re.sub(r"\s+", " ", fallback.replace("v_", "", 1).replace("_", " ")).strip().capitalize()


def actionmaps_path(install):
    return os.path.join(install, "user", "client", "0", "Profiles", "default", "actionmaps.xml") if install else None


def vjoy_instance(root, cfg):
    """Which joystick number Star Citizen gave the vJoy device (js1, js2 …)."""
    if cfg.get("vjoy_instance"):
        return int(cfg["vjoy_instance"]), "your setting"
    if root is not None:
        for o in root.iter("options"):
            if o.get("type") == "joystick" and "vjoy" in (o.get("Product") or "").lower():
                try:
                    return int(o.get("instance")), "detected"
                except (TypeError, ValueError):
                    pass
    return None, None


def game_running():
    if not sys.platform.startswith("win"):
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq StarCitizen.exe", "/NH"], capture_output=True, text=True,
                             timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        return "starcitizen.exe" in out.lower()
    except Exception:
        return False


ARIA_TO_SC = {v: k for k, v in SC_TO_ARIA.items() if k not in ("return",)}


def aria_to_sc(spec, vj_inst=None):
    """'ralt+np0' -> 'kb1_ralt+np_0';  'vj12' -> 'js3_button12'."""
    spec = spec.split(":")[0]
    m = re.fullmatch(r"vj(\d+)", spec)
    if m:
        if not vj_inst:
            raise ValueError("vJoy's joystick number in Star Citizen isn't known yet")
        return f"js{vj_inst}_button{m.group(1)}"
    return "kb1_" + "+".join(ARIA_TO_SC.get(p, p) for p in spec.split("+"))


def write_rebind(install, amap, action, sc_input):
    """Add or replace one rebind in actionmaps.xml (backup first). Game must be closed."""
    path = actionmaps_path(install)
    if not path or not os.path.exists(path):
        raise FileNotFoundError("actionmaps.xml not found — change any one keybind in game once so Star Citizen creates it")
    os.makedirs(BACKUPS, exist_ok=True)
    shutil.copy2(path, os.path.join(BACKUPS, time.strftime("actionmaps-%Y%m%d-%H%M%S") + f"-{time.time_ns() % 10**6:06d}.xml"))
    olds = sorted(f for f in os.listdir(BACKUPS) if f.startswith("actionmaps-"))
    for f in olds[:-20]:  # keep the last 20
        os.remove(os.path.join(BACKUPS, f))
    tree = ET.parse(path)
    root = tree.getroot()
    prof = next((p for p in root.iter("ActionProfiles") if p.get("profileName", "default") == "default"), None)
    if prof is None:
        prof = root if root.tag == "ActionProfiles" else next(root.iter("ActionProfiles"), root)
    am = next((m for m in prof.findall("actionmap") if m.get("name") == amap), None)
    if am is None:
        am = ET.SubElement(prof, "actionmap", {"name": amap})
    act = next((a for a in am.findall("action") if a.get("name") == action), None)
    if act is None:
        act = ET.SubElement(am, "action", {"name": action})
    dev = sc_input.split("_", 1)[0]  # kb1 / js3 / mo1
    for rb in list(act.findall("rebind")):
        if (rb.get("input") or "").split("_", 1)[0] == dev:
            act.remove(rb)
    ET.SubElement(act, "rebind", {"input": sc_input})
    tree.write(path, encoding="utf-8", xml_declaration=False)
    return path


def mappings_dir(install):
    """Where Star Citizen looks for control profiles you can load (Keybindings → Control Profiles)."""
    return os.path.join(install, "user", "client", "0", "Controls", "Mappings") if install else None


def write_profile(install, binds, vj_inst=None, name="ARIA"):
    """ARIA Auto-Bind: a loadable control profile = everything you already have bound
    (copied from actionmaps.xml) + ARIA's binds added on top. Nothing of yours is removed:
    an action can hold a keyboard key, a HOTAS button and a vJoy button at once.
    binds: [{"map", "action", "input"}] with SC inputs (js3_button12 / kb1_ralt+np1)."""
    import copy
    folder = mappings_dir(install)
    if not folder:
        raise FileNotFoundError("Can't find your Star Citizen install — set the game folder in Settings.")
    os.makedirs(folder, exist_ok=True)
    out = ET.Element("ActionMaps", {"version": "1", "optionsVersion": "2", "rebindVersion": "2", "profileName": name})
    hdr = ET.SubElement(out, "CustomisationUIHeader", {"label": name, "description": "Made by ARIA Auto-Bind", "image": ""})
    devs = ET.SubElement(hdr, "devices")
    ET.SubElement(devs, "keyboard", {"instance": "1"})
    ET.SubElement(devs, "mouse", {"instance": "1"})
    maps = {}
    am_path = actionmaps_path(install)
    joys = set()
    if am_path and os.path.exists(am_path):
        root = ET.parse(am_path).getroot()
        prof = next((p for p in root.iter("ActionProfiles") if p.get("profileName", "default") == "default"), root)
        for o in prof.findall("deviceoptions"):  # your deadzones / curves come along too
            out.append(copy.deepcopy(o))
        for o in prof.findall("options"):
            out.append(copy.deepcopy(o))
            if o.get("type") == "joystick" and o.get("instance"):
                joys.add(o.get("instance"))
        for m in prof.findall("modifiers"):
            out.append(copy.deepcopy(m))
        for am in prof.findall("actionmap"):
            c = copy.deepcopy(am)
            out.append(c)
            maps[am.get("name")] = c
    if vj_inst:
        joys.add(str(vj_inst))
    for j in sorted(joys, key=lambda x: int(x) if x.isdigit() else 99):
        ET.SubElement(devs, "joystick", {"instance": j})
    added = 0
    for b in binds:
        am = maps.get(b["map"])
        if am is None:
            am = maps[b["map"]] = ET.SubElement(out, "actionmap", {"name": b["map"]})
        act = next((a for a in am.findall("action") if a.get("name") == b["action"]), None)
        if act is None:
            act = ET.SubElement(am, "action", {"name": b["action"]})
        dev = b["input"].split("_", 1)[0]
        for rb in list(act.findall("rebind")):  # replace only the same device's bind (vJoy for vJoy, keyboard for keyboard)
            if (rb.get("input") or "").split("_", 1)[0] == dev:
                act.remove(rb)
        ET.SubElement(act, "rebind", {"input": b["input"]})
        added += 1
    path = os.path.join(folder, name + ".xml")
    if os.path.exists(path):
        os.makedirs(BACKUPS, exist_ok=True)
        shutil.copy2(path, os.path.join(BACKUPS, time.strftime(f"{name}-profile-%Y%m%d-%H%M%S.xml")))
    ET.indent(out) if hasattr(ET, "indent") else None
    ET.ElementTree(out).write(path, encoding="utf-8", xml_declaration=False)
    return path, added


def catalog(cfg=None):
    cfg = cfg or {}
    install = find_install(cfg.get("sc_path"))
    dp = os.path.join(SCDATA, "defaultProfile.xml")
    gi = os.path.join(SCDATA, "global.ini")
    ini = load_ini(gi) if os.path.exists(gi) else {}
    acts, sources = {}, []

    if os.path.exists(dp):
        sources.append("defaultProfile.xml")
        root = ET.parse(dp).getroot()
        for am in root.iter("actionmap"):
            cat = label(am.get("UICategory") or am.get("UILabel"), ini, am.get("name", ""))
            for a in am.findall("action"):
                name = a.get("name")
                if not name:
                    continue
                kb = a.get("keyboard")
                if kb is None:
                    k = a.find("keyboard")
                    kb = k.get("input") if k is not None else None
                ui = a.get("UILabel")
                acts[(am.get("name"), name)] = {
                    "id": name, "map": am.get("name"), "label": label(ui, ini, name), "category": cat,
                    "default": (kb or "").strip(), "mode": a.get("activationMode") or "", "source": "default",
                    "has_label": bool(ui and ini.get(ui[1:].lower()))}
    else:
        for aid, lab, cat, k, mode in STARTER:
            acts[("starter", aid)] = {"id": aid, "map": "starter", "label": lab, "category": cat,
                                      "default": k, "mode": mode, "source": "starter", "has_label": True}

    am_path = actionmaps_path(install)
    am_root = None
    if am_path and os.path.exists(am_path):
        try:
            am_root = ET.parse(am_path).getroot()
        except ET.ParseError as ex:
            sources.append(f"actionmaps.xml unreadable ({ex})")
    vj_inst, vj_src = vjoy_instance(am_root, cfg)
    pending = cfg.get("pending_binds") or []
    if am_root is not None:
        sources.append("actionmaps.xml")
        try:
            root = am_root
            for am in root.iter("actionmap"):
                for a in am.findall("action"):
                    name = a.get("name")
                    for rb in a.findall("rebind"):
                        inp = rb.get("input", "")
                        dev = inp.split("_", 1)[0] if "_" in inp else ""
                        key = (am.get("name"), name)
                        e = acts.get(key)
                        if not e:
                            e = acts[key] = {"id": name, "map": am.get("name"), "label": label(None, ini, name),
                                             "category": am.get("name", "").replace("_", " "), "default": "",
                                             "mode": "", "source": "yours", "has_label": False}
                        if dev.startswith("kb") or dev.startswith("mo"):
                            e["yours"] = inp
                        elif vj_inst and dev == f"js{vj_inst}" and re.fullmatch(r"js\d+_button\d+", inp):
                            e["vjoy"] = "vj" + inp.rsplit("button", 1)[1]
                        elif dev.startswith("js") or dev.startswith("gp"):
                            e.setdefault("devices", []).append(inp)
        except Exception as ex:
            sources.append(f"actionmaps.xml unreadable ({ex})")
    for k, vj in (cfg.get("autobind") or {}).items():  # Auto-Bind profile: known as soon as it's written
        mp, _, an = k.partition("|")
        e = acts.get((mp, an))
        if e is not None and not e.get("vjoy"):
            e["vjoy"] = vj
    for pb in pending:  # binds waiting for the game to close
        e = acts.get((pb["map"], pb["action"]))
        if e is not None:
            e["pending"] = pb["input"]
            if pb["input"].startswith("js") and vj_inst and pb["input"].startswith(f"js{vj_inst}_"):
                e["vjoy"] = "vj" + pb["input"].rsplit("button", 1)[1]

    out, bound = [], set()
    for e in acts.values():
        cur = e.get("yours") if "yours" in e else e["default"]
        if e.get("pending", "").startswith("kb"):
            cur = e["pending"]
        spec, dev = sc_input_to_aria(cur)
        hold = e.get("mode", "").lower() in ("hold", "delayed_press", "delayed_hold", "hold_no_retrigger", "delayed_press_long")
        if not spec and e.get("vjoy"):
            spec = e["vjoy"]
        e["keys"] = (spec + (":0.8" if hold else "")) if spec else None
        e["bound_from"] = ("pending" if e.get("pending") and (spec == e.get("vjoy") or e["pending"].startswith("kb"))
                           else "vjoy" if spec and spec == e.get("vjoy") else "yours" if e.get("yours") else (e["source"] if spec else None))
        e["input"] = cur or ""
        if spec:
            bound.add(spec)
        out.append(e)
    out.sort(key=lambda e: (e["category"], e["label"]))
    used_vj = sorted({int(e["vjoy"][2:]) for e in out if e.get("vjoy")})
    return {"install": install, "sources": sources, "full": os.path.exists(dp), "labels": bool(ini),
            "actions": out, "free": suggest_free(bound) if os.path.exists(dp) else [],
            "vjoy_instance": vj_inst, "vjoy_instance_from": vj_src, "vjoy_used": used_vj,
            "pending": len(pending), "game_running": game_running(), "can_write": bool(am_path and os.path.exists(am_path))}


def suggest_free(bound):
    """A few key combos not used by any action, for binding something new in-game."""
    mods = ["ralt", "rctrl", "lalt", "rshift"]
    keys_ = [f"np{i}" for i in range(10)] + [f"f{i}" for i in range(5, 13)] + list("12345678")
    free = []
    for m in mods:
        for k in keys_:
            c = f"{m}+{k}"
            if c not in bound:
                free.append(c)
            if len(free) >= 6:
                return free
    return free
