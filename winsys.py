"""
Windows desktop helpers for ARIA (ctypes only):
  monitors()      list screens with their names (e.g. "HP 2159m") and pixel rectangles
  move_aria(r)    put ARIA's app window on a screen
  focus_game()    hand keyboard focus back to Star Citizen before ARIA sends keys
"""
import ctypes
import sys
import time

IS_WINDOWS = sys.platform.startswith("win")

if IS_WINDOWS:
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    try:  # real pixels on every monitor, whatever the Windows scaling
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass

    class MONITORINFOEXW(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD), ("szDevice", ctypes.c_wchar * 32)]

    class DISPLAY_DEVICEW(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("DeviceName", ctypes.c_wchar * 32), ("DeviceString", ctypes.c_wchar * 128),
                    ("StateFlags", wintypes.DWORD), ("DeviceID", ctypes.c_wchar * 128), ("DeviceKey", ctypes.c_wchar * 128)]

    MonitorEnumProc = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)


def monitors():
    if not IS_WINDOWS:
        return []
    out = []

    def cb(hmon, hdc, rect, lp):
        mi = MONITORINFOEXW()
        mi.cbSize = ctypes.sizeof(mi)
        user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
        r = mi.rcMonitor
        name = ""
        dd = DISPLAY_DEVICEW()
        dd.cb = ctypes.sizeof(dd)
        if user32.EnumDisplayDevicesW(mi.szDevice, 0, ctypes.byref(dd), 0):
            name = dd.DeviceString
        out.append({"device": mi.szDevice, "name": name or mi.szDevice, "x": r.left, "y": r.top,
                    "w": r.right - r.left, "h": r.bottom - r.top, "primary": bool(mi.dwFlags & 1)})
        return 1

    user32.EnumDisplayMonitors(None, None, MonitorEnumProc(cb), 0)
    for i, m in enumerate(out):
        m["index"] = i
    return out


def find_monitor(device):
    for m in monitors():
        if m["device"] == device:
            return m
    return None


def _windows(match):
    found = []

    def cb(hwnd, lp):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if match(buf.value):
                found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def move_aria(m):
    """Restore ARIA's window and drop it onto monitor m (a dict from monitors())."""
    if not IS_WINDOWS or not m:
        return False
    wins = _windows(lambda t: "Quartermaster" in t)
    for hwnd in wins:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetWindowPos(hwnd, 0, m["x"], m["y"], m["w"], m["h"], 0x0004 | 0x0040)  # NOZORDER | SHOWWINDOW
    return bool(wins)


def place_aria(x, y, w, h):
    """Put ARIA's window at an exact desktop rectangle (used to leave room for DCS viewports)."""
    if not IS_WINDOWS:
        return False
    wins = _windows(lambda t: "Quartermaster" in t)
    for hwnd in wins:
        user32.ShowWindow(hwnd, 9)
        user32.SetWindowPos(hwnd, 0, int(x), int(y), int(w), int(h), 0x0004 | 0x0040)
    return bool(wins)


def focus_game():
    """Bring Star Citizen to the front so the next key presses land in the game.
    Windows only lets a background process change focus right after input, so a
    lone Alt tap (harmless) is sent first — the usual trick tools like this use."""
    if not IS_WINDOWS:
        return False
    wins = _windows(lambda t: t.strip().lower().startswith("star citizen"))
    if not wins:
        return False
    hwnd = wins[0]
    if user32.GetForegroundWindow() == hwnd:
        return True
    user32.keybd_event(0x12, 0, 0, 0)       # Alt down
    user32.keybd_event(0x12, 0, 0x0002, 0)  # Alt up
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.08)
    return user32.GetForegroundWindow() == hwnd
