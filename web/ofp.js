/* ofp.js — OFP 2 "Hornet": the F/A-18's display logic on ARIA's Star Citizen MFDs.

   • MENU sits bottom-center (OSB 13) on all three MFDs. Press it to get the TAC menu, press it again for SUPT.
   • Mode buttons NAV · MSL · RADAR (left column on both menus) load that mode's formats on all three screens
     and switch the game's operator mode (MSL → missile mode, RADAR → scanning mode), like the jet's master modes.
   • Format names are Star Citizen's: MAP, WPN, RADAR, CM, SHLD, MINE, SALV · NAV, PWR, FLT, FUEL, CHKLST,
     DATA, CARGO, TIMER, COMM, BIT, OFP. Most are ARIA's existing pages under their Hornet name.
   • Selected options are boxed, not lit — Hornet style.
   OFP 1 (ARIA's classic layout) is untouched: ofpMode 'classic' runs the original pages. */

const OFPM = {get: () => store.get('ofpMode', 'classic'), hornet: () => store.get('ofpMode', 'classic') === 'hornet'};
// Hornet names for ARIA's existing pages (the page ids stay the same underneath)
// labels: the Hornet's layout and logic, but Star Citizen names where a jet word means nothing in a spaceship
const HN = {SCAN: 'RADAR'};
// what each master mode puts on left · center · right, and the game operator mode it selects
const MASTER = {
  NAV: {L: 'NAV', C: 'MAP', R: 'JOB', game: null, say: 'Nav master mode.'},
  AA: {L: 'WPN', C: 'MAP', R: 'SCAN', game: 'msl', say: 'Missiles.'},          // MSL button
  AG: {L: 'SCAN', C: 'MAP', R: 'MINE', game: 'scanMode', say: 'Radar mode.'}    // RADAR button (scanning mode)
};
Object.assign(GAME, {
  cmCyc: ['cycle countermeasure', 'countermeasure cycle', 'cycle countermeasures'], cmLaunch: ['launch countermeasure', 'deploy countermeasure'],
  mineMode: ['mining mode', 'toggle mining mode', 'mining operator mode'], minePwrUp: ['increase mining laser power', 'mining laser power increase', 'increase laser power'],
  minePwrDn: ['decrease mining laser power', 'mining laser power decrease', 'decrease laser power'], mineSwitch: ['switch mining laser', 'cycle mining laser', 'toggle mining laser type'],
  mineMod1: ['activate mining module 1', 'mining module 1', 'module slot 1'], mineMod2: ['activate mining module 2', 'mining module 2', 'module slot 2'],
  jettison: ['jettison cargo', 'mining jettison', 'jettison mining cargo'],
  salvMode: ['salvage mode', 'toggle salvage mode', 'salvage operator mode'], salvBeam: ['toggle salvage beam', 'salvage beam', 'salvage fire'],
  salvMod: ['cycle salvage modifiers', 'salvage modifier', 'salvage focus'], salvSpread: ['increase salvage beam spacing', 'salvage beam spacing', 'salvage spread'],
  tractor: ['tractor beam mode', 'toggle tractor beam', 'tractor beam'],
  decouple: ['toggle decoupled mode', 'decoupled mode', 'coupled mode'], gsafe: ['toggle g safe', 'g-safe', 'gsafe', 'g safe'],
  spdlim: ['toggle speed limiter', 'speed limiter'], esp: ['toggle esp', 'enhanced stick precision', 'esp'], cruise: ['cruise control', 'toggle cruise control'],
  qt: ['quantum travel system toggle', 'quantum travel mode', 'quantum drive', 'toggle quantum']
});
Object.assign(GAME_LBL, {cmCyc: 'CM CYCLE', cmLaunch: 'CM LAUNCH', mineMode: 'MINING MODE', minePwrUp: 'LASER PWR +', minePwrDn: 'LASER PWR −', mineSwitch: 'LASER SWITCH',
  mineMod1: 'MODULE 1', mineMod2: 'MODULE 2', jettison: 'JETTISON', salvMode: 'SALVAGE MODE', salvBeam: 'BEAM', salvMod: 'MODIFIER', salvSpread: 'SPACING', tractor: 'TRACTOR',
  decouple: 'DECOUPLED', gsafe: 'G-SAFE', spdlim: 'SPD LIMITER', esp: 'ESP', cruise: 'CRUISE', qt: 'QUANTUM'});

/* ---------------- master modes ---------------- */
function ofpMaster(mm, side) {
  const M = MASTER[mm]; if (!M) return;
  store.set('ofpMM', mm);
  for (const s of ['L', 'C', 'R']) mfdGo(s, M[s]);
  if (M.game) gameBtn(side || 'C', M.game, mm).fn(true);  // presses the game's operator-mode key (shows NO BIND if you don't have one)
  ufcSay(M.say);
}
const mmBtns = side => {
  const cur = store.get('ofpMM', 'NAV');
  return {16: {l: 'NAV', on: cur === 'NAV', fn: () => ofpMaster('NAV', side)}, 17: {l: 'MSL', on: cur === 'AA', fn: () => ofpMaster('AA', side)}, 18: {l: 'RADAR', on: cur === 'AG', fn: () => ofpMaster('AG', side)}};
};

/* ---------------- timers (refinery jobs, contract clocks) ---------------- */
const TIMERS = {list: store.get('ofpTimers', []), save() { store.set('ofpTimers', this.list); }};
setInterval(() => {
  const now = Date.now(); let ch = false;
  for (const t of TIMERS.list) if (!t.done && now >= t.end) { t.done = true; ch = true; ufcSay(`${t.name} is done.`); try { say(`${t.name} is done.`); } catch {} }
  if (ch) TIMERS.save();
  if (CK.on && OFPM.hornet()) for (const s of ['L', 'R', 'C']) if (MFDS[s].page === 'TIMER') mfdRender(s);
}, 1000);
const hms = ms => { ms = Math.max(0, ms); const h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`; };

/* ---------------- checklist ---------------- */
const CHK = [['fr', 'FLIGHT READY'], ['dClose', 'DOORS CLOSED'], ['lite', 'LIGHTS'], ['atc', 'REQUEST ATC'], ['gear', 'GEAR UP AFTER LIFT']];

/* ---------------- the pages ---------------- */
const _pageDef0 = pageDef0;
pageDef0 = function (side) {
  if (!OFPM.hornet()) return _pageDef0(side);
  const S = MFDS[side], p = S.page;
  const common = {13: {l: 'MENU', fn: () => { if (S.page === 'MENU') S.menu = S.menu === 'SUPT' ? 'TAC' : 'SUPT'; else S.menu = S.menu || 'TAC'; mfdGo(side, 'MENU'); }},
    11: {l: 'SOI', on: MFDS.soi === side, fn: () => { MFDS.soi = side; store.set('mfdSoi', side); mfdRenderAll(); }}};
  const box = (title, sub, rows) => `<div class="mbig sm">${title}</div>${sub ? `<div class="msub">${sub}</div>` : ''}${rows || ''}`;
  if (p === 'MENU') {
    const tac = S.menu !== 'SUPT';
    const o = tac ? {...common, ...mmBtns(side), 1: {l: 'MAP', go: 'MAP'}, 2: {l: 'WPN', go: 'WPN'}, 3: {l: 'RADAR', go: 'SCAN'}, 4: {l: 'CM', go: 'EW'}, 5: {l: 'SHLD', go: 'SHLD'},
      6: {l: 'MINE', go: 'MINE'}, 7: {l: 'SALV', go: 'SALV'}, 8: {l: 'UFC', go: 'UFC'}, 10: {l: 'GAME', go: 'GAME'}, 20: {l: 'HELP', go: 'HELP'}}
      : {...common, ...mmBtns(side), 1: {l: 'NAV', go: 'NAV'}, 2: {l: 'PWR', go: 'PWR'}, 3: {l: 'FLT', go: 'FCS'}, 4: {l: 'FUEL', go: 'FUEL'}, 5: {l: 'CHKLST', go: 'CHKLST'},
      6: {l: 'JOB', go: 'JOB'}, 7: {l: 'CARGO', go: 'CARGO'}, 8: {l: 'TIMER', go: 'TIMER'}, 9: {l: 'ATC', go: 'ATC'}, 10: {l: 'SYS', go: 'SYS'}, 19: {l: 'OFP', go: 'OFP'}, 20: {l: 'HELP', go: 'HELP'}};
    const mm = store.get('ofpMM', 'NAV');
    return {title: tac ? 'TAC' : 'SUPT', osb: o, body: `<div class="mbig">${tac ? 'TAC' : 'SUPT'}</div><div class="msub">MENU ▸ ${tac ? 'SUPT' : 'TAC'} · MODE ${mm === 'AA' ? 'MSL' : mm === 'AG' ? 'RADAR' : 'NAV'}</div>
      <div class="mclock">${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div><div class="mnote">${esc(store.get('ofpCur', 'OFP 2'))}</div>`};
  }
  if (p === 'EW') return {title: 'CM', osb: {...common, 1: gameBtn(side, 'cmD', 'DECOY'), 2: gameBtn(side, 'cmN', 'NOISE'), 3: gameBtn(side, 'cmCyc', 'CYCLE'), 4: gameBtn(side, 'cmLaunch', 'LNCH'), 10: {l: 'WPN', go: 'WPN'}},
    body: box('CM', 'COUNTERMEASURES', gameRows(side, ['cmD', 'cmN', 'cmCyc', 'cmLaunch']))};
  if (p === 'MINE') return {title: 'MINE', osb: {...common, 1: gameBtn(side, 'mineMode', 'MODE'), 2: gameBtn(side, 'mineSwitch', 'LASER'), 3: gameBtn(side, 'minePwrUp', 'PWR+'), 4: gameBtn(side, 'minePwrDn', 'PWR−'),
      6: gameBtn(side, 'mineMod1', 'MOD 1'), 7: gameBtn(side, 'mineMod2', 'MOD 2'), 9: {l: 'RADAR', go: 'SCAN'}, 10: gameBtn(side, 'jettison', 'JETT')},
    body: box('MINE', 'MINING HEAD · MODULES', gameRows(side, ['mineMode', 'mineSwitch', 'minePwrUp', 'minePwrDn', 'mineMod1', 'mineMod2', 'jettison'])) + '<div class="mnote">LASER / CRACK WINDOW NOT LIVE — GAME DOESN’T EXPORT IT</div>'};
  if (p === 'SALV') return {title: 'SALV', osb: {...common, 1: gameBtn(side, 'salvMode', 'MODE'), 2: gameBtn(side, 'salvBeam', 'BEAM'), 3: gameBtn(side, 'salvMod', 'MODF'), 4: gameBtn(side, 'salvSpread', 'SPCG'), 5: gameBtn(side, 'tractor', 'TRCTR')},
    body: box('SALV', 'SALVAGE HEADS · TRACTOR', gameRows(side, ['salvMode', 'salvBeam', 'salvMod', 'salvSpread', 'tractor']))};
  if (p === 'FCS') return {title: 'FLT', osb: {...common, 1: gameBtn(side, 'decouple', 'DCPL'), 2: gameBtn(side, 'gsafe', 'GSAFE'), 3: gameBtn(side, 'spdlim', 'SPDLM'), 4: gameBtn(side, 'esp', 'ESP'), 5: gameBtn(side, 'cruise', 'CRUZ'), 6: gameBtn(side, 'qt', 'QT')},
    body: box('FLT', 'FLIGHT CONTROL', gameRows(side, ['decouple', 'gsafe', 'spdlim', 'esp', 'cruise', 'qt']))};
  if (p === 'FUEL') {
    const P = curPlan(), legs = P ? P.segs.flatMap(s => s.legs) : [], jf = legs.filter(l => l.jump).reduce((a, l) => a + (l.fuel || 0), 0), qtd = legs.filter(l => !l.jump).reduce((a, l) => a + (l.dist || 0), 0);
    return {title: 'FUEL', osb: {...common, 6: {l: 'NAV', go: 'NAV'}},
      body: box('FUEL', 'PLANNED, NOT LIVE', `<div class="mrow"><span>QT DISTANCE (JOB)</span><b>${P ? fmtDist(qtd) : '—'}</b></div><div class="mrow"><span>JUMP FUEL</span><b>${P ? (jf ? fmt(jf, 1) + ' SCU' : 'NO JUMPS') : '—'}</b></div>
        <div class="mrow"><span>LEGS</span><b>${P ? legs.length : '—'}</b></div><div class="mnote">STAR CITIZEN DOESN’T EXPORT FUEL · CHECK YOUR HUD</div>`)};
  }
  if (p === 'CHKLST') {
    const done = new Set(store.get('ofpChk', []));
    const o = {...common, 1: {l: 'RSET', fn: () => { store.set('ofpChk', []); mfdRender(side); }}};
    CHK.forEach(([id, l], i) => { const b = gameBtn(side, id, l.split(' ')[0].slice(0, 6)); o[6 + i] = {l: b.l, on: done.has(id), fn: async m => { await b.fn(m); done.add(id); store.set('ofpChk', [...done]); mfdRender(side); }}; });
    return {title: 'CHKLST', osb: o, body: box('CHKLST', 'BEFORE TAKEOFF', CHK.map(([id, l], i) => `<div class="mrow${done.has(id) ? '' : ' hi'}"><span>${i + 1}. ${l}</span><b>${done.has(id) ? '✓' : '—'}</b></div>`).join(''))};
  }
  if (p === 'TIMER') {
    const add = (min, name) => () => { const n = TIMERS.list.filter(t => !t.done).length + 1; TIMERS.list.push({name: name || `TIMER ${n}`, end: Date.now() + min * 6e4, done: false}); TIMERS.save(); mfdRender(side); };
    const o = {...common, 1: {l: 'CLR', fn: () => { TIMERS.list = TIMERS.list.filter(t => !t.done); TIMERS.save(); mfdRender(side); }}, 2: {l: 'ALL', fn: () => { TIMERS.list = []; TIMERS.save(); mfdRender(side); }},
      6: {l: '15M', fn: add(15)}, 7: {l: '30M', fn: add(30)}, 8: {l: '1H', fn: add(60)}, 9: {l: '4H', fn: add(240, 'REFINERY')}, 10: {l: '8H', fn: add(480, 'REFINERY')}};
    const now = Date.now();
    return {title: 'TIMER', osb: o, body: box('TIMER', 'REFINERY · CONTRACT CLOCKS', TIMERS.list.length ? TIMERS.list.slice(-6).map(t => `<div class="mrow${t.done ? ' hi' : ''}"><span>${esc(t.name)}</span><b>${t.done ? 'DONE' : hms(t.end - now)}</b></div>`).join('') : '<div class="mnote">PICK A LENGTH ON THE RIGHT</div>')};
  }
  if (p === 'OFP') {
    if (!OFP._last && !OFP._loading) { OFP._loading = true; OFP.list().then(l => { OFP._last = l; OFP._loading = false; mfdRender(side); }); }
    const list = [{name: 'OFP 1 · CLASSIC', builtin: 'classic'}, {name: 'OFP 2 · HORNET', builtin: 'hornet'}, ...(OFP._last || []).map(p => ({name: p.name, file: p.file}))].slice(0, 10);
    const slots = [6, 7, 8, 9, 10, 16, 17, 18, 19, 20], o = {...common, 1: {l: 'SAVE', fn: async () => { const n = OFP.next(); const j = await OFP.save(n); mfdMsg(side, j.ok ? 'SAVED ' + n : 'SAVE FAILED'); OFP._last = null; }}};
    list.forEach((it, i) => { o[slots[i]] = {l: it.builtin ? (it.builtin === 'hornet' ? 'HORNET' : 'CLASSC') : it.name.slice(0, 7), on: store.get('ofpCur', '') === it.name || (it.builtin && OFPM.get() === it.builtin && !store.get('ofpCur', '')),
      fn: () => it.builtin ? ofpUseBuiltin(it.builtin) : OFP.load(it.file)}; });
    return {title: 'OFP', osb: o, body: box('OFP', 'NOW: ' + esc(store.get('ofpCur', '—')), list.map((it, i) => `<div class="mrow"><span>${slots[i]}</span><b>${esc(it.name)}</b></div>`).join('') + '<div class="mnote">SAVE = THIS SETUP AS THE NEXT OFP</div>')};
  }
  // every other page: ARIA's own page under its Hornet name, with MENU bottom-center
  const d = _pageDef0(side);
  if (HN[p]) d.title = HN[p];
  if (d.osb) { if (d.osb[15] && d.osb[15].l === 'MENU') delete d.osb[15]; d.osb[11] = common[11]; }
  return d;
};
// MENU bottom-center on all three MFDs (Hornet PB 18 ↔ Cougar OSB 13); whatever a page had there slides to a free bottom button
const _pageDef = pageDef;
pageDef = function (side) {
  if (!OFPM.hornet()) return _pageDef(side);
  const d = pageDef0(side);
  if (d.osb && MFDS[side].page !== 'MENU') {
    const m = d.osb[13], menu = {l: 'MENU', fn: () => { MFDS[side].menu = MFDS[side].menu || 'TAC'; mfdGo(side, 'MENU'); }};
    if (m && m.l !== 'MENU') { const free = [14, 12, 15].find(n => !d.osb[n]); if (free) d.osb[free] = m; }
    d.osb[13] = menu;
  }
  return d;
};

/* ---------------- switching OFPs ---------------- */
function ofpUseBuiltin(mode) {
  store.set('ofpMode', mode); store.set('ofpCur', mode === 'hornet' ? 'OFP 2 · HORNET' : 'OFP 1 · CLASSIC');
  applyOfpLook();
  if (mode === 'hornet') ofpMaster(store.get('ofpMM', 'NAV')); else { mfdGo('L', 'MENU'); mfdGo('R', 'NAV'); mfdGo('C', 'MAP'); }
  mfdRenderAll(); toast(mode === 'hornet' ? 'OFP 2 · Hornet loaded.' : 'OFP 1 · Classic loaded.');
}
function applyOfpLook() { document.body.classList.toggle('ofphornet', OFPM.hornet()); }
applyOfpLook();
// first run of this version: OFP 2 is built and becomes what you fly (OFP 1 stays saved — switch back on SUPT ▸ OFP)
setTimeout(async () => {
  if (store.get('ofp2Built', false)) return;
  store.set('ofpMode', 'hornet'); applyOfpLook();
  const l = await OFP.list(); if (!l.some(p => p.name === 'OFP 2')) await OFP.save('OFP 2');
  store.set('ofpCur', 'OFP 2'); store.set('ofp2Built', true);
  if (CK.on) ofpMaster('NAV');
}, 7000);
