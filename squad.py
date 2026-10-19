"""Squad services: the shared leaderboard and the game lobby.

Used by server.py (when an ARIA hosts the squad) and by squad_server.py (a
standalone host for a box like Thoth that just runs the board and the lobby).
Stdlib only. The lobby is game-agnostic: it keeps a seat list, a seed and an
ordered move log per lobby; the game rules live in the clients, which replay
the log. Clients long-poll /api/lobby/wait for changes.
"""
import json
import os
import secrets
import threading
import time
import urllib.parse

GAMES = {"chess": 2, "tanks": 2, "fleet": 2}  # game id -> players
LOBBY_TTL = 6 * 3600       # open/playing lobbies die after this long untouched
DONE_TTL = 15 * 60         # finished ones linger briefly so the last state is readable
WAIT_MAX = 25              # long-poll ceiling, seconds


class Squad:
    def __init__(self, root, key_fn, name_fn):
        self.root = root
        self.key_fn = key_fn      # () -> squad key
        self.name_fn = name_fn    # () -> host display name
        self.scores_file = os.path.join(root, "scores.json")
        self.lobby_file = os.path.join(root, "lobbies.json")
        self.lock = threading.Lock()
        self.cond = threading.Condition()
        self.lobbies = self._load_lobbies()

    # ---------------- scores ----------------
    def load_scores(self):
        try:
            with open(self.scores_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def add_score(self, game, name, score, extra):
        with self.lock:
            all_ = self.load_scores()
            lst = all_.get(game, [])
            lst.append({"name": str(name)[:12], "score": int(score), "extra": str(extra or "")[:24], "t": int(time.time() * 1000)})
            lst.sort(key=lambda e: (-e["score"], -e["t"]))
            all_[game] = lst[:25]
            with open(self.scores_file, "w", encoding="utf-8") as f:
                json.dump(all_, f, indent=1)
            return all_[game]

    # ---------------- job reports (pilots telling each other what really happened at a terminal) ----------------
    WAITS = {"none", "stock", "queue", "pad", "bugged", "pirates", "other"}

    def _reports_path(self):
        return os.path.join(self.root, "reports.json")

    def load_reports(self):
        try:
            with open(self._reports_path(), "r", encoding="utf-8") as f:
                d = json.load(f)
            return d if isinstance(d, list) else []
        except Exception:
            return []

    @classmethod
    def clean_report(cls, r):
        """Keep only the fields we use, typed and size-capped. Anything odd is dropped, not stored."""
        if not isinstance(r, dict):
            return None
        def num_or_none(v, lo=0, hi=10**9):
            try:
                v = float(v)
            except (TypeError, ValueError):
                return None
            return v if lo <= v <= hi else None
        legs = []
        for l in (r.get("legs") or [])[:12]:
            if not isinstance(l, dict) or l.get("kind") not in ("buy", "sell"):
                continue
            legs.append({"kind": l["kind"], "cid": int(num_or_none(l.get("cid"), 0, 10**7) or 0), "commodity": str(l.get("commodity") or "")[:40],
                         "term": int(num_or_none(l.get("term"), 0, 10**7) or 0), "termName": str(l.get("termName") or "")[:60],
                         "planned": num_or_none(l.get("planned")), "actual": num_or_none(l.get("actual")),
                         "match": l.get("match") if isinstance(l.get("match"), bool) else None,
                         "stock": l.get("stock") if l.get("stock") in ("all", "partial", "none") else None,
                         "scu": num_or_none(l.get("scu"), 0, 10**6)})
        if not legs:
            return None
        return {"id": str(r.get("id") or secrets.token_hex(6))[:24], "t": int(num_or_none(r.get("t"), 0, 10**14) or time.time() * 1000),
                "name": str(r.get("name") or "CMDR")[:12], "legs": legs,
                "waits": [w for w in (r.get("waits") or []) if w in cls.WAITS][:7],
                "minutes": num_or_none(r.get("minutes"), 0, 10000), "profit": num_or_none(r.get("profit"), -10**9, 10**10),
                "note": str(r.get("note") or "")[:200], "ver": str(r.get("ver") or "")[:12]}

    def add_report(self, r):
        r = self.clean_report(r)
        if not r:
            return None
        with self.lock:
            all_ = [x for x in self.load_reports() if x.get("id") != r["id"]]
            all_.append(r)
            all_ = all_[-3000:]  # newest 3000 is plenty
            with open(self._reports_path(), "w", encoding="utf-8") as f:
                json.dump(all_, f)
        return r

    # ---------------- DL99: squad datalink (positions, map marks, text) ----------------
    # Kept in memory: positions expire in 30 s, marks in 12 h, the last 100 messages per net.
    def _net(self, name):
        if not hasattr(self, "_dl"):
            self._dl = {}
        name = (str(name or "DL99").upper().strip() or "DL99")[:16]
        n = self._dl.setdefault(name, {"peers": {}, "marks": {}, "msgs": [], "seq": 0})
        now = time.time()
        n["peers"] = {k: v for k, v in n["peers"].items() if now - v["t"] < 30}
        n["marks"] = {k: v for k, v in n["marks"].items() if now - v["t"] < 12 * 3600}
        return n

    @staticmethod
    def _f(v, lo, hi):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return None
        return v if lo <= v <= hi else None

    def dl(self, payload):
        with self.lock:
            n = self._net(payload.get("net"))
            cs = str(payload.get("callsign") or "CMDR").upper()[:12]
            op = payload.get("op")
            now = time.time()
            if op == "pos":
                p = payload.get("pos") or {}
                lat, lon = self._f(p.get("lat"), -90, 90), self._f(p.get("lon"), -180, 180)
                if lat is not None and lon is not None:
                    n["peers"][cs] = {"callsign": cs, "lat": lat, "lon": lon, "alt": self._f(p.get("alt"), -500, 40000),
                                      "hdg": self._f(p.get("hdg"), -10, 10), "ias": self._f(p.get("ias"), 0, 2000),
                                      "unit": str(p.get("unit") or "")[:32], "t": now}
            elif op == "mark":
                m = payload.get("mark") or {}
                lat, lon = self._f(m.get("lat"), -90, 90), self._f(m.get("lon"), -180, 180)
                if lat is not None and lon is not None and len(n["marks"]) < 300:
                    mid = str(m.get("id") or secrets.token_hex(4))[:16]
                    n["marks"][mid] = {"id": mid, "lat": lat, "lon": lon, "label": str(m.get("label") or "")[:40],
                                       "kind": m.get("kind") if m.get("kind") in ("point", "threat", "target", "friendly") else "point",
                                       "by": cs, "t": now}
            elif op == "unmark":
                n["marks"].pop(str(payload.get("id") or ""), None)
            elif op == "msg":
                text = str(payload.get("text") or "").strip()[:200]
                if text:
                    n["seq"] += 1
                    n["msgs"].append({"n": n["seq"], "by": cs, "text": text, "t": now})
                    n["msgs"] = n["msgs"][-100:]
            since = int(self._f(payload.get("since"), 0, 10**12) or 0)
            return {"peers": [v for k, v in n["peers"].items()], "marks": list(n["marks"].values()),
                    "msgs": [m for m in n["msgs"] if m["n"] > since], "seq": n["seq"], "now": now}

    # ---------------- lobbies ----------------
    def _load_lobbies(self):
        try:
            with open(self.lobby_file, "r", encoding="utf-8") as f:
                d = json.load(f)
            return {k: v for k, v in d.items() if isinstance(v, dict)}
        except Exception:
            return {}

    def _save_lobbies(self):
        try:
            with open(self.lobby_file, "w", encoding="utf-8") as f:
                json.dump(self.lobbies, f)
        except Exception:
            pass

    def _prune(self):
        now = time.time()
        for k in list(self.lobbies):
            L = self.lobbies[k]
            age = now - L.get("upd", L.get("created", now))
            if (L["state"] == "done" and age > DONE_TTL) or age > LOBBY_TTL:
                del self.lobbies[k]

    def _bump(self, L):
        L["v"] = L.get("v", 0) + 1
        L["upd"] = time.time()
        self._save_lobbies()
        self.cond.notify_all()

    @staticmethod
    def public(L, seat=None):
        """What a client sees. Seat tokens stay private."""
        out = {k: v for k, v in L.items() if k != "tokens"}
        out["players"] = [{"seat": p["seat"], "name": p["name"], "left": p.get("left", False)} for p in L["players"]]
        return out

    def list_lobbies(self):
        with self.cond:
            self._prune()
            return [self.public(L) for L in sorted(self.lobbies.values(), key=lambda L: -L["created"]) if L["state"] != "done"]

    def create(self, game, name, opts):
        if game not in GAMES:
            raise ValueError("unknown game")
        with self.cond:
            self._prune()
            lid = secrets.token_hex(3)
            tok = secrets.token_hex(8)
            L = {"id": lid, "game": game, "host": str(name)[:12], "max": GAMES[game], "seed": secrets.randbelow(2**31),
                 "players": [{"seat": 0, "name": str(name)[:12]}], "tokens": {"0": tok}, "moves": [], "state": "open",
                 "opts": {str(k)[:16]: v for k, v in list((opts or {}).items())[:8] if isinstance(v, (int, float, str, bool))},
                 "created": time.time(), "v": 0}
            self.lobbies[lid] = L
            self._bump(L)
            return self.public(L), 0, tok

    def join(self, lid, name):
        with self.cond:
            L = self.lobbies.get(lid)
            if not L:
                raise LookupError("no such lobby")
            # rejoin by name onto a seat that left
            for p in L["players"]:
                if p.get("left") and p["name"] == str(name)[:12]:
                    p["left"] = False
                    tok = secrets.token_hex(8)
                    L["tokens"][str(p["seat"])] = tok
                    self._bump(L)
                    return self.public(L), p["seat"], tok
            if L["state"] != "open" or len(L["players"]) >= L["max"]:
                raise PermissionError("lobby is full")
            seat = len(L["players"])
            tok = secrets.token_hex(8)
            L["players"].append({"seat": seat, "name": str(name)[:12]})
            L["tokens"][str(seat)] = tok
            if len(L["players"]) == L["max"]:
                L["state"] = "playing"
            self._bump(L)
            return self.public(L), seat, tok

    def _auth(self, lid, seat, tok):
        L = self.lobbies.get(lid)
        if not L:
            raise LookupError("no such lobby")
        if L["tokens"].get(str(seat)) != tok:
            raise PermissionError("not your seat")
        return L

    def move(self, lid, seat, tok, m):
        with self.cond:
            L = self._auth(lid, seat, tok)
            if L["state"] == "done":
                raise PermissionError("game over")
            if len(json.dumps(m)) > 4000:
                raise ValueError("move too big")
            L["moves"].append({"s": int(seat), "m": m, "t": int(time.time() * 1000), "n": len(L["moves"])})
            if isinstance(m, dict) and m.get("end"):
                L["state"] = "done"
                L["result"] = m.get("end")
            self._bump(L)
            return self.public(L)

    def leave(self, lid, seat, tok):
        with self.cond:
            L = self._auth(lid, seat, tok)
            for p in L["players"]:
                if p["seat"] == int(seat):
                    p["left"] = True
            if L["state"] == "open" and int(seat) == 0:
                del self.lobbies[lid]
                self._save_lobbies()
                self.cond.notify_all()
                return None
            if all(p.get("left") for p in L["players"]):
                L["state"] = "done"
                L["result"] = L.get("result") or "abandoned"
            self._bump(L)
            return self.public(L)

    def wait(self, lid, v, timeout):
        """Block until the lobby's version passes v (or timeout). Returns the lobby or None."""
        end = time.time() + max(0, min(WAIT_MAX, timeout))
        with self.cond:
            while True:
                L = self.lobbies.get(lid)
                if not L:
                    return None
                if L.get("v", 0) > v:
                    return self.public(L)
                left = end - time.time()
                if left <= 0:
                    return self.public(L)
                self.cond.wait(left)

    # ---------------- HTTP glue ----------------
    def handle(self, method, path, query, payload):
        """Returns (status, obj) for squad endpoints, or None if the path isn't ours.
        `query` is a dict of single values; `payload` the parsed JSON body (POST)."""
        key = self.key_fn() or ""
        if path == "/api/scores":
            if method == "GET":
                if key != (query.get("key") or ""):
                    return 403, {"error": "Wrong squad key."}
                allsc = self.load_scores()
                g = query.get("game")
                return 200, {"scores": {g: allsc.get(g, [])} if g else allsc, "host": self.name_fn()}
            if method == "POST":
                if key != str(payload.get("key") or ""):
                    return 403, {"error": "Wrong squad key."}
                game = str(payload.get("game") or "")[:20]
                try:
                    score = int(payload.get("score"))
                except (TypeError, ValueError):
                    return 400, {"error": "bad score"}
                if not game or score <= 0 or score > 10**9:
                    return 400, {"error": "bad score"}
                return 200, {"ok": True, "scores": self.add_score(game, payload.get("name") or "CMDR", score, payload.get("extra"))}
        if path == "/api/reports":
            k = query.get("key") if method == "GET" else str(payload.get("key") or "")
            if key != (k or ""):
                return 403, {"error": "Wrong squad key."}
            if method == "GET":
                since = int(query.get("since") or 0)
                return 200, {"reports": [r for r in self.load_reports() if r.get("t", 0) > since], "host": self.name_fn()}
            r = self.add_report(payload.get("report"))
            return (200, {"ok": True, "id": r["id"]}) if r else (400, {"error": "empty report"})
        if path == "/api/dl":
            src = query if method == "GET" else payload
            if key != str(src.get("key") or ""):
                return 403, {"error": "Wrong squad key."}
            return 200, self.dl(src if method == "POST" else dict(query))
        if path.startswith("/api/lobby"):
            k = query.get("key") if method == "GET" else str(payload.get("key") or "")
            if key != (k or ""):
                return 403, {"error": "Wrong squad key."}
            try:
                if method == "GET" and path == "/api/lobby":
                    return 200, {"lobbies": self.list_lobbies(), "host": self.name_fn(), "games": GAMES}
                if method == "GET" and path == "/api/lobby/wait":
                    L = self.wait(query.get("id") or "", int(query.get("v") or 0), float(query.get("t") or WAIT_MAX))
                    return (200, {"lobby": L}) if L else (404, {"error": "lobby is gone"})
                if method == "POST" and path == "/api/lobby":
                    act = payload.get("action")
                    name = str(payload.get("name") or "CMDR")[:12]
                    if act == "create":
                        L, seat, tok = self.create(str(payload.get("game") or ""), name, payload.get("opts") or {})
                        return 200, {"ok": True, "lobby": L, "seat": seat, "token": tok}
                    if act == "join":
                        L, seat, tok = self.join(str(payload.get("id") or ""), name)
                        return 200, {"ok": True, "lobby": L, "seat": seat, "token": tok}
                    if act == "move":
                        L = self.move(str(payload.get("id") or ""), int(payload.get("seat")), str(payload.get("token") or ""), payload.get("move"))
                        return 200, {"ok": True, "lobby": L}
                    if act == "leave":
                        L = self.leave(str(payload.get("id") or ""), int(payload.get("seat")), str(payload.get("token") or ""))
                        return 200, {"ok": True, "lobby": L}
                    return 400, {"error": "unknown action"}
            except LookupError as e:
                return 404, {"error": str(e)}
            except PermissionError as e:
                return 403, {"error": str(e)}
            except (ValueError, TypeError) as e:
                return 400, {"error": str(e) or "bad request"}
        return None


def parse_query(path):
    u = urllib.parse.urlsplit(path)
    return u.path, {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
