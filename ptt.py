"""
Push-to-talk for ARIA.

Watches one keyboard key, mouse side button or joystick/HOTAS button system-wide
(it works while Star Citizen has focus) and reports when it is held, so ARIA
only listens while you hold it. Standard library only (ctypes, Windows).

Keyboard and mouse: GetAsyncKeyState. Joysticks: winmm joyGetPosEx, which sees
up to 16 devices and the first 32 buttons on each.
"""
import ctypes
import sys
import threading
import time

IS_WINDOWS = sys.platform.startswith("win")

VK_NAMES = {0x04: "Mouse middle", 0x05: "Mouse 4", 0x06: "Mouse 5", 0x08: "Backspace", 0x09: "Tab",
            0x0D: "Enter", 0x14: "Caps Lock", 0x20: "Space", 0x21: "Page Up", 0x22: "Page Down",
            0x23: "End", 0x24: "Home", 0x25: "Left", 0x26: "Up", 0x27: "Right", 0x28: "Down",
            0x2D: "Insert", 0x2E: "Delete", 0xA0: "Left Shift", 0xA1: "Right Shift",
            0xA2: "Left Ctrl", 0xA3: "Right Ctrl", 0xA4: "Left Alt", 0xA5: "Right Alt",
            0xC0: "`", 0xBA: ";", 0xBB: "=", 0xBC: ",", 0xBD: "-", 0xBE: ".", 0xBF: "/",
            0xDB: "[", 0xDC: "\\", 0xDD: "]", 0xDE: "'"}
for i in range(26):
    VK_NAMES[0x41 + i] = chr(0x41 + i)
for i in range(10):
    VK_NAMES[0x30 + i] = str(i)
    VK_NAMES[0x60 + i] = f"Numpad {i}"
for i in range(24):
    VK_NAMES[0x70 + i] = f"F{i + 1}"
# never learn the generic modifier codes (the left/right specific ones are used) or left/right click
SKIP_VK = {0x01, 0x02, 0x10, 0x11, 0x12}


def vk_label(vk):
    return VK_NAMES.get(vk, f"Key 0x{vk:02X}")


class _Win:
    def __init__(self):
        from ctypes import wintypes
        self.user32 = ctypes.windll.user32
        self.user32.GetAsyncKeyState.restype = ctypes.c_short
        self.winmm = ctypes.windll.winmm

        class JOYINFOEX(ctypes.Structure):
            _fields_ = [(n, wintypes.DWORD) for n in (
                "dwSize", "dwFlags", "dwXpos", "dwYpos", "dwZpos", "dwRpos", "dwUpos", "dwVpos",
                "dwButtons", "dwButtonNumber", "dwPOV", "dwReserved1", "dwReserved2")]
        self.JOYINFOEX = JOYINFOEX

    def key_down(self, vk):
        return bool(self.user32.GetAsyncKeyState(vk) & 0x8000)

    def joy_buttons(self, jid):
        info = self.JOYINFOEX()
        info.dwSize = ctypes.sizeof(info)
        info.dwFlags = 0xFF  # JOY_RETURNALL
        if self.winmm.joyGetPosEx(jid, ctypes.byref(info)) != 0:
            return None
        return info.dwButtons


class PTT:
    def __init__(self, binding=None, on_learn=None):
        self.binding = binding or None      # {"kind": "key", "vk": 71, "label": "G"} | {"kind": "joy", "joy": 0, "button": 5, "label": ...}
        self.on_learn = on_learn
        self.down = False
        self.seq = 0                       # increments on every press
        self.learning = False
        self.cond = threading.Condition()
        self.available = IS_WINDOWS
        self._w = _Win() if IS_WINDOWS else None
        self._joys = []
        self._last_scan = 0
        if IS_WINDOWS:
            threading.Thread(target=self._loop, daemon=True).start()

    def state(self):
        return {"available": self.available, "binding": self.binding, "down": self.down,
                "seq": self.seq, "learning": self.learning}

    def learn(self):
        with self.cond:
            self.learning = True
            self.cond.notify_all()

    def clear(self):
        with self.cond:
            self.binding = None
            self.learning = False
            self._set(False)
            self.cond.notify_all()

    def wait(self, seq_seen, down_seen, timeout=15):
        """Block until state differs from what the caller last saw."""
        with self.cond:
            self.cond.wait_for(lambda: self.seq != seq_seen or self.down != down_seen or self.learning, timeout)
            return self.state()

    # ---- internals ----
    def _set(self, d):
        if d != self.down:
            self.down = d
            if d:
                self.seq += 1
            self.cond.notify_all()

    def _scan_joys(self):
        now = time.time()
        if now - self._last_scan > 3:
            self._last_scan = now
            self._joys = [j for j in range(16) if self._w.joy_buttons(j) is not None]

    def _held_inputs(self):
        held = [("key", vk) for vk in range(0x04, 0xFF) if vk not in SKIP_VK and self._w.key_down(vk)]
        for j in self._joys:
            b = self._w.joy_buttons(j)
            if b:
                held += [("joy", (j, i + 1)) for i in range(32) if b & (1 << i)]
        return held

    def _loop(self):
        baseline = None
        while True:
            try:
                self._scan_joys()
                if self.learning:
                    held = set(self._held_inputs())
                    if baseline is None:
                        baseline = held          # ignore whatever was already held when learning began
                    new = held - baseline
                    if new:
                        kind, val = sorted(new, key=lambda x: x[0] != "joy")[0]  # prefer a HOTAS button if both
                        if kind == "key":
                            b = {"kind": "key", "vk": val, "label": vk_label(val)}
                        else:
                            b = {"kind": "joy", "joy": val[0], "button": val[1], "label": f"Joystick {val[0] + 1} · button {val[1]}"}
                        with self.cond:
                            self.binding, self.learning = b, False
                            self.cond.notify_all()
                        baseline = None
                        if self.on_learn:
                            self.on_learn(b)
                        time.sleep(0.4)  # let the learning press finish before it counts as talk
                    baseline = held if not new else None
                    time.sleep(0.02)
                    continue
                baseline = None
                b = self.binding
                d = False
                if b and b.get("kind") == "key":
                    d = self._w.key_down(int(b["vk"]))
                elif b and b.get("kind") == "joy":
                    btns = self._w.joy_buttons(int(b["joy"]))
                    d = bool(btns and btns & (1 << (int(b["button"]) - 1)))
                with self.cond:
                    self._set(d)
            except Exception as e:  # never let the watcher die
                sys.stderr.write(f"[aria] ptt: {e}\n")
                time.sleep(1)
            time.sleep(0.02)
