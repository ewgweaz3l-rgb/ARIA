/* pit.js — OVERWATCH cockpit panels for the Hornet, on the MFD screen around DCS's own viewports.

   ARIA goes full screen on the MFD monitor, then Windows cuts its window down to just ARIA's panels
   (SetWindowRgn): the DDI / AMPCD viewports are holes, so DCS shows through and its displays stay live.
     • center: UFC face (drawn by ARIA, text from the jet) ⇄ AMPCD (DCS's display inside a clickable bezel)
     • left / right DDI: optional OSB rings (off by default — the Cougars are the real bezels)
     • the bottom band (ARIA + teletype) indents under the panels, overlaps, or hides
   Clicks go to DCS through DCS-BIOS ("UFC_1 1" / "UFC_1 0"), then focus goes back to DCS. */

const PIT = {
  on: false, held: null, warned: false, bandOpen: false,
  cfg: Object.assign({center: 'ufc', amp: true, osbL: false, osbR: false, ring: 13, ddiRing: 9, spread: 70, band: 'indent', dim: 100}, store.get('dcsPit', {}))
};
function pitSave() { store.set('dcsPit', PIT.cfg); }

/* ---------------- geometry (px of a W×H screen; the DCS boxes are kept in %) ---------------- */
const pct = (r, W, H) => ({x: r.x / 100 * W, y: r.y / 100 * H, w: r.w / 100 * W, h: r.h / 100 * H});
// AMPCD: the CENTER box is the whole unit; the display is the square inside the bezel ring
function ampGeo(r, W, H) {
  const o = pct(r, W, H), t = Math.min(o.w, o.h) * PIT.cfg.ring / 100, side = Math.max(10, Math.min(o.w, o.h) - 2 * t);
  const disp = {x: o.x + (o.w - side) / 2, y: o.y + (o.h - side) / 2, w: side, h: side};
  return {outer: o, disp, t, bezel: {x: disp.x - t, y: disp.y - t, w: side + 2 * t, h: side + 2 * t}};
}
// DDI: the box IS the display (lined up with the Cougar); the ring goes around it, clipped to the screen
function ddiGeo(r, W, H) {
  const disp = pct(r, W, H), t = Math.min(disp.w, disp.h) * PIT.cfg.ddiRing / 100;
  const x0 = Math.max(0, disp.x - t), y0 = Math.max(0, disp.y - t), x1 = Math.min(W, disp.x + disp.w + t), y1 = Math.min(H, disp.y + disp.h + t);
  return {disp, t, bezel: {x: x0, y: y0, w: x1 - x0, h: y1 - y0}};
}
// the viewport DCS should draw into (dcsCompute uses this, so the written file matches the bezel)
function pitViewRect(key, r, W, H) {
  if (key === 'CENTER_MFCD' && PIT.cfg.amp) return ampGeo(r, W, H).disp;
  return pct(r, W, H);
}

/* ---------------- what each button sends ---------------- */
const pad2 = n => String(n).padStart(2, '0');
// Hornet bezel numbering, clockwise: left 1-5 (top→bottom), top 6-10 (left→right), right 11-15 (top→bottom), bottom 16-20 (right→left)
function osbSpots(g) {
  const d = g.disp, sp = PIT.cfg.spread / 100, out = [];
  const along = (len, i) => len * (0.5 + (i - 2) * sp / 4.6);
  const mid = (a, b) => (a + b) / 2;
  const L = mid(g.bezel.x, d.x), R = mid(d.x + d.w, g.bezel.x + g.bezel.w), T = mid(g.bezel.y, d.y), B = mid(d.y + d.h, g.bezel.y + g.bezel.h);
  for (let i = 0; i < 5; i++) out.push({n: 1 + i, x: L, y: d.y + along(d.h, i), side: 'l'});
  for (let i = 0; i < 5; i++) out.push({n: 6 + i, x: d.x + along(d.w, i), y: T, side: 't'});
  for (let i = 0; i < 5; i++) out.push({n: 11 + i, x: R, y: d.y + along(d.h, i), side: 'r'});
  for (let i = 0; i < 5; i++) out.push({n: 16 + i, x: d.x + along(d.w, 4 - i), y: B, side: 'b'});
  return out;
}
const PIT_CORNERS = {
  AMPCD: {tl: ['BRT', 'step', 'AMPCD_BRT_CTL'], tr: ['SYM', 'rock', 'AMPCD_SYM_SW'], bl: ['GAIN', 'rock', 'AMPCD_GAIN_SW'], br: ['CONT', 'rock', 'AMPCD_CONT_SW']},
  LEFT_DDI: {tl: ['BRT', 'step', 'LEFT_DDI_BRT_CTL'], tr: ['CONT', 'step', 'LEFT_DDI_CONT_CTL'], bl: ['MODE', 'sel', 'LEFT_DDI_BRT_SELECT']},
  RIGHT_DDI: {tl: ['BRT', 'step', 'RIGHT_DDI_BRT_CTL'], tr: ['CONT', 'step', 'RIGHT_DDI_CONT_CTL'], bl: ['MODE', 'sel', 'RIGHT_DDI_BRT_SELECT']}
};
// up / down halves of a corner control → [press cmds, release cmds]
function cornerCmds(kind, name, up) {
  if (kind === 'step') return [[[name, up ? '+3200' : '-3200']], null];
  if (kind === 'sel') return [[[name, up ? 'INC' : 'DEC']], null];
  return [[[name, up ? '2' : '0']], [[name, '1']]];  // spring-loaded rocker: back to the middle on release
}
const PIT_KEYS = [['1', ''], ['2', 'N'], ['3', ''], ['4', 'W'], ['5', ''], ['6', 'E'], ['7', ''], ['8', 'S'], ['9', ''], ['CLR', ''], ['0', ''], ['ENT', '']];
const PIT_FN = [['AP', 'A/P'], ['IFF', 'IFF'], ['TCN', 'TCN'], ['ILS', 'ILS'], ['DL', 'D/L'], ['BCN', 'BCN'], ['ONOFF', 'ON/OFF']];
function pitAllIds() {
  const ids = ['UFC_0', 'UFC_1', 'UFC_2', 'UFC_3', 'UFC_4', 'UFC_5', 'UFC_6', 'UFC_7', 'UFC_8', 'UFC_9', 'UFC_CLR', 'UFC_ENT', 'UFC_IP', 'UFC_EMCON', 'UFC_ADF', 'UFC_BRT',
    'UFC_COMM1_CHANNEL_SELECT', 'UFC_COMM2_CHANNEL_SELECT', 'UFC_COMM1_PULL', 'UFC_COMM2_PULL', 'UFC_COMM1_VOL', 'UFC_COMM2_VOL'];
  PIT_FN.forEach(([k]) => ids.push('UFC_' + k)); for (let i = 1; i <= 5; i++) ids.push('UFC_OS' + i);
  for (const p of ['AMPCD', 'LEFT_DDI', 'RIGHT_DDI']) { for (let i = 1; i <= 20; i++) ids.push(`${p}_PB_${pad2(i)}`); Object.values(PIT_CORNERS[p]).forEach(c => ids.push(c[2])); }
  return ids;
}

/* ---------------- sending ---------------- */
async function bios(cmds, focus) {
  if ((!cmds || !cmds.length) && !focus) return;
  const b = DCS.st && DCS.st.bios;
  if (b && !b.installed && !PIT.warned) { PIT.warned = true; toast('Cockpit clicks need <b>DCS-BIOS</b> (Skunkworks) installed — the UFC text still shows without it. See DCS → Settings → Cockpit panels.', 9000); }
  try { await fetch('/api/dcs/bios', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cmds, focus: !!focus})}); } catch {}
}
// press / hold / release on any element with data-p (press cmds) and data-r (release cmds); steps repeat while held
function pitPointer(root) {
  root.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-p]'); if (!el) return;
    e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); el.classList.add('down');
    const press = JSON.parse(el.dataset.p), rel = el.dataset.r ? JSON.parse(el.dataset.r) : null;
    bios(press, false);
    let rep = 0;
    if (el.dataset.rep) rep = setInterval(() => bios(press, false), 130);
    const up = () => { el.classList.remove('down'); clearInterval(rep); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      bios(rel || [], true); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  root.addEventListener('wheel', e => {  // knobs: scroll to turn
    const el = e.target.closest('[data-wheel]'); if (!el) return;
    e.preventDefault(); const [name, kind] = el.dataset.wheel.split(':'), up = e.deltaY < 0;
    bios([[name, kind === 'step' ? (up ? '+3200' : '-3200') : (up ? 'INC' : 'DEC')]], false);
  }, {passive: false});
}
const pbtn = (name) => `data-p='${JSON.stringify([[name, '1']])}' data-r='${JSON.stringify([[name, '0']])}'`;

/* ---------------- drawing ---------------- */
// the UFC ⇄ AMPCD toggle: a two-position lever (also on a key / HOTAS button: Settings → Cockpit panels)
function pitSwitchHtml(cls, style) {
  const up = PIT.cfg.center === 'ufc';
  return `<button class="pswitch ${up ? 'up' : 'dn'} ${cls}" id="pitSwapC" style="${style}" title="Center display: flip between the UFC face and the AMPCD${PIT.keyLabel ? ' (or press ' + esc(PIT.keyLabel) + ')' : ''}">
    <span class="${up ? 'on' : ''}">UFC</span><i><b></b></i><span class="${up ? '' : 'on'}">AMPCD</span></button>`;
}
function pitFlip() { PIT.cfg.center = PIT.cfg.center === 'ufc' ? 'ampcd' : 'ufc'; pitSave(); pitLayout(); pitSettingsSync(); }

/* ---------------- drawing (panels) ---------------- */
function ringHtml(id, kind, g) {
  const b = g.bezel, d = g.disp, s = Math.min(g.t * .72, d.w * PIT.cfg.spread / 100 / 5 * .8);
  const bw = {t: d.y - b.y, l: d.x - b.x, r: b.x + b.w - d.x - d.w, b: b.y + b.h - d.y - d.h};
  const osb = osbSpots(g).map(o => `<button class="osb osb-${o.side}" title="${kind} PB ${o.n}" ${pbtn(`${kind}_PB_${pad2(o.n)}`)}
      style="left:${o.x - b.x - s / 2}px;top:${o.y - b.y - s / 2}px;width:${s}px;height:${s}px"><i>${o.n}</i></button>`).join('');
  const cs = Math.min(bw.t, bw.l, bw.r, bw.b) * .9, cc = PIT_CORNERS[kind] || {};
  const corner = Object.entries(cc).map(([pos, [label, k, name]]) => {
    const [pu, ru] = cornerCmds(k, name, true), [pd, rd] = cornerCmds(k, name, false), rep = k === 'step' ? 'data-rep="1"' : '';
    const st = `${pos[0] === 't' ? 'top' : 'bottom'}:${Math.max(2, (pos[0] === 't' ? bw.t : bw.b) / 2 - cs / 2)}px;${pos[1] === 'l' ? 'left' : 'right'}:${Math.max(2, (pos[1] === 'l' ? bw.l : bw.r) / 2 - cs / 2)}px;width:${cs}px;height:${cs}px`;
    return `<div class="pcorner" style="${st}" title="${label} — click ▲/▼, or scroll" data-wheel="${name}:${k === 'step' ? 'step' : 'sel'}">
      <button class="pc-up" data-p='${JSON.stringify(pu)}' ${ru ? `data-r='${JSON.stringify(ru)}'` : ''} ${rep}>▲</button><b>${label}</b>
      <button class="pc-dn" data-p='${JSON.stringify(pd)}' ${rd ? `data-r='${JSON.stringify(rd)}'` : ''} ${rep}>▼</button></div>`;
  }).join('');
  return `<div class="pring" id="${id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border-width:${bw.t}px ${bw.r}px ${bw.b}px ${bw.l}px">
    <div class="pinner" style="left:${-bw.l}px;top:${-bw.t}px;width:${b.w}px;height:${b.h}px">${osb}${corner}</div></div>`;
}
function ufcHtml(o) {
  const u = Math.min(o.h / 100, o.w / 140);
  const osw = [1, 2, 3, 4, 5].map(i => `<button class="puos" ${pbtn('UFC_OS' + i)} title="Option ${i}"><span class="pucue" data-u="UFC_OptionCueing${i}"></span><span class="puopt" data-u="UFC_OptionDisplay${i}">----</span></button>`).join('');
  const keys = PIT_KEYS.map(([k, l]) => `<button class="pukey ${k.length > 1 ? 'puw' : ''}" ${pbtn('UFC_' + k)}>${k}${l ? `<small>${l}</small>` : ''}</button>`).join('');
  const fn = PIT_FN.map(([k, l]) => `<button class="pufn" ${pbtn('UFC_' + k)}>${l}</button>`).join('');
  const comm = n => `<div class="pucomm"><div class="puchan" data-u="UFC_Comm${n}Display">--</div>
      <div class="puknob" data-wheel="UFC_COMM${n}_CHANNEL_SELECT:sel" title="COMM ${n} channel — scroll, or click ◀ ▶; middle pulls (guard / manual)">
        <button data-p='${JSON.stringify([[`UFC_COMM${n}_CHANNEL_SELECT`, 'DEC']])}'>◀</button>
        <button class="pupull" ${pbtn(`UFC_COMM${n}_PULL`)}>${n}</button>
        <button data-p='${JSON.stringify([[`UFC_COMM${n}_CHANNEL_SELECT`, 'INC']])}'>▶</button></div>
      <div class="puvol" data-wheel="UFC_COMM${n}_VOL:step"><button data-rep="1" data-p='${JSON.stringify([[`UFC_COMM${n}_VOL`, '-3200']])}'>−</button><b>VOL ${n}</b><button data-rep="1" data-p='${JSON.stringify([[`UFC_COMM${n}_VOL`, '+3200']])}'>+</button></div></div>`;
  return `<div class="pufc" id="pitUfc" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;--u:${u}px">
    <div class="puleft">
      <button class="puside" ${pbtn('UFC_IP')}>I/P</button>
      <div class="puadf" title="ADF 1 / OFF / 2"><b>ADF</b><button data-p='${JSON.stringify([['UFC_ADF', '2']])}'>1</button><button data-p='${JSON.stringify([['UFC_ADF', '1']])}'>OFF</button><button data-p='${JSON.stringify([['UFC_ADF', '0']])}'>2</button></div>
      <button class="puside" ${pbtn('UFC_EMCON')}>EMCON</button>
      <div class="puvol" data-wheel="UFC_BRT:step"><button data-rep="1" data-p='${JSON.stringify([['UFC_BRT', '-3200']])}'>−</button><b>BRT</b><button data-rep="1" data-p='${JSON.stringify([['UFC_BRT', '+3200']])}'>+</button></div>
    </div>
    <div class="pumid">
      <div class="puscratch"><span data-u="UFC_ScratchPadString1Display"></span><span data-u="UFC_ScratchPadString2Display"></span><span class="punum" data-u="UFC_ScratchPadNumberDisplay"></span></div>
      <div class="pukeys">${keys}</div>
    </div>
    <div class="puright">${osw}</div>
    <div class="pufns">${fn}</div>
    <div class="pucomms">${comm(1)}${pitSwitchHtml('', 'position:relative')}${comm(2)}</div>
  </div>`;
}
// Hornet UFC glyphs: ` and ~ are the narrow "1" and "2" of two-digit COMM channels
const ufcGlyph = s => String(s == null ? '' : s).replace(/`/g, '1').replace(/~/g, '2');
function pitUfcText() {
  const box = $('#pitUfc'); if (!box) return;
  const u = (DCS.feed && DCS.feed.state && DCS.feed.state.ufc) || null;
  box.classList.toggle('nodata', !u);
  $$('[data-u]', box).forEach(el => { const v = u ? u[el.dataset.u] : null; el.textContent = v == null ? (el.classList.contains('puopt') ? '' : '') : ufcGlyph(v); });
}

function pitLayout() {
  const root = $('#dcsPit'); if (!root || !PIT.on) return;
  const W = innerWidth, H = innerHeight, R = dcsRects(), c = PIT.cfg, panels = [];
  let html = '';
  if (c.osbL && DCS.layout.use.LEFT_MFCD) { const g = ddiGeo(R.LEFT_MFCD, W, H); html += ringHtml('pitL', 'LEFT_DDI', g); panels.push(g); }
  if (c.osbR && DCS.layout.use.RIGHT_MFCD) { const g = ddiGeo(R.RIGHT_MFCD, W, H); html += ringHtml('pitR', 'RIGHT_DDI', g); panels.push(g); }
  let ufcBox = null;
  if (c.center === 'ufc') { ufcBox = pct(R.CENTER_MFCD, W, H); html += ufcHtml(ufcBox); }
  else {  // AMPCD: always a clickable bezel — inside the box when the viewport is inset, around it otherwise
    const g = c.amp ? ampGeo(R.CENTER_MFCD, W, H) : ddiGeo(R.CENTER_MFCD, W, H); html += ringHtml('pitC', 'AMPCD', g); panels.push(g);
    const o = pct(R.CENTER_MFCD, W, H), spare = o.x + o.w - (g.bezel.x + g.bezel.w), sw = 64, sh = 92;
    const x = spare >= sw + 8 ? g.bezel.x + g.bezel.w + (spare - sw) / 2 : g.bezel.x + g.bezel.w + 6;
    html += pitSwitchHtml('', `position:absolute;left:${x}px;top:${g.bezel.y + g.bezel.h - sh}px`); }
  // the band: indented under whatever panels reach into it, overlapped, or hidden
  let band = pct(R.BAND, W, H);
  const blockers = panels.map(g => g.bezel).concat(ufcBox ? [ufcBox] : []);
  if (c.band === 'indent') {
    let top = band.y;
    for (const b of blockers) if (b.x < band.x + band.w && b.x + b.w > band.x && b.y < band.y + band.h && b.y + b.h > top) top = b.y + b.h + 4;
    band = {...band, y: top, h: Math.max(120, band.y + band.h - top)};
  }
  const hidden = c.band === 'hide' && !PIT.bandOpen;
  root.innerHTML = html + `<div id="pitDock" style="right:${W - band.x - band.w + 8}px;top:${band.y + band.h - 32}px">
      <button data-a="center">${c.center === 'ufc' ? 'UFC' : 'AMPCD'} ⇄</button><button data-a="osbL" class="${c.osbL ? 'on' : ''}">OSB L</button><button data-a="osbR" class="${c.osbR ? 'on' : ''}">OSB R</button>
      <button data-a="dim" title="Brightness of ARIA's panels (the DCS displays have their own BRT on the bezels)">☼ ${c.dim}%</button>${c.band === 'hide' ? `<button data-a="band">${PIT.bandOpen ? '▾ ARIA' : '▴ ARIA'}</button>` : ''}<button data-a="exit" title="Leave cockpit mode">✕</button></div>`;
  root.style.setProperty('--pitDim', c.dim / 100);
  // ARIA itself (header, tabs, ask bar) + the teletype live in the band
  const shell = $('#appShell'), tt = $('#dcsTT'), ttH = Math.min(96, band.h * .3);
  document.body.classList.toggle('pitbandhide', hidden);
  Object.assign(shell.style, {left: band.x + 'px', top: band.y + 'px', width: band.w + 'px', height: Math.max(40, band.h - ttH) + 'px'});
  Object.assign(tt.style, {left: band.x + 'px', right: 'auto', width: band.w + 'px', top: band.y + band.h - ttH + 'px', bottom: 'auto', height: ttH + 'px'});
  PIT.band = hidden ? null : band;
  pitUfcText(); pitShape();
}
// tell Windows which parts of the window are ARIA's — everything else (the viewports) shows DCS
let pitShapeT = 0;
function pitShape() {
  clearTimeout(pitShapeT);
  pitShapeT = setTimeout(() => {
    if (!PIT.on) return;
    const k = devicePixelRatio || 1, rects = [];
    const add = r => rects.push({x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k});
    const el = id => { const e = $(id); if (e) { const b = e.getBoundingClientRect(); add({x: b.left, y: b.top, w: b.width, h: b.height}); } };
    if (PIT.band) add(PIT.band);
    el('#pitDock'); el('#pitUfc'); el('#pitSwapC');
    for (const id of ['#pitL', '#pitR', '#pitC']) {  // rings as four strips, so the display stays a hole
      const r = $(id); if (!r) continue; const b = r.getBoundingClientRect(), cs = getComputedStyle(r);
      const t = parseFloat(cs.borderTopWidth), l = parseFloat(cs.borderLeftWidth), rt = parseFloat(cs.borderRightWidth), bt = parseFloat(cs.borderBottomWidth);
      add({x: b.left, y: b.top, w: b.width, h: t}); add({x: b.left, y: b.bottom - bt, w: b.width, h: bt});
      add({x: b.left, y: b.top + t, w: l, h: b.height - t - bt}); add({x: b.right - rt, y: b.top + t, w: rt, h: b.height - t - bt});
    }
    const body = $('.modal.on, #dcsEd') ? {off: true} : {rects: rects.map(r => ({x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h)})), topmost: true};
    const sig = JSON.stringify(body); if (sig === PIT.lastShape) return; PIT.lastShape = sig;  // only tell Windows when it changes
    fetch('/api/dcs/shape', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: sig}).catch(() => {});
  }, 120);
}

/* ---------------- in / out ---------------- */
async function pitEnter() {
  if (typeof dcsInit === 'function') dcsInit();
  if (!DCS.monsUse) await dcsRefresh();
  const m = (DCS.monsUse || []).find(x => x.device === DCS.layout.mfd);
  if (m && DCS.mons.length) await dcsPost('window', {rect: {x: m.x, y: m.y, w: m.w, h: m.h}});
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); }
  catch { toast('Press F11 so ARIA fills the MFD screen — the panels line up with the viewports only in full screen.', 8000); }
  PIT.on = true; document.body.classList.add('dcsck');
  if (!$('#dcsPit')) { const d = document.createElement('div'); d.id = 'dcsPit'; document.body.appendChild(d); pitPointer(d); d.addEventListener('click', pitDockClick); }
  setTimeout(pitLayout, 350); setTimeout(pitLayout, 1200);
  // DCS takes the foreground whenever you fly; keep ARIA's panels above it
  clearInterval(PIT.keep); PIT.keep = setInterval(() => { if (PIT.on && !$('.modal.on, #dcsEd')) fetch('/api/dcs/shape', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ping: true})}).catch(() => {}); }, 2000);
  pitKeyStream();
  dlogAdd('PIT', 'Cockpit panels on the MFD screen.');
}
async function pitExit() {
  if (!PIT.on) return;
  PIT.on = false; PIT.lastShape = ''; clearInterval(PIT.keep); document.body.classList.remove('dcsck', 'pitbandhide');
  $('#dcsPit') && ($('#dcsPit').innerHTML = '');
  ['#appShell', '#dcsTT'].forEach(id => $(id).removeAttribute('style'));
  await fetch('/api/dcs/shape', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({off: true})}).catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (typeof dcsUnfly === 'function') dcsUnfly();
}
function pitDockClick(e) {
  const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a, c = PIT.cfg;
  if (e.target.closest('#pitSwapC')) { pitFlip(); fetch('/api/dcs/bios', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cmds: [], focus: true})}).catch(() => {}); return; }
  if (!a) return;
  if (a === 'center') { pitFlip(); return; }
  else if (a === 'osbL' || a === 'osbR') c[a] = !c[a];
  else if (a === 'dim') { const steps = [100, 75, 55, 35, 20]; c.dim = steps[(steps.indexOf(c.dim) + 1) % steps.length] || 100; }
  else if (a === 'band') PIT.bandOpen = !PIT.bandOpen;
  else if (a === 'exit') { pitExit(); return; }
  pitSave(); pitLayout(); pitSettingsSync();
}
addEventListener('resize', () => { if (PIT.on) pitLayout(); });
// the swap key / HOTAS button (watched system-wide by ARIA, so it works while DCS has focus)
function pitKeyStream() {
  if (PIT.es) return;
  try { PIT.es = new EventSource('/api/pitkey/stream');
    PIT.es.onmessage = ev => { try { const st = JSON.parse(ev.data); PIT.keyLabel = st.binding ? st.binding.label : '';
      if (PIT.keySeq != null && st.seq > PIT.keySeq && PIT.on) pitFlip(); PIT.keySeq = st.seq;
      const l = $('#pitKeyLbl'); if (l) l.textContent = st.learning ? 'press it now…' : (st.binding ? st.binding.label : 'none'); } catch {} }; } catch {}
}
document.addEventListener('fullscreenchange', () => {  // Esc out of full screen = leave cockpit mode
  if (!PIT.on) return; if (document.fullscreenElement) { PIT.full = true; setTimeout(pitLayout, 200); } else if (PIT.full) { PIT.full = false; pitExit(); } });
// modals (settings etc.) need the whole window while they're open
new MutationObserver(() => { if (PIT.on) pitShape(); }).observe(document.body, {attributes: true, attributeFilter: ['class'], childList: true});
addEventListener('DOMContentLoaded', () => { const m = $('#modal'); if (m) new MutationObserver(() => { if (PIT.on) pitShape(); }).observe(m, {attributes: true, attributeFilter: ['class']}); });

/* ---------------- settings panel ---------------- */
function pitSettingsSync() {
  const c = PIT.cfg, f = id => $('#' + id);
  if (!f('pitCenter')) return;
  f('pitCenter').value = c.center; f('pitAmp').checked = c.amp; f('pitOsbL').checked = c.osbL; f('pitOsbR').checked = c.osbR;
  f('pitRing').value = c.ring; f('pitDdiRing').value = c.ddiRing; f('pitSpread').value = c.spread; f('pitBand').value = c.band; f('pitDim').value = c.dim;
  f('pitRingV').textContent = c.ring + '%'; f('pitDdiRingV').textContent = c.ddiRing + '%'; f('pitSpreadV').textContent = c.spread + '%'; f('pitDimV').textContent = c.dim + '%';
  const b = DCS.st && DCS.st.bios, el = f('pitBios');
  if (el) {
    if (!b) el.innerHTML = '<span class="sub">checking…</span>';
    else if (!b.installed) el.innerHTML = '<span class="warn">DCS-BIOS not found</span> — the UFC face shows the jet\'s text without it, but clicks need it. Install the Skunkworks <b>DCS-BIOS</b> release into <span class="mono">Saved Games\\DCS\\Scripts</span> (it adds its own line to Export.lua, next to ARIA\'s).';
    else {
      const miss = b.hornet_ids ? pitAllIds().filter(i => !b.hornet_ids.includes(i)) : [];
      el.innerHTML = `<span class="good">DCS-BIOS found</span>${b.hooked ? '' : ' <span class="warn">— but it isn\'t in Export.lua yet (run its installer / add its line)</span>'}` +
        (b.hornet_ids ? (miss.length ? `<br><span class="warn">${miss.length} control${miss.length > 1 ? 's' : ''} ARIA draws aren't in your DCS-BIOS Hornet list:</span> <span class="mono sub">${esc(miss.slice(0, 14).join(' '))}${miss.length > 14 ? ' …' : ''}</span>` : ' · every Hornet control ARIA draws matches') : '');
    }
  }
}
function pitSettingsInit() {
  const c = PIT.cfg, f = id => $('#' + id); if (!f('pitCenter') || f('pitCenter')._w) return; f('pitCenter')._w = 1;
  const upd = (rewrite) => { pitSave(); pitSettingsSync(); if (PIT.on) pitLayout(); if (rewrite) { dcsRenderLayout(); toast('The AMPCD viewport moved — hit <b>Write to DCS</b> and restart DCS to match.', 6000); } };
  f('pitCenter').onchange = () => { c.center = f('pitCenter').value; upd(); };
  f('pitAmp').onchange = () => { c.amp = f('pitAmp').checked; upd(true); };
  f('pitOsbL').onchange = () => { c.osbL = f('pitOsbL').checked; upd(); };
  f('pitOsbR').onchange = () => { c.osbR = f('pitOsbR').checked; upd(); };
  f('pitRing').oninput = () => { c.ring = +f('pitRing').value; upd(); }; f('pitRing').onchange = () => upd(true);
  f('pitDdiRing').oninput = () => { c.ddiRing = +f('pitDdiRing').value; upd(); };
  f('pitSpread').oninput = () => { c.spread = +f('pitSpread').value; upd(); };
  f('pitBand').onchange = () => { c.band = f('pitBand').value; PIT.bandOpen = false; upd(); };
  f('pitDim').oninput = () => { c.dim = +f('pitDim').value; upd(); };
  f('pitGo').onclick = pitEnter;
  f('pitKeyLearn').onclick = () => { fetch('/api/pitkey/learn', {method: 'POST'}); $('#pitKeyLbl').textContent = 'press it now…'; };
  f('pitKeyClear').onclick = () => fetch('/api/pitkey/clear', {method: 'POST'});
  pitKeyStream();
  pitSettingsSync();
}
