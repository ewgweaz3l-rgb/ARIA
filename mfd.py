"""
Thrustmaster Cougar MFDs for ARIA.

Each Cougar MFD shows up in Windows as its own joystick with 28 buttons:
OSB 1-20 around the frame (clockwise from top-left: top row left->right,
right column top->bottom, bottom row right->left, left column bottom->top)
and four rockers (buttons 21-28). This module watches both MFDs system-wide
(Star Citizen keeps focus) and hands button presses to the page as events.

Detection: by USB id (Thrustmaster 044F, MFD 1 = B351 left, MFD 2 = B352 right),
or press-to-learn if Windows reports them differently.
Standard library only (ctypes / winmm).
"""
import ctypes
import sys
import threading
import time
from collections import deque

IS_WINDOWS = sys.platform.startswith("win")
TM_VID = 0x044F
MFD_PIDS = {0xB351: "L", 0xB352: "R"}


class _Joy:
    def __init__(self):
        from ctypes import wintypes
        self.winmm = ctypes.windll.winmm

        class JOYINFOEX(ctypes.Structure):
            _fields_ = [(n, wintypes.DWORD) for n in (
                "dwSize", "dwFlags", "dwXpos", "dwYpos", "dwZpos", "dwRpos", "dwUpos", "dwVpos",
                "dwButtons", "dwButtonNumber", "dwPOV", "dwReserved1", "dwReserved2")]

        class JOYCAPSW(ctypes.Structure):
            _fields_ = [("wMid", wintypes.WORD), ("wPid", wintypes.WORD), ("szPname", ctypes.c_wchar * 32)] + \
                       [(n, wintypes.UINT) for n in ("wXmin", "wXmax", "wYmin", "wYmax", "wZmin", "wZmax", "wNumButtons",
                                                      "wPeriodMin", "wPeriodMax", "wRmin", "wRmax", "wUmin", "wUmax",
                                                      "wVmin", "wVmax", "wCaps", "wMaxAxes", "wNumAxes", "wMaxButtons")] + \
                       [("szRegKey", ctypes.c_wchar * 32), ("szOEMVxD", ctypes.c_wchar * 260)]
        self.JOYINFOEX, self.JOYCAPSW = JOYINFOEX, JOYCAPSW

    def buttons(self, jid):
        info = self.JOYINFOEX()
        info.dwSize = ctypes.sizeof(info)
        info.dwFlags = 0xFF
        return info.dwButtons if self.winmm.joyGetPosEx(jid, ctypes.byref(info)) == 0 else None

    def caps(self, jid):
        c = self.JOYCAPSW()
        if self.winmm.joyGetDevCapsW(jid, ctypes.byref(c), ctypes.sizeof(c)) != 0:
            return None
        return {"vid": c.wMid, "pid": c.wPid, "name": c.szPname, "buttons": c.wNumButtons}


class MFDs:
    def __init__(self, assign=None, on_change=None):
        self.assign = {"L": None, "R": None}
        self.assign.update({k: v for k, v in (assign or {}).items() if k in ("L", "R")})
        self.on_change = on_change
        self.available = IS_WINDOWS
        self.events = deque(maxlen=200)
        self.seq = 0
        self.learning = None
        self.detected = {}
        self.cond = threading.Condition()
        self._j = _Joy() if IS_WINDOWS else None
        self._prev = {}
        if IS_WINDOWS:
            self._autodetect()
            threading.Thread(target=self._loop, daemon=True).start()

    def state(self):
        return {"available": self.available, "assign": self.assign, "learning": self.learning,
                "detected": self.detected, "seq": self.seq}

    def learn(self, side):
        with self.cond:
            self.learning = side
            self.cond.notify_all()

    def inject(self, side, btn, down=True):
        """Test hook: behave as if a button was pressed."""
        with self.cond:
            self._push(side, btn, down)

    def wait(self, after, timeout=15):
        with self.cond:
            self.cond.wait_for(lambda: self.seq > after or self.learning, timeout)
            evs = [e for e in self.events if e["seq"] > after]
            return evs, self.seq

    # ---- internals ----
    def _push(self, side, btn, down):
        self.seq += 1
        self.events.append({"seq": self.seq, "side": side, "btn": btn, "down": down, "t": time.time()})
        self.cond.notify_all()

    def _autodetect(self):
        for j in range(16):
            c = self._j.caps(j)
            if not c or self._j.buttons(j) is None:
                continue
            side = MFD_PIDS.get(c["pid"]) if c["vid"] == TM_VID else None
            if side:
                self.detected[side] = j
                # Windows renumbers joysticks when USB devices come and go: a saved number can end up pointing at a
                # different device (or nothing) and that MFD goes dead. The Cougar's own ID wins over a stale number.
                cur = self.assign.get(side)
                cc = self._j.caps(cur) if cur is not None and self._j.buttons(cur) is not None else None
                is_cougar = bool(cc and cc["vid"] == TM_VID and cc["pid"] in MFD_PIDS)
                if cc is None or is_cougar:  # missing, or another Cougar slot: use the one that IS this side's Cougar
                    self.assign[side] = j  # (a non-Cougar device you taught by hand is left alone)

    def _loop(self):
        baseline = {}
        last_scan = 0
        joys = []
        while True:
            try:
                now = time.time()
                if now - last_scan > 3:
                    last_scan = now
                    joys = [j for j in range(16) if self._j.buttons(j) is not None]
                    if any(self.assign.get(sd) not in joys for sd in ("L", "R")):  # an MFD vanished / was renumbered
                        before = dict(self.assign)
                        try:
                            self._autodetect()
                        except Exception:
                            pass
                        if self.assign != before and self.on_change:
                            self.on_change(dict(self.assign))
                if self.learning:
                    side = self.learning
                    hit = None
                    for j in joys:
                        b = self._j.buttons(j) or 0
                        if j in baseline and b & ~baseline[j]:
                            hit = j
                        baseline[j] = b
                    if hit is not None:
                        with self.cond:
                            other = "R" if side == "L" else "L"
                            if self.assign.get(other) == hit:
                                self.assign[other] = None
                            self.assign[side] = hit
                            self.learning = None
                            self._prev[hit] = self._j.buttons(hit) or 0
                            self.cond.notify_all()
                        if self.on_change:
                            self.on_change(dict(self.assign))
                    time.sleep(0.02)
                    continue
                baseline = {}
                for side in ("L", "R"):
                    j = self.assign.get(side)
                    if j is None:
                        continue
                    b = self._j.buttons(int(j))
                    if b is None:
                        continue
                    prev = self._prev.get(j, b)
                    diff = b ^ prev
                    if diff:
                        with self.cond:
                            for i in range(32):
                                if diff & (1 << i):
                                    self._push(side, i + 1, bool(b & (1 << i)))
                    self._prev[j] = b
            except Exception as e:
                sys.stderr.write(f"[aria] mfd: {e}\n")
                time.sleep(1)
            time.sleep(0.015)
