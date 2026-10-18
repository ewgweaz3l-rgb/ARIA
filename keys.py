"""
Key presses for ARIA voice macros.

Sends keystrokes the way VoiceAttack does: hardware scan codes through the
Windows SendInput API, which games built on DirectInput (Star Citizen included)
read as real key presses. Standard library only (ctypes).

Macro step syntax (steps separated by ';'):
    lctrl+n          tap Left Ctrl + N together
    b:1.5            hold B for 1.5 seconds
    wait 0.4         pause 0.4 seconds
    mouse1           left click (mouse2 right, mouse3 middle)
    f1; wait 1; f2   a sequence
    vj12             press vJoy virtual button 12 (vj12:0.8 holds it)

Key names: a-z, 0-9, f1-f12, lctrl rctrl lalt ralt lshift rshift (ctrl/alt/shift
mean the left one), space enter esc tab backspace capslock, up down left right,
insert delete home end pageup pagedown, minus equals lbracket rbracket semicolon
apostrophe grave comma period slash backslash, np0-np9 npenter npplus npminus
npmultiply npdivide npperiod, f13-f24 (keys no physical keyboard has), vj1-vj128.
"""
import ctypes
import re
import sys
import threading
import time

IS_WINDOWS = sys.platform.startswith("win")

SCAN = {
    "esc": 0x01, "1": 0x02, "2": 0x03, "3": 0x04, "4": 0x05, "5": 0x06, "6": 0x07, "7": 0x08,
    "8": 0x09, "9": 0x0A, "0": 0x0B, "minus": 0x0C, "equals": 0x0D, "backspace": 0x0E, "tab": 0x0F,
    "q": 0x10, "w": 0x11, "e": 0x12, "r": 0x13, "t": 0x14, "y": 0x15, "u": 0x16, "i": 0x17,
    "o": 0x18, "p": 0x19, "lbracket": 0x1A, "rbracket": 0x1B, "enter": 0x1C, "lctrl": 0x1D,
    "a": 0x1E, "s": 0x1F, "d": 0x20, "f": 0x21, "g": 0x22, "h": 0x23, "j": 0x24, "k": 0x25,
    "l": 0x26, "semicolon": 0x27, "apostrophe": 0x28, "grave": 0x29, "lshift": 0x2A,
    "backslash": 0x2B, "z": 0x2C, "x": 0x2D, "c": 0x2E, "v": 0x2F, "b": 0x30, "n": 0x31,
    "m": 0x32, "comma": 0x33, "period": 0x34, "slash": 0x35, "rshift": 0x36, "npmultiply": 0x37,
    "lalt": 0x38, "space": 0x39, "capslock": 0x3A, "f1": 0x3B, "f2": 0x3C, "f3": 0x3D,
    "f4": 0x3E, "f5": 0x3F, "f6": 0x40, "f7": 0x41, "f8": 0x42, "f9": 0x43, "f10": 0x44,
    "numlock": 0x45, "scrolllock": 0x46, "np7": 0x47, "np8": 0x48, "np9": 0x49, "npminus": 0x4A,
    "np4": 0x4B, "np5": 0x4C, "np6": 0x4D, "npplus": 0x4E, "np1": 0x4F, "np2": 0x50, "np3": 0x51,
    "np0": 0x52, "npperiod": 0x53, "f11": 0x57, "f12": 0x58,
    "f13": 0x64, "f14": 0x65, "f15": 0x66, "f16": 0x67, "f17": 0x68, "f18": 0x69,
    "f19": 0x6A, "f20": 0x6B, "f21": 0x6C, "f22": 0x6D, "f23": 0x6E, "f24": 0x76,
    # extended keys (E0 prefix)
    "rctrl": 0x1D, "ralt": 0x38, "npenter": 0x1C, "npdivide": 0x35, "insert": 0x52,
    "delete": 0x53, "home": 0x47, "end": 0x4F, "pageup": 0x49, "pagedown": 0x51,
    "up": 0x48, "down": 0x50, "left": 0x4B, "right": 0x4D,
}
EXTENDED = {"rctrl", "ralt", "npenter", "npdivide", "insert", "delete", "home", "end",
            "pageup", "pagedown", "up", "down", "left", "right"}
ALIASES = {"ctrl": "lctrl", "control": "lctrl", "lcontrol": "lctrl", "leftctrl": "lctrl",
           "rcontrol": "rctrl", "rightctrl": "rctrl", "alt": "lalt", "leftalt": "lalt",
           "rightalt": "ralt", "shift": "lshift", "leftshift": "lshift", "rightshift": "rshift",
           "escape": "esc", "return": "enter", "spacebar": "space", "del": "delete", "ins": "insert",
           "pgup": "pageup", "pgdn": "pagedown", "-": "minus", "=": "equals", "[": "lbracket",
           "]": "rbracket", ";": "semicolon", "'": "apostrophe", "`": "grave", "~": "grave",
           ",": "comma", ".": "period", "/": "slash", "\\": "backslash", "lmb": "mouse1",
           "rmb": "mouse2", "mmb": "mouse3"}
MOUSE = {"mouse1": (0x0002, 0x0004), "mouse2": (0x0008, 0x0010), "mouse3": (0x0020, 0x0040)}
VJOY = None  # set by the server to a vjoy.VJoy instance


def vj_button(name):
    m = re.fullmatch(r"vj(\d{1,3})", name)
    return int(m.group(1)) if m and 1 <= int(m.group(1)) <= 128 else None
DEFAULT_TAP = 0.06
MAX_TOTAL = 15.0  # seconds; no macro may run longer than this


def key_name(k):
    k = k.strip().lower().replace(" ", "")
    return ALIASES.get(k, k)


def parse(spec):
    """Turn a macro string into steps. Raises ValueError listing unknown keys."""
    steps, bad, total = [], [], 0.0
    for raw in re.split(r"[;\n]+", spec or ""):
        part = raw.strip()
        if not part:
            continue
        m = re.fullmatch(r"(?:wait|pause|delay)\s*([\d.]+)\s*s?", part, re.I)
        if m:
            secs = min(float(m.group(1)), 5.0)
            steps.append(("wait", secs))
            total += secs
            continue
        hold = DEFAULT_TAP
        if ":" in part:
            part, h = part.rsplit(":", 1)
            try:
                hold = max(0.02, min(float(h.strip().rstrip("s")), 5.0))
            except ValueError:
                bad.append(raw.strip())
                continue
        keys = [key_name(k) for k in part.split("+") if k.strip()]
        unknown = [k for k in keys if k not in SCAN and k not in MOUSE and vj_button(k) is None]
        if unknown or not keys:
            bad.extend(unknown or [raw.strip()])
            continue
        steps.append(("press", keys, hold))
        total += hold
    if bad:
        raise ValueError("Unknown key(s): " + ", ".join(bad))
    if not steps:
        raise ValueError("No keys in macro")
    if total > MAX_TOTAL:
        raise ValueError(f"Macro too long ({total:.1f}s > {MAX_TOTAL:.0f}s)")
    return steps


if IS_WINDOWS:
    from ctypes import wintypes

    ULONG_PTR = ctypes.c_size_t

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]

    _SendInput = ctypes.windll.user32.SendInput
    _SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    _SendInput.restype = wintypes.UINT
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x0001, 0x0002, 0x0008

    def _key(name, up):
        flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0) | (KEYEVENTF_EXTENDEDKEY if name in EXTENDED else 0)
        inp = INPUT(type=1)
        inp.u.ki = KEYBDINPUT(0, SCAN[name], flags, 0, 0)
        _SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

    def _mouse(name, up):
        inp = INPUT(type=0)
        inp.u.mi = MOUSEINPUT(0, 0, 0, MOUSE[name][1 if up else 0], 0, 0)
        _SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
else:
    def _key(name, up):
        pass

    def _mouse(name, up):
        pass


def _send(name, up):
    b = vj_button(name)
    if b is not None:
        if VJOY is None:
            raise RuntimeError("vJoy not available")
        VJOY.set(b, not up)
    elif name in MOUSE:
        _mouse(name, up)
    else:
        _key(name, up)


_run_lock = threading.Lock()


def run(steps):
    """Play steps. One macro at a time; keys are always released, even on error."""
    try:
        _run(steps)
    except Exception as e:
        sys.stderr.write(f"[aria] macro failed: {e}\n")


def _run(steps):
    with _run_lock:
        for step in steps:
            if step[0] == "wait":
                time.sleep(step[1])
                continue
            _, keys, hold = step
            down = []
            try:
                for k in keys:
                    _send(k, False)
                    down.append(k)
                    time.sleep(0.015)
                time.sleep(hold)
            finally:
                for k in reversed(down):
                    _send(k, True)
                    time.sleep(0.015)
            time.sleep(0.03)


def run_async(spec, focus=False):
    """focus=True: bring Star Citizen to the front first (used when you clicked ARIA,
    which took focus away from the game)."""
    steps = parse(spec)  # raise now so the caller gets the error

    def go():
        if focus:
            try:
                import winsys
                winsys.focus_game()
            except Exception as e:
                sys.stderr.write(f"[aria] focus: {e}\n")
        run(steps)
    threading.Thread(target=go, daemon=True).start()
    return steps
