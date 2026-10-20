"""Where am I? — ask Star Citizen with /showlocation and read the answer off the clipboard.

/showlocation is a chat command: the game copies your coordinates to the Windows clipboard.
ARIA opens chat, types it, sends it, reads the clipboard, then puts back whatever you had
copied before. Pure input automation — the same thing a macro does. No memory reading.

The keys used are configurable (config.json "locate_keys"), default: Enter to open chat,
the command pasted (Ctrl+V — never typed, so nothing leaks onto ship binds), Enter to send.
"""
import ctypes
import re
import sys
import threading
import time

import keys

IS_WINDOWS = sys.platform.startswith("win")
_lock = threading.Lock()
DEFAULT_OPEN = "enter"
DEFAULT_SEND = "enter"
COMMAND = "/showlocation"

if IS_WINDOWS:
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002
    user32.GetClipboardData.restype = wintypes.HANDLE
    user32.SetClipboardData.argtypes = (wintypes.UINT, wintypes.HANDLE)
    user32.SetClipboardData.restype = wintypes.HANDLE
    user32.GetClipboardSequenceNumber.restype = wintypes.DWORD
    kernel32.GlobalLock.argtypes = (wintypes.HGLOBAL,)
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = (wintypes.HGLOBAL,)
    kernel32.GlobalAlloc.argtypes = (wintypes.UINT, ctypes.c_size_t)
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL


def _open_clip():
    for _ in range(20):
        if user32.OpenClipboard(None):
            return True
        time.sleep(0.02)
    return False


def get_clipboard():
    if not IS_WINDOWS or not _open_clip():
        return None
    try:
        h = user32.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return None
        p = kernel32.GlobalLock(h)
        try:
            return ctypes.wstring_at(p) if p else None
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


def set_clipboard(text):
    if not IS_WINDOWS or text is None or not _open_clip():
        return False
    try:
        user32.EmptyClipboard()
        data = ctypes.create_unicode_buffer(text)
        size = ctypes.sizeof(data)
        h = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, data, size)
        kernel32.GlobalUnlock(h)
        user32.SetClipboardData(CF_UNICODETEXT, h)
        return True
    finally:
        user32.CloseClipboard()


def parse(text):
    """'Coordinates: x:-18930539540.39 y:-2610158765.42 z:0.00' (and close variants) -> (x, y, z) in metres."""
    if not text:
        return None
    vals = {}
    for axis in "xyz":
        m = re.search(r"\b" + axis + r"\s*[:=]\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)", text, re.I)
        if m:
            vals[axis] = float(m.group(1))
    return (vals["x"], vals["y"], vals["z"]) if len(vals) == 3 else None


def _type_text(s):
    for ch in s:
        name = keys.key_name(ch) if hasattr(keys, "key_name") else ch
        keys._send(name, False); time.sleep(0.012)
        keys._send(name, True); time.sleep(0.012)


def locate(cfg=None):
    """-> {"ok", "x","y","z", "raw"} or {"ok": False, "error"}. Blocking, ~1 s."""
    cfg = cfg or {}
    if not IS_WINDOWS:
        return {"ok": False, "error": "Locating needs ARIA running on Windows with Star Citizen open."}
    import winsys
    with _lock:
        if not winsys.focus_game():
            return {"ok": False, "error": "Star Citizen isn't running (or its window couldn't be brought forward)."}
        before = get_clipboard()
        # The command goes in by PASTE, not typed letter by letter: if the chat box isn't open yet,
        # typed letters land on your ship binds (S, H, O, W, L, C, A, T, I, N … lights, gear, power,
        # quantum). A stray Ctrl+V does nothing in flight.
        set_clipboard(COMMAND)
        time.sleep(0.05)
        keys.run(keys.parse(cfg.get("locate_open") or DEFAULT_OPEN))
        time.sleep(0.35)  # give the chat box time to take focus
        keys.run(keys.parse("lctrl+v"))
        time.sleep(0.08)
        seq = user32.GetClipboardSequenceNumber()  # anything after this is the game's answer
        keys.run(keys.parse(cfg.get("locate_send") or DEFAULT_SEND))
        text = None
        for _ in range(30):  # up to ~1.5 s for the game to write the clipboard
            time.sleep(0.05)
            if user32.GetClipboardSequenceNumber() != seq:
                text = get_clipboard()
                if text and parse(text):
                    break
        xyz = parse(text)
        if before is not None:
            set_clipboard(before)  # give you back what you had copied
        if not xyz:
            return {"ok": False, "error": "The game didn't put coordinates on the clipboard. Is chat on Enter? (Settings → Assistant → Locate keys)",
                    "raw": (text or "")[:200]}
        return {"ok": True, "x": xyz[0], "y": xyz[1], "z": xyz[2], "raw": text[:200]}
