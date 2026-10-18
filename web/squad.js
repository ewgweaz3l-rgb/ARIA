/* squad.js — squad lobby + versus games for ARIA's GAME page.
   Lobby: the squad host (an ARIA with "Host" ticked, or squad_server.py on a box like
   Thoth) keeps a seat list, a seed and an ordered move log per lobby. Clients never apply
   their own move locally — every move, theirs included, comes back from the log, so both
   screens always replay the same sequence. Games: CHESS (friend), TANKS, FLEET. The last
   two also play solo vs ARIA. No credits, no wagers — bragging rights on the squad board. */

/* ---------------- seeded RNG (both players must generate the same world) ---------------- */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------------- lobby client ---------------- */
const LOBBY = {
  id: null, seat: null, token: null, lob: null, list: [], listT: 0, err: '', side: null, applied: 0, started: false, polling: false, scored: false, opp: 'FRIEND',
  game() { return this.lob ? this.lob.game : null; },
  mine() { return this.lob ? (this.lob.players.find(p => p.seat === this.seat) || {}) : {}; },
  other() { return this.lob ? (this.lob.players.find(p => p.seat !== this.seat && !p.left) || this.lob.players.find(p => p.seat !== this.seat)) : null; },
  save() { store.set('lobbyCur', this.id ? {id: this.id, seat: this.seat, token: this.token, url: SQUAD.url()} : null); },
  async api(method, path, body) {
    const u = SQUAD.url() + path + (method === 'GET' ? (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(SQUAD.key()) : '');
    const r = await fetch(u, method === 'GET' ? {cache: 'no-store'} : {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: SQUAD.key(), ...body})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  },
  async refresh() {
    if (!SQUAD.on()) return;
    try { const j = await this.api('GET', '/api/lobby'); this.list = j.lobbies || []; this.err = ''; } catch (e) { this.err = e.message; }
    this.listT = Date.now();
  },
  async host(game) {
    try { const j = await this.api('POST', '/api/lobby', {action: 'create', game, name: PILOT()}); this.enter(j); toast(`Hosting ${game.toUpperCase()} — waiting for a squad mate.`); }
    catch (e) { this.err = e.message; toast('Lobby: ' + e.message); }
    mfdRenderAll();
  },
  async join(id) {
    try { const j = await this.api('POST', '/api/lobby', {action: 'join', id, name: PILOT()}); this.enter(j); }
    catch (e) { this.err = e.message; toast('Lobby: ' + e.message); }
    mfdRenderAll();
  },
  enter(j) { this.id = j.lobby.id; this.seat = j.seat; this.token = j.token; this.applied = 0; this.started = false; this.scored = false; this.save(); this.onLob(j.lobby); this.loop(); },
  async leave(silent) {
    const id = this.id, seat = this.seat, token = this.token;
    this.id = null; this.lob = null; this.started = false; this.save();
    if (id) { try { await this.api('POST', '/api/lobby', {action: 'leave', id, seat, token}); } catch {} }
    if (!silent) toast('Left the lobby.');
    if (CH.vs) { CH.vs = null; CH.st = null; chLoad(); }
    if (ARC.game && ARC.game.vs) arcStop();
    if (ARC.id !== 'menu') ARC.id = 'lobby';
    this.refresh().then(mfdRenderAll); mfdRenderAll();
  },
  async send(move) {
    if (!this.id || (this.lob && this.lob.state === 'done')) return;
    try { await this.api('POST', '/api/lobby', {action: 'move', id: this.id, seat: this.seat, token: this.token, move}); this.err = ''; }
    catch (e) { this.err = e.message; toast('Move failed: ' + e.message); if (CH.vs) CH.pending = false; if (ARC.game) ARC.game.waiting = false; mfdRenderAll(); }
  },
  async loop() {
    if (this.polling) return; this.polling = true;
    while (this.id) {
      const id = this.id, v = this.lob ? this.lob.v : 0;
      try {
        const j = await this.api('GET', `/api/lobby/wait?id=${id}&v=${v}&t=25`);
        if (this.id !== id) break;
        if (j.lobby) this.onLob(j.lobby);
        this.err = '';
      } catch (e) {
        if (this.id !== id) break;
        this.err = e.message;
        if (/gone|no such/.test(e.message)) { toast('The lobby closed.'); this.leave(true); break; }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    this.polling = false;
  },
  alive() { const g = this.game(); return g === 'chess' ? !!CH.vs : !!(ARC.game && ARC.game.vs); },
  onLob(L) {
    const prevN = this.lob ? this.lob.players.length : 0, prevM = this.lob ? this.lob.moves.length : 0;
    this.lob = L;
    const o = this.other(); this.opp = o ? o.name : 'FRIEND';
    if (L.players.length > prevN && prevN > 0 && this.seat === 0) say(`${this.opp} joined.`);
    if (this.started && !this.alive()) { this.started = false; this.away = true; }  // MFD moved off the game: replay the log when they come back
    if (this.away && L.moves.length > prevM && L.state !== 'done') { toast(`${this.opp} moved in ${L.game.toUpperCase()} — GAME → SQUAD → PLAY.`); }
    if (L.state !== 'open' && !this.started && !this.away) this.start();
    if (this.started) {
      for (const mv of L.moves.slice(this.applied)) { this.dispatch(mv.m, mv.s); this.applied++; }
      if (L.state === 'done' && !this.scored) { this.scored = true; this.finish(L.result || ''); }
    }
    mfdRenderAll();
  },
  start() {
    this.started = true; this.applied = 0; this.away = false;
    const side = this.side || ARC.side || MFDS.soi || 'L';
    if (MFDS[side].page !== 'GAME') mfdGo(side, 'GAME');
    const g = this.game(), vs = {seat: this.seat, seed: this.lob.seed, opp: this.opp};
    if (g === 'chess') { ARC.id = 'chess'; store.set('arcGame', 'chess'); chessVsStart(vs); arcStart('chess', side); }
    else { ARC.vs = vs; arcStart(g, side); }
    if (this.lob.moves.length === 0 && !this.scored) say(`${this.opp} is here. ${g === 'chess' ? (this.seat === 0 ? 'You are white.' : 'You are black.') : 'Good hunting.'}`);
  },
  dispatch(m, seat) {
    if (m && m.end) return;  // handled by finish() when the server marks the lobby done
    if (this.game() === 'chess') chessVsMove(m, seat);
    else if (ARC.game && ARC.game.remote) ARC.game.remote(m, seat);
  },
  finish(result) {
    const [kind, who] = String(result).split(':');
    const winner = kind === 'resign' || kind === 'left' ? 1 - +who : kind === 'win' ? +who : kind === 'draw' ? -1 : null;
    const g = this.game();
    if (g === 'chess') chessVsEnd(kind, winner);
    else if (ARC.game && ARC.game.vsEnd) ARC.game.vsEnd(kind, winner);
    if (winner === this.seat) say(kind === 'resign' ? `${this.opp} resigned. Victory.` : 'Victory, Commander.');
    else if (winner !== null && winner >= 0) say('Defeated. Rematch when ready.');
  },
  resign() { if (this.id && this.lob && this.lob.state === 'playing') this.send({end: 'resign:' + this.seat}); },
  resume() {  // page reload mid-game: pick the lobby back up and replay the log
    const c = store.get('lobbyCur', null);
    if (!c || !SQUAD.on() || c.url !== SQUAD.url()) return;
    this.id = c.id; this.seat = c.seat; this.token = c.token; this.applied = 0; this.started = false; this.lob = null; this.loop();
  }
};
setTimeout(() => LOBBY.resume(), 3500);

function lobbyPage(side, common) {
  LOBBY.side = side;
  const o = {...common, 1: {l: 'GAMES', fn: () => arcStart('menu', side)}};
  if (!SQUAD.on()) return {title: 'GAME', osb: o, body: `<div class="mbig sm">SQUAD</div><div class="mnote">NO SQUAD LINKED<br>SETTINGS ⚙ → SQUAD → HOST OR JOIN</div>`};
  if (Date.now() - LOBBY.listT > 8000 && !LOBBY.id) { LOBBY.listT = Date.now(); LOBBY.refresh().then(() => mfdRender(side)); }
  o[2] = {l: 'RFRSH', fn: () => { LOBBY.listT = 0; mfdRender(side); }};
  let body;
  if (LOBBY.id && LOBBY.lob) {
    const L = LOBBY.lob, playing = L.state === 'playing';
    o[9] = {l: 'LEAVE', fn: () => LOBBY.leave()};
    if (playing || L.state === 'done') o[10] = {l: 'PLAY', fn: () => { if (!LOBBY.started || !LOBBY.alive()) { LOBBY.started = false; LOBBY.start(); LOBBY.onLob(L); } else { ARC.id = L.game; mfdRender(side); } }};
    body = `<div class="mbig sm">${esc(L.game.toUpperCase())}</div><div class="msub">${LOBBY.seat === 0 ? 'HOSTING' : 'JOINED'} · CODE ${esc(L.id.toUpperCase())}</div>
      ${L.players.map(p => `<div class="mrow${p.seat === LOBBY.seat ? ' hi' : ''}"><span>SEAT ${p.seat + 1}</span><b>${esc(p.name)}${p.left ? ' (LEFT)' : ''}</b></div>`).join('')}
      <div class="mnote">${L.state === 'open' ? 'WAITING FOR A SQUAD MATE…' : L.state === 'done' ? 'FINISHED · ' + esc(String(L.result || '').toUpperCase()) : 'IN PLAY · PLAY = BACK TO BOARD'}${LOBBY.err ? '<br>LINK: ' + esc(LOBBY.err.toUpperCase().slice(0, 28)) : ''}</div>`;
  } else {
    o[6] = {l: 'CHESS', fn: () => LOBBY.host('chess')}; o[7] = {l: 'TANKS', fn: () => LOBBY.host('tanks')}; o[8] = {l: 'FLEET', fn: () => LOBBY.host('fleet')};
    const open = LOBBY.list.filter(L => L.state === 'open').slice(0, 5), slots = [16, 17, 18, 19, 20];
    open.forEach((L, i) => { o[slots[i]] = {l: 'JOIN ' + (i + 1), fn: () => LOBBY.join(L.id)}; });
    const rows = open.map((L, i) => `<div class="mrow"><span>${i + 1}. ${esc(L.game.toUpperCase())}</span><b>${esc(L.host)} ${L.players.length}/${L.max}</b></div>`).join('');
    body = `<div class="mbig sm">SQUAD LOBBY</div><div class="msub">${esc(PILOT())} · ${SQUAD.err || LOBBY.err ? 'OFFLINE' : 'LINKED'}</div>
      ${rows || '<div class="mnote">NO OPEN GAMES — HOST ONE (RIGHT SIDE)</div>'}
      <div class="mnote">HOST: CHESS · TANKS · FLEET<br>JOIN = LEFT SIDE</div>`;
  }
  return {title: 'GAME', osb: o, body};
}

/* ---------------- chess vs a friend (engine + board from index.html) ---------------- */
function chessVsStart(vs) {
  CH.vs = {seat: vs.seat, me: vs.seat === 0 ? 'w' : 'b', opp: vs.opp};
  chNew(CH.vs.me); CH.pending = false; CH.cur = CH.vs.me === 'w' ? 52 : 12;
}
function chessVsMove(m, seat) {
  if (!m || !m.chess || !CH.vs || !CH.st || CH.st.over) return;
  const mv = m.chess, st = CH.st;
  if (st.turn !== (seat === 0 ? 'w' : 'b')) return;  // out of turn: ignore
  const ok = legal(st, mv.from).find(x => x.to === mv.to && (x.promo || null) === (mv.promo || null) && (x.castle || null) === (mv.castle || null));
  if (!ok) return;
  if (seat === CH.vs.seat) CH.pending = false;
  chPlay(ok);
  if (seat !== CH.vs.seat && !CH.st.over) { if (inCheck(CH.st)) say('Check.'); }
}
function chessVsOver(S) {  // called by chPlay once the position is mate/stalemate/draw
  if (!CH.vs || LOBBY.scored) return;
  if (S.over === 'd') { if (CH.vs.seat === 0) LOBBY.send({end: 'draw:0'}); }
  else if (S.over === CH.vs.me) LOBBY.send({end: 'win:' + CH.vs.seat});
}
function chessVsEnd(kind, winner) {
  if (!CH.vs) return;
  const me = winner === CH.vs.seat;
  if (CH.st && !CH.st.over) { CH.st.over = winner < 0 ? 'd' : winner === 0 ? 'w' : 'b'; CH.msg = kind === 'resign' ? 'RESIGNED' : kind === 'left' ? 'LEFT' : CH.msg || (winner < 0 ? 'DRAW' : 'CHECKMATE'); }
  if (winner >= 0) { CH.stats[me ? 'w' : 'l']++; store.set('chessStats', CH.stats); if (me) BOARD.add('chess', 100 + Math.max(0, 80 - CH.hist.length), 'vs ' + CH.vs.opp); }
  else { CH.stats.d++; store.set('chessStats', CH.stats); }
  mfdRenderAll();
}
function chessVsPage(side, common) {
  const st = CH.st, me = CH.vs.me, flip = me === 'b';
  const moves = CH.sel !== null && st.turn === me && !CH.pending ? legal(st, CH.sel) : [];
  const slots = [6, 7, 8, 9, 10, 16, 17, 18, 19, 20], per = slots.length, pages = Math.max(1, Math.ceil(moves.length / per));
  CH.page = Math.min(CH.page, pages - 1);
  const o = {...common, 1: {l: 'LOBBY', fn: () => { ARC.id = 'lobby'; mfdRender(side); }}, 2: {l: 'RESGN', fn: () => { if (st.over) LOBBY.leave(); else if (confirm('Resign this game?')) LOBBY.resign(); }},
    3: {l: CH.sel !== null ? 'MOVE' : 'SEL', fn: () => chSelect()}};
  moves.slice(CH.page * per, CH.page * per + per).forEach((m, n) => { o[slots[n]] = {l: alg(m.to).toUpperCase() + (st.b[m.to] ? '×' : '') + (m.castle ? ' O-O' : ''), fn: () => { CH.sel = null; CH.pending = true; LOBBY.send({chess: m}); mfdRenderAll(); }}; });
  if (pages > 1) { o[12] = {l: `◀${CH.page + 1}/${pages}`, fn: () => { CH.page = (CH.page - 1 + pages) % pages; mfdRenderAll(); }}; o[14] = {l: '▶', fn: () => { CH.page = (CH.page + 1) % pages; mfdRenderAll(); }}; }
  const cells = chessCells(st, flip, moves), opp = CH.vs.opp.toUpperCase();
  const status = st.over ? `${CH.msg} · ${st.over === 'd' ? 'DRAW' : st.over === me ? 'YOU WIN' : opp + ' WINS'}` : CH.pending ? 'SENDING…' : st.turn === me ? `YOUR MOVE · ${alg(CH.cur).toUpperCase()}${CH.msg ? ' · ' + CH.msg : ''}` : `${opp} TO MOVE${LOBBY.err ? ' · LINK?' : ''}`;
  return {title: 'GAME', osb: o, body: `<div class="cstat">${status}</div><div class="cboard">${cells}</div>
    <div class="cfoot"><span>${CH.hist.slice(-6).join(' ')}</span><span>${me === 'w' ? 'WHITE' : 'BLACK'} v ${esc(opp)}</span></div>`, chess: true};
}

/* ---------------- TANKS (artillery, turn-based; solo vs ARIA or squad) ---------------- */
function Tanks() {
  const W = 160, H = 100, G = 60;
  const g = {score: 0, over: false, noHud: true, vs: null, me: 0, hp: [100, 100], turn: 0, wind: 0, h: [], tx: [14, W - 14], aim: [{a: 55, p: 62}, {a: 125, p: 62}], nukes: [1, 1], wpn: 'shell',
    shot: null, queue: [], turns: 0, msg: '', rng: null, waiting: false, hold: {}, fx: [], Wc: 300, Hc: 200};
  const rnd = () => g.rng();
  const th = x => g.h[Math.max(0, Math.min(W - 1, Math.round(x)))];
  g.init = vs => {
    g.vs = vs; g.me = vs ? vs.seat : 0; g.rng = mulberry32(vs ? vs.seed : (Math.random() * 2 ** 31) | 0);
    const f1 = 2 + rnd() * 2, f2 = 5 + rnd() * 4, p1 = rnd() * 6.28, p2 = rnd() * 6.28, base = 26 + rnd() * 12;
    g.h = Array.from({length: W}, (_, x) => { const t = x / W; return Math.max(8, Math.min(72, base + Math.sin(t * f1 * 3.14 + p1) * 12 + Math.sin(t * f2 * 3.14 + p2) * 6 + (rnd() - .5) * 3)); });
    g.wind = newWind(); g.msg = g.turn === g.me ? 'YOUR SHOT' : (vs ? vs.opp.toUpperCase() : AI().toUpperCase()) + ' AIMING';
    if (!vs && g.turn !== g.me) setTimeout(aiShot, 900);
  };
  const newWind = () => Math.round((rnd() - .5) * 50);
  // deterministic flight: both players step the same way → same impact
  const sim = (from, a, p, w) => {
    const r = a * Math.PI / 180, dt = 1 / 60, pts = []; let x = g.tx[from], y = th(g.tx[from]) + 2.5, vx = Math.cos(r) * p * 1.55, vy = Math.sin(r) * p * 1.55;
    const enemy = 1 - from;
    for (let i = 0; i < 1400; i++) {
      x += vx * dt; y += vy * dt; vy -= G * dt; vx += g.wind * .06 * dt; pts.push([x, y]);
      if (x < -5 || x > W + 5) return {pts, out: true};
      if (y <= th(x)) return {pts, ix: x, iy: th(x)};
      if (Math.hypot(x - g.tx[enemy], y - th(g.tx[enemy]) - 2) < 3.2) return {pts, ix: x, iy: y, direct: true};
    }
    return {pts, out: true};
  };
  const resolve = (from, a, p, w) => {
    const res = sim(from, a, p, w); res.dmg = [0, 0]; res.hpAfter = g.hp.slice();
    if (res.out) return res;
    const r = w === 'nuke' ? 13 : 6.5, base = w === 'nuke' ? 80 : 42;
    for (let x = Math.max(0, Math.floor(res.ix - r)); x <= Math.min(W - 1, Math.ceil(res.ix + r)); x++) { const d = Math.sqrt(Math.max(0, r * r - (x - res.ix) ** 2)); g.h[x] = Math.max(3, Math.min(g.h[x], res.iy - d)); }
    for (const s of [0, 1]) { const d = Math.hypot(g.tx[s] - res.ix, th(g.tx[s]) + 2 - res.iy); const dmg = Math.round(base * Math.max(0, 1 - d / (r * 1.5))); res.dmg[s] = dmg; res.hpAfter[s] = Math.max(0, g.hp[s] - dmg); }
    return res;
  };
  const fire = (seat, f) => {
    if (g.over) return;
    if (g.shot) { g.queue.push([seat, f]); return; }
    if (f.w === 'nuke') { if (!g.nukes[seat]) f.w = 'shell'; else g.nukes[seat]--; }
    g.aim[seat] = {a: f.a, p: f.p};
    const res = resolve(seat, f.a, f.p, f.w); g.shot = {res, i: 0, seat, w: f.w}; g.waiting = false; g.msg = '';
  };
  const finish = () => {
    const sh = g.shot, res = sh.res; g.shot = null;
    if (!res.out) g.fx.push({x: res.ix, y: res.iy, r: sh.w === 'nuke' ? 13 : 6.5, t: 0});
    g.hp = res.hpAfter; g.turns++;
    const name = s => s === g.me ? 'YOU' : (g.vs ? g.vs.opp.toUpperCase() : AI().toUpperCase());
    if (res.out) g.msg = 'OFF THE MAP'; else if (res.dmg[1 - sh.seat] >= 70) g.msg = 'DIRECT HIT'; else if (res.dmg[1 - sh.seat]) g.msg = `${name(sh.seat)} HIT FOR ${res.dmg[1 - sh.seat]}`; else if (res.dmg[sh.seat]) g.msg = 'SELF HIT'; else g.msg = 'MISS';
    const dead = g.hp.findIndex(h => h <= 0);
    if (dead >= 0) { const winner = g.hp[0] <= 0 && g.hp[1] <= 0 ? sh.seat : 1 - dead; return end(winner, 'kill'); }
    g.turn = 1 - g.turn; g.wind = newWind();
    if (g.queue.length) { const [s, f] = g.queue.shift(); fire(s, f); }
    else if (!g.vs && g.turn !== g.me) setTimeout(aiShot, 1000);
  };
  const end = (winner, kind) => {
    if (g.over) return; g.over = true; g.winner = winner;
    const win = winner === g.me;
    g.overText = win ? 'VICTORY' : 'DESTROYED';
    if (win) { const sc = g.hp[g.me] * 10 + Math.max(0, 600 - g.turns * 30); g.overSub = `${sc} PTS · NEW = AGAIN`; g.score = sc; arcOver(sc, g.vs ? 'vs ' + g.vs.opp : 'vs ' + AI());
      if (g.vs && kind === 'kill' && !LOBBY.scored) LOBBY.send({end: 'win:' + g.me}); }
    else { g.scored = true; g.overSub = `THEY KEPT ${g.hp[1 - g.me]} HP · NEW = AGAIN`; if (!g.vs) say('Tank down. Better luck next time.'); }
  };
  g.vsEnd = (kind, winner) => { if (winner >= 0) end(winner, kind); };
  const aiShot = () => {
    if (g.over || g.vs || g.turn === g.me || g.shot) return;
    const ai = 1 - g.me; let best = null;
    for (let a = 15; a <= 165; a += 3) for (let p = 20; p <= 100; p += 4) {
      const r = sim(ai, a, p, 'shell'); if (r.out) continue;
      const miss = Math.hypot(r.ix - g.tx[g.me], r.iy - th(g.tx[g.me]));
      if (!best || miss < best.miss) best = {a, p, miss};
    }
    if (!best) best = {a: ai === 0 ? 60 : 120, p: 60};
    const noise = Math.max(6, 26 - g.turns * 2);
    const f = {a: Math.max(5, Math.min(175, best.a + (Math.random() - .5) * noise)), p: Math.max(15, Math.min(100, best.p + (Math.random() - .5) * noise)), w: g.nukes[ai] && g.hp[g.me] < 55 && Math.random() < .4 ? 'nuke' : 'shell'};
    fire(ai, f);
  };
  const myTurn = () => !g.over && !g.shot && g.turn === g.me && !g.waiting;
  const myFire = () => { if (!myTurn()) return; const f = {a: g.aim[g.me].a, p: g.aim[g.me].p, w: g.wpn}; if (g.vs) { g.waiting = true; LOBBY.send({fire: f}); } else fire(g.me, f); g.wpn = 'shell'; mfdRenderAll(); };
  const adj = (k, d) => { const A = g.aim[g.me]; if (k === 'a') A.a = Math.max(5, Math.min(175, A.a + d)); else A.p = Math.max(10, Math.min(100, A.p + d)); };
  g.remote = (m, seat) => { if (m && m.fire && !g.over) fire(seat, m.fire); };
  g.press = k => {
    if (k === 'a') return myFire();
    if (k === 'b') { if (g.nukes[g.me]) g.wpn = g.wpn === 'nuke' ? 'shell' : 'nuke'; mfdRenderAll(); return; }
    if (!myTurn()) return;
    if (k === 'up') adj('a', 1); if (k === 'down') adj('a', -1); if (k === 'right') adj('p', 1); if (k === 'left') adj('p', -1);
  };
  g.osb = side => ({2: g.vs ? {l: g.over ? 'LOBBY' : 'RESGN', fn: () => { if (g.over) { ARC.id = 'lobby'; mfdRender(side); } else if (confirm('Resign?')) LOBBY.resign(); }} : {l: 'NEW', fn: () => arcStart('tanks', side)},
    6: {l: 'FIRE', fn: myFire}, 7: {l: g.wpn === 'nuke' ? 'NUKE✓' : g.nukes[g.me] ? 'NUKE' : '—', fn: () => g.press('b')},
    8: {l: 'ANG+', fn: () => { g.press('up'); }}, 9: {l: 'ANG−', fn: () => { g.press('down'); }}, 10: {l: 'PWR+', fn: () => { g.press('right'); }}, 20: {l: 'PWR−', fn: () => { g.press('left'); }}});
  g.tick = (dt, keys) => {
    for (const k of ['up', 'down', 'left', 'right']) { g.hold[k] = keys[k] ? (g.hold[k] || 0) + dt : 0; if (g.hold[k] > .35 && myTurn()) { g.hold[k] -= .06; adj(k === 'up' || k === 'down' ? 'a' : 'p', k === 'up' || k === 'right' ? 1 : -1); } }
    if (g.shot) { g.shot.i += dt * (g.queue.length ? 4000 : 170); if (g.shot.i >= g.shot.res.pts.length) finish(); }
    g.fx.forEach(f => f.t += dt); g.fx = g.fx.filter(f => f.t < .7);
  };
  g.draw = (ctx, Wc, Hc) => {
    g.Wc = Wc; g.Hc = Hc; const C = themeColor('--mg'), Wt = themeColor('--mw'), Acc = themeColor('--macc') || '#f2a83b';
    const sx = Wc / W, sy = (Hc - 22) / H, X = x => x * sx, Y = y => Hc - y * sy;
    ctx.clearRect(0, 0, Wc, Hc);
    ctx.fillStyle = C + '2a'; ctx.beginPath(); ctx.moveTo(0, Hc); for (let x = 0; x < W; x++) ctx.lineTo(X(x), Y(g.h[x])); ctx.lineTo(Wc, Hc); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C; ctx.lineWidth = 1.2; ctx.beginPath(); for (let x = 0; x < W; x++) ctx[x ? 'lineTo' : 'moveTo'](X(x), Y(g.h[x])); ctx.stroke();
    for (const s of [0, 1]) {
      const x = X(g.tx[s]), y = Y(th(g.tx[s])), mine = s === g.me; ctx.fillStyle = mine ? Wt : C;
      ctx.fillRect(x - 5, y - 5, 10, 4); ctx.fillRect(x - 3, y - 8, 6, 3);
      const a = g.aim[s].a * Math.PI / 180; ctx.strokeStyle = mine ? Wt : C; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + Math.cos(a) * 9, y - 7 - Math.sin(a) * 9); ctx.stroke();
      if (g.hp[s] <= 0) { ctx.fillStyle = Acc; ctx.fillRect(x - 6, y - 10, 12, 2); }
    }
    if (g.shot) { const pts = g.shot.res.pts, n = Math.min(pts.length, Math.floor(g.shot.i)); ctx.strokeStyle = Acc; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < n; i++) ctx[i ? 'lineTo' : 'moveTo'](X(pts[i][0]), Y(pts[i][1])); ctx.stroke();
      if (n) { ctx.fillStyle = Wt; ctx.beginPath(); ctx.arc(X(pts[n - 1][0]), Y(pts[n - 1][1]), g.shot.w === 'nuke' ? 3 : 2, 0, 7); ctx.fill(); } }
    for (const f of g.fx) { ctx.strokeStyle = Acc; ctx.globalAlpha = 1 - f.t / .7; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(f.x), Y(f.y), f.r * sx * (0.3 + f.t), 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
    // HUD
    ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.textBaseline = 'top';
    const bar = (x, hp, right) => { ctx.fillStyle = C + '55'; ctx.fillRect(right ? x - 60 : x, 4, 60, 6); ctx.fillStyle = hp > 35 ? C : Acc; ctx.fillRect(right ? x - 60 * hp / 100 : x, 4, 60 * hp / 100, 6); };
    bar(6, g.hp[0]); bar(Wc - 6, g.hp[1], true);
    ctx.fillStyle = Wt; ctx.textAlign = 'left'; ctx.fillText((g.me === 0 ? 'YOU ' : (g.vs ? g.vs.opp : AI()).toUpperCase() + ' ') + g.hp[0], 6, 12);
    ctx.textAlign = 'right'; ctx.fillText(g.hp[1] + (g.me === 1 ? ' YOU' : ' ' + (g.vs ? g.vs.opp : AI()).toUpperCase()), Wc - 6, 12);
    ctx.textAlign = 'center'; ctx.fillStyle = C; const w = g.wind; ctx.fillText(`WIND ${w < 0 ? '◀' : w > 0 ? '▶' : '·'} ${Math.abs(w)}`, Wc / 2, 4);
    const A = g.aim[g.me]; ctx.fillStyle = Wt; ctx.fillText(`ANG ${Math.round(A.a)}°  PWR ${Math.round(A.p)}${g.wpn === 'nuke' ? '  NUKE' : ''}`, Wc / 2, 14);
    ctx.fillStyle = myTurn() ? Wt : C; ctx.fillText(g.waiting ? 'SENDING…' : g.shot ? '' : g.over ? '' : myTurn() ? 'YOUR SHOT · A = FIRE' : g.msg || 'WAITING', Wc / 2, Hc - 12);
    if (g.msg && (g.shot || !myTurn())) { ctx.fillStyle = Acc; ctx.fillText(g.msg, Wc / 2, Hc - 24); }
    ctx.textBaseline = 'alphabetic';
  };
  return g;
}

/* ---------------- FLEET (battleship; solo vs ARIA or squad) ---------------- */
function Fleet() {
  const N = 10, LENS = [5, 4, 3, 3, 2], NAMES = ['IDRIS', 'HAMMERHEAD', 'POLARIS', 'PERSEUS', 'CUTLASS'];
  const g = {score: 0, over: false, noHud: true, vs: null, me: 0, boards: [null, null], ready: [false, false], shots: [new Set(), new Set()], cur: {r: 4, c: 4}, phase: 'place', turn: 0, msg: '', waiting: false, ai: {targets: [], hits: []}, last: null, sunk: [[], []]};
  const key = (r, c) => r * N + c;
  const place = rnd => { const out = [], occ = new Set();
    for (const len of LENS) { for (let t = 0; t < 500; t++) { const h = rnd() < .5, r = Math.floor(rnd() * (h ? N : N - len + 1)), c = Math.floor(rnd() * (h ? N - len + 1 : N)); const cells = Array.from({length: len}, (_, i) => key(h ? r : r + i, h ? c + i : c));
        if (cells.every(k => !occ.has(k))) { cells.forEach(k => occ.add(k)); out.push({r, c, len, h}); break; } } }
    return out; };
  const cellsOf = s => s.h ? Array.from({length: s.len}, (_, i) => key(s.r, s.c + i)) : Array.from({length: s.len}, (_, i) => key(s.r + i, s.c));
  const shipAt = (b, k) => b.find(s => cellsOf(s).includes(k));
  const allHit = (b, shots) => b.every(s => cellsOf(s).every(k => shots.has(k)));
  g.init = vs => { g.vs = vs; g.me = vs ? vs.seat : 0; g.boards[g.me] = place(Math.random); if (!vs) { g.boards[1] = place(Math.random); } g.phase = 'place'; g.msg = 'PLACE: SHUF OR READY'; };
  const ready = () => { if (g.phase !== 'place') return; if (g.vs) { g.phase = 'wait'; g.msg = 'WAITING FOR ' + g.vs.opp.toUpperCase(); LOBBY.send({place: g.boards[g.me]}); } else { g.phase = 'play'; g.turn = 0; g.msg = 'YOUR SHOT'; } mfdRenderAll(); };
  const applyShot = (seat, r, c) => {
    if (g.over || g.phase !== 'play' || seat !== g.turn) return;
    const k = key(r, c), enemy = 1 - seat, b = g.boards[enemy]; if (g.shots[seat].has(k)) return;
    g.shots[seat].add(k); g.waiting = false;
    const ship = shipAt(b, k); const who = seat === g.me ? 'YOU' : (g.vs ? g.vs.opp.toUpperCase() : AI().toUpperCase());
    g.last = {seat, r, c, hit: !!ship};
    if (ship) { const sunk = cellsOf(ship).every(x => g.shots[seat].has(x)); if (sunk) { g.sunk[enemy].push(ship); g.msg = `${who}: SUNK ${NAMES[LENS.indexOf(ship.len)]}`; } else g.msg = `${who}: HIT`;
      if (!g.vs && seat !== g.me) { g.ai.hits.push([r, c]); if (!sunk) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < N && cc >= 0 && cc < N && !g.shots[seat].has(key(rr, cc))) g.ai.targets.push([rr, cc]); } else g.ai.targets = []; } }
    else g.msg = `${who}: MISS`;
    if (allHit(b, g.shots[seat])) return end(seat, 'kill');
    g.turn = 1 - seat;
    if (!g.vs && g.turn !== g.me) setTimeout(aiShot, 800);
  };
  const end = (winner, kind) => {
    if (g.over) return; g.over = true; const win = winner === g.me;
    g.overText = win ? 'FLEET DESTROYED' : 'YOU WERE SUNK';
    if (win) { const sc = Math.max(1, 117 - g.shots[g.me].size) * 10; g.score = sc; g.overSub = `${sc} PTS · ${g.shots[g.me].size} SHOTS`; arcOver(sc, g.vs ? 'vs ' + g.vs.opp : 'vs ' + AI());
      if (g.vs && kind === 'kill' && !LOBBY.scored) LOBBY.send({end: 'win:' + g.me}); }
    else { g.scored = true; g.overSub = 'NEW = AGAIN'; if (!g.vs) say('Fleet lost. Regroup and try again.'); }
  };
  g.vsEnd = (kind, winner) => { if (winner >= 0) end(winner, kind); };
  const aiShot = () => {
    if (g.over || g.vs || g.turn === g.me) return;
    let r, c; const ai = 1 - g.me;
    while (g.ai.targets.length) { const t = g.ai.targets.pop(); if (!g.shots[ai].has(key(t[0], t[1]))) { [r, c] = t; break; } }
    if (r === undefined) { const cand = []; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((i + j) % 2 === 0 && !g.shots[ai].has(key(i, j))) cand.push([i, j]);
      const pool = cand.length ? cand : (() => { const o = []; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!g.shots[ai].has(key(i, j))) o.push([i, j]); return o; })(); [r, c] = pool[Math.floor(Math.random() * pool.length)]; }
    applyShot(ai, r, c);
  };
  const myTurn = () => !g.over && g.phase === 'play' && g.turn === g.me && !g.waiting;
  const myFire = () => { if (g.phase === 'place') return ready(); if (!myTurn()) return; const k = key(g.cur.r, g.cur.c); if (g.shots[g.me].has(k)) { g.msg = 'ALREADY SHOT'; return; } if (g.vs) { g.waiting = true; LOBBY.send({shot: {r: g.cur.r, c: g.cur.c}}); } else applyShot(g.me, g.cur.r, g.cur.c); mfdRenderAll(); };
  g.remote = (m, seat) => {
    if (!m || g.over) return;
    if (m.place && Array.isArray(m.place)) { g.boards[seat] = m.place.map(s => ({r: +s.r, c: +s.c, len: +s.len, h: !!s.h})).slice(0, 5); g.ready[seat] = true; if (g.ready[0] && g.ready[1] && g.phase !== 'play') { g.phase = 'play'; g.turn = 0; g.msg = g.turn === g.me ? 'YOUR SHOT' : (g.vs ? g.vs.opp.toUpperCase() : '') + ' SHOOTS FIRST'; } }
    if (m.shot && g.phase === 'play') applyShot(seat, +m.shot.r, +m.shot.c);
  };
  g.press = k => {
    if (k === 'a') return myFire();
    if (k === 'b') { if (g.phase === 'place') { g.boards[g.me] = place(Math.random); mfdRenderAll(); } return; }
    const d = {up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1]}[k]; if (!d) return;
    g.cur.r = Math.max(0, Math.min(N - 1, g.cur.r + d[0])); g.cur.c = Math.max(0, Math.min(N - 1, g.cur.c + d[1]));
  };
  g.osb = side => ({2: g.vs ? {l: g.over ? 'LOBBY' : 'RESGN', fn: () => { if (g.over) { ARC.id = 'lobby'; mfdRender(side); } else if (confirm('Resign?')) LOBBY.resign(); }} : {l: 'NEW', fn: () => arcStart('fleet', side)},
    6: {l: g.phase === 'place' ? 'READY' : 'FIRE', fn: myFire}, 7: g.phase === 'place' ? {l: 'SHUF', fn: () => g.press('b')} : {l: '', fn: () => {}}});
  g.tick = () => {};
  g.draw = (ctx, Wc, Hc) => {
    const C = themeColor('--mg'), Wt = themeColor('--mw'), Acc = themeColor('--macc') || '#f2a83b';
    ctx.clearRect(0, 0, Wc, Hc);
    const big = Math.min(Hc - 30, Wc * .6), cs = big / N, ox = 6, oy = 16, small = Math.min(Hc * .45, Wc - big - 20), ss = small / N, sx = ox + big + 12, sy = 16;
    const grid = (x, y, c, n) => { ctx.strokeStyle = C + '66'; ctx.lineWidth = 1; for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(x + i * c + .5, y); ctx.lineTo(x + i * c + .5, y + n * c); ctx.moveTo(x, y + i * c + .5); ctx.lineTo(x + n * c, y + i * c + .5); ctx.stroke(); } };
    ctx.font = '600 9px IBM Plex Mono, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = C;
    const enemyName = g.vs ? g.vs.opp.toUpperCase() : AI().toUpperCase();
    ctx.fillText(g.phase === 'place' ? 'YOUR FLEET' : enemyName + ' WATERS', ox, 4); ctx.fillText(g.phase === 'place' ? '' : 'YOURS', sx, 4);
    if (g.phase === 'place') {  // big = my board while placing
      grid(ox, oy, cs, N); ctx.fillStyle = Wt; for (const s of g.boards[g.me]) for (const k of cellsOf(s)) ctx.fillRect(ox + (k % N) * cs + 2, oy + Math.floor(k / N) * cs + 2, cs - 4, cs - 4);
    } else {
      const enemy = 1 - g.me; grid(ox, oy, cs, N);
      for (const s of g.sunk[enemy]) for (const k of cellsOf(s)) { ctx.fillStyle = Acc + '55'; ctx.fillRect(ox + (k % N) * cs + 1, oy + Math.floor(k / N) * cs + 1, cs - 2, cs - 2); }
      for (const k of g.shots[g.me]) { const r = Math.floor(k / N), c = k % N, hit = g.boards[enemy] && !!shipAt(g.boards[enemy], k); ctx.fillStyle = hit ? Acc : C + '88';
        if (hit) ctx.fillRect(ox + c * cs + 3, oy + r * cs + 3, cs - 6, cs - 6); else { ctx.beginPath(); ctx.arc(ox + c * cs + cs / 2, oy + r * cs + cs / 2, Math.max(1.5, cs * .12), 0, 7); ctx.fill(); } }
      if (myTurn()) { ctx.strokeStyle = Wt; ctx.lineWidth = 2; ctx.strokeRect(ox + g.cur.c * cs + 1, oy + g.cur.r * cs + 1, cs - 2, cs - 2); }
      grid(sx, sy, ss, N); ctx.fillStyle = Wt + '99'; for (const s of g.boards[g.me]) for (const k of cellsOf(s)) ctx.fillRect(sx + (k % N) * ss + 1, sy + Math.floor(k / N) * ss + 1, ss - 2, ss - 2);
      for (const k of g.shots[enemy]) { const r = Math.floor(k / N), c = k % N, hit = !!shipAt(g.boards[g.me], k); ctx.fillStyle = hit ? Acc : C; if (hit) ctx.fillRect(sx + c * ss + 1, sy + r * ss + 1, ss - 2, ss - 2); else { ctx.beginPath(); ctx.arc(sx + c * ss + ss / 2, sy + r * ss + ss / 2, Math.max(1, ss * .15), 0, 7); ctx.fill(); } }
      // fleet status
      ctx.fillStyle = C; ctx.font = '8px IBM Plex Mono, monospace'; let yy = sy + small + 6;
      LENS.forEach((len, i) => { const sunkE = g.sunk[enemy].filter(s => s.len === len).length, totE = LENS.filter(l => l === len).length; ctx.fillStyle = sunkE >= totE ? Acc : C; ctx.fillText(`${NAMES[i].slice(0, 6)} ${'■'.repeat(len)}`, sx, yy); yy += 10; });
    }
    ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = Wt;
    ctx.fillText(g.waiting ? 'SENDING…' : g.over ? '' : g.phase === 'place' ? 'A/READY = LOCK IN · B/SHUF = RESHUFFLE' : myTurn() ? `YOUR SHOT · ${'ABCDEFGHIJ'[g.cur.r]}${g.cur.c + 1} · A = FIRE` : g.msg, Wc / 2, Hc - 12);
    if (g.phase === 'play' && myTurn() && g.msg) { ctx.fillStyle = Acc; ctx.fillText(g.msg, Wc / 2, Hc - 24); }
    ctx.textBaseline = 'alphabetic';
  };
  return g;
}

ARC_GAMES.tanks = () => Tanks(); ARC_GAMES.fleet = () => Fleet();
GAME_LIST.push(['tanks', 'TANKS', 'artillery'], ['fleet', 'FLEET', 'battleship']);
