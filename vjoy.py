"""
vJoy virtual joystick for ARIA.

vJoy is a free driver that adds a fake joystick to Windows. ARIA presses its
buttons for actions it binds itself, so none of your real keys or HOTAS buttons
are used. Star Citizen sees it as one more joystick (js1, js2, js3 …).

Setup (once):
  1. Install vJoy (github.com/BrunnerInnovation/vJoy, or the original vJoy 2.x).
  2. Run "Configure vJoy", enable device 1 and set Number of Buttons to 128.
  3. Start Star Citizen once so it sees the new device.

Uses vJoyInterface.dll from the vJoy install (ctypes, no Python packages).
"""
import ctypes
import os
import sys
import threading

IS_WINDOWS = sys.platform.startswith("win")
STATUS = {0: "owned", 1: "free", 2: "busy (another program has it)", 3: "missing (not enabled in Configure vJoy)", 4: "unknown"}


def _dll_paths():
    pf = [os.environ.get(v) for v in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)")]
    for base in filter(None, pf):
        for sub in ("x64", "x86", ""):
            yield os.path.join(base, "vJoy", sub, "vJoyInterface.dll")
    yield "vJoyInterface.dll"  # anywhere on PATH


class VJoy:
    def __init__(self, device=1):
        self.device = int(device or 1)
        self.dll = None
        self.error = None
        self.lock = threading.Lock()
        self._owned = False
        if not IS_WINDOWS:
            self.error = "vJoy needs Windows."
            return
        for p in _dll_paths():
            try:
                if p != "vJoyInterface.dll" and not os.path.exists(p):
                    continue
                self.dll = ctypes.WinDLL(p)
                break
            except OSError:
                continue
        if not self.dll:
            self.error = "vJoy isn't installed (vJoyInterface.dll not found)."
            return
        d = self.dll
        d.vJoyEnabled.restype = ctypes.c_bool
        d.GetVJDStatus.argtypes = [ctypes.c_uint]; d.GetVJDStatus.restype = ctypes.c_int
        d.AcquireVJD.argtypes = [ctypes.c_uint]; d.AcquireVJD.restype = ctypes.c_bool
        d.RelinquishVJD.argtypes = [ctypes.c_uint]; d.RelinquishVJD.restype = None
        d.SetBtn.argtypes = [ctypes.c_bool, ctypes.c_uint, ctypes.c_ubyte]; d.SetBtn.restype = ctypes.c_bool
        d.ResetButtons.argtypes = [ctypes.c_uint]; d.ResetButtons.restype = ctypes.c_bool
        d.GetVJDButtonNumber.argtypes = [ctypes.c_uint]; d.GetVJDButtonNumber.restype = ctypes.c_int
        if not d.vJoyEnabled():
            self.error = "vJoy is installed but disabled. Open Configure vJoy and enable it."
            self.dll = None

    def status(self):
        if not self.dll:
            return {"ok": False, "device": self.device, "buttons": 0, "error": self.error}
        st = self.dll.GetVJDStatus(self.device)
        buttons = self.dll.GetVJDButtonNumber(self.device) if st in (0, 1) else 0
        ok = st in (0, 1) and buttons > 0
        err = None if ok else f"vJoy device {self.device} is {STATUS.get(st, st)}." if st not in (0, 1) else \
            f"vJoy device {self.device} has 0 buttons — set Number of Buttons to 128 in Configure vJoy."
        return {"ok": ok, "device": self.device, "buttons": buttons, "error": err}

    def _acquire(self):
        if self._owned:
            return True
        if self.dll and self.dll.AcquireVJD(self.device):
            self.dll.ResetButtons(self.device)
            self._owned = True
        return self._owned

    def set(self, button, down):
        with self.lock:
            if not self.dll or not self._acquire():
                raise RuntimeError(self.error or f"Can't take control of vJoy device {self.device}.")
            self.dll.SetBtn(bool(down), self.device, int(button))
