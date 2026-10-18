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
