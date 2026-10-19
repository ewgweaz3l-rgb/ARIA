/* dcs.js — ARIA for DCS World.
   Boot: callsign (asked once, kept until changed) → pick STAR CITIZEN or DCS WORLD.
   DCS: viewports (the real DDIs / AMPCD drawn by DCS onto the boxes you aligned on your MFD screen),
   live flight data from an Export.lua add-on, FLY mode that shrinks ARIA out of the displays' way. */

const GAMEMODE = {get: () => store.get('game', 'sc'), set(g) { store.set('game', g); applyGameMode(); }};
const DCSV = [['LEFT_MFCD', 'Left DDI', 'L'], ['RIGHT_MFCD', 'Right DDI', 'R'], ['CENTER_MFCD', 'AMPCD', 'TOP']];
const DCS = {st: null, es: null, feed: null, mons: [], layout: store.get('dcsLayout', {name: 'Cougar Hornet', use: {LEFT_MFCD: true, RIGHT_MFCD: true, CENTER_MFCD: true}})};

/* ---------------- boot: callsign → game ---------------- */
function bootStep() {
  const box = $('#bootBtns'), msg = $('#bootMsg');
  if (!store.get('callsign', '') && !store.get('pilotSet', false)) {
    msg.textContent = 'Callsign?';
    box.innerHTML = `<input id="csIn" type="text" maxlength="12" value="${esc(PILOT() !== 'CMDR' ? PILOT() : '')}" placeholder="e.g. WEAZEL" style="width:180px;text-align:center;font:600 16px var(--mono);text-transform:uppercase"><button class="btn" id="csOk">Save</button>`;
    const go = () => { const v = $('#csIn').value.trim().toUpperCase().slice(0, 12); if (!v) { $('#csIn').focus(); return; }
      store.set('callsign', v); store.set('pilot', v.slice(0, 10)); store.set('pilotSet', true); bootStep(); };
    $('#csOk').onclick = go; $('#csIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } };  // preventDefault: no keypress → the newly focused game button isn't "clicked" setTimeout(() => $('#csIn').focus(), 30);
    return;
  }
  const cs = store.get('callsign', '') || PILOT();
  msg.innerHTML = `Welcome back, <b>${esc(cs)}</b>. <a href="#" id="csChange" style="color:var(--dim);font-size:12px">change</a>`;
  const last = GAMEMODE.get();
  box.innerHTML = `<div class="gamepick">
    <button class="gp ${last === 'sc' ? 'last' : ''}" data-g="sc"><span class="gpico"><img alt="" hidden><i>SC</i></span><b>STAR CITIZEN</b><small>trade · mining · cockpit</small></button>
    <button class="gp ${last === 'dcs' ? 'last' : ''}" data-g="dcs"><span class="gpico"><img alt="" hidden><i>DCS</i></span><b>DCS WORLD</b><small>viewports · flight data · GCI</small></button></div>`;
  $$('.gp', box).forEach(b => { const im = $('img', b); im.onload = () => { im.hidden = false; $('i', b).style.display = 'none'; };
    im.src = b.dataset.g === 'sc' ? '/api/launcher_icon' : '/api/gameicon/dcs';
    b.onclick = () => { GAMEMODE.set(b.dataset.g); bootClose(); }; });
  $('#csChange').onclick = e => { e.preventDefault(); store.set('callsign', ''); store.set('pilotSet', false); bootStep(); };
  const k = e => { if (e.key === 'Enter' && !BOOT.dismissed && $('.gp')) { removeEventListener('keydown', k); GAMEMODE.set(last); bootClose(); } };
  addEventListener('keydown', k);
  setTimeout(() => { const l = $('.gp.last', box); if (l) l.focus(); }, 200);
}

/* ---------------- switching between the two ---------------- */
function applyGameMode() {
  const dcs = GAMEMODE.get() === 'dcs';
  document.body.classList.toggle('dcsmode', dcs);
  $('.brand span').textContent = dcs ? 'DCS WORLD' : 'QUARTERMASTER';
  const lb = $('#btnLaunch'); if (lb) { lb.title = dcs ? 'Start DCS World' : 'Start the RSI Launcher'; $('#launchIco').src = dcs ? '/api/gameicon/dcs' : '/api/launcher_icon'; }
  if (dcs) { if (typeof CK !== 'undefined' && CK.on && !CK.cal) setCockpit(false); show('dcs'); dcsInit(); }
  else if ($('#view-dcs').classList.contains('on')) show('rich');
}

/* ---------------- DCS page ---------------- */
function dcsInit() {
  if (!DCS.inited) {
    DCS.inited = true;
    $('#dcsInstall').onclick = async () => { const j = await dcsPost('install'); if (j.ok) toast(j.already ? 'Already installed.' : `Installed. Restart DCS (or the mission) to start the feed.${j.backup ? ' Your old Export.lua was backed up.' : ''}`, 7000); dcsRefresh(); };
    $('#dcsUninstall').onclick = async () => { await dcsPost('uninstall'); toast('Removed ARIA from Export.lua.'); dcsRefresh(); };
    $('#dcsAlign').onclick = () => dcsEditor();
    $('#dcsWrite').onclick = () => dcsWriteSetup(false);
    $('#dcsPreview').onclick = () => dcsWriteSetup(true);
    $('#dcsFly').onclick = dcsFly; $('#dcsUnfly').onclick = dcsUnfly;
    $('#dcsName').oninput = () => { DCS.layout.name = $('#dcsName').value; dcsSave(); };
    ['#dcsMain', '#dcsMfd'].forEach(id => $(id).onchange = () => { DCS.layout[id === '#dcsMain' ? 'main' : 'mfd'] = $(id).value; dcsSave(); dcsRenderLayout(); });
    $('#dcsPaths').onclick = async () => { const p = prompt('DCS install folder (the one with bin\\DCS.exe) — leave blank to auto-detect:', DCS.st && DCS.st.exe || ''); if (p === null) return;
      await fetch('/api/config', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({dcs_path: p.trim()})}); dcsRefresh(); };
    connectDcsFeed();
  }
  dcsRefresh();
}
async function dcsPost(act, body) {
  try { const r = await fetch('/api/dcs/' + act, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})}); const j = await r.json(); if (!j.ok && j.error) toast(esc(j.error), 7000); return j; }
  catch { toast('ARIA could not reach its helper.'); return {}; }
}
function dcsSave() { store.set('dcsLayout', DCS.layout); }
async function dcsRefresh() {
  try { DCS.st = await (await fetch('/api/dcs')).json(); } catch { DCS.st = null; }
  try { const d = await (await fetch('/api/displays')).json(); DCS.mons = d.displays || []; DCS.curDisp = d.current; } catch { DCS.mons = []; }
  const st = DCS.st || {};
  $('#dcsStat').innerHTML = [
    ['DCS install', st.exe ? `<span class="good">found</span> <span class="sub mono">${esc(st.exe)}</span>` : '<span class="warn">not found</span> — <a href="#" id="dcsPaths2">set folder</a>'],
    ['Saved Games', st.saved_games ? `<span class="good">found</span> <span class="sub mono">${esc(st.saved_games)}</span>` : '<span class="warn">not found — start DCS once</span>'],
    ['Flight data add-on', st.export_installed ? '<span class="good">installed</span>' : '<span class="warn">not installed</span>'],
    ['Live feed', st.feed && st.feed.live ? '<span class="good">receiving</span>' : '<span class="sub">waiting for DCS (fly a mission)</span>'],
    ['Viewport files', st.monitor_setups && st.monitor_setups.length ? esc(st.monitor_setups.join(', ')) : '<span class="sub">none yet</span>']
  ].map(([k, v]) => `<tr><td class="sub" style="width:150px">${k}</td><td>${v}</td></tr>`).join('');
  const p2 = $('#dcsPaths2'); if (p2) p2.onclick = e => { e.preventDefault(); $('#dcsPaths').click(); };
  $('#dcsInstall').style.display = st.export_installed ? 'none' : ''; $('#dcsUninstall').style.display = st.export_installed ? '' : 'none';
  // monitor pickers
  const mons = DCS.mons.length ? DCS.mons : [{device: 'main', name: 'Main monitor', x: 0, y: 0, w: 1920, h: 1080, primary: true}, {device: 'mfd', name: 'MFD monitor', x: 1920, y: 0, w: 1920, h: 1080}];
  DCS.monsUse = mons;
  const opt = sel => mons.map(m => `<option value="${esc(m.device)}" ${m.device === sel ? 'selected' : ''}>${esc(m.name)} · ${m.w}×${m.h}${m.primary ? ' · primary' : ''}</option>`).join('');
  if (!DCS.layout.main) DCS.layout.main = (mons.find(m => m.primary) || mons[0]).device;
  if (!DCS.layout.mfd) DCS.layout.mfd = (mons.find(m => m.device === DCS.curDisp) || mons.find(m => !m.primary) || mons[0]).device;
  $('#dcsMain').innerHTML = opt(DCS.layout.main); $('#dcsMfd').innerHTML = opt(DCS.layout.mfd); $('#dcsName').value = DCS.layout.name || 'Cougar Hornet';
  if (!DCS.mons.length) $('#dcsMonNote').innerHTML = '<span class="warn">ARIA can only read your monitors on Windows — these are placeholders.</span>';
  dcsRenderLayout();
}
// ARIA's cockpit alignment (left MFD, right MFD, center) IS the viewport layout — converted to DCS pixels here
function dcsCompute() {
  const mons = DCS.monsUse || [], main = mons.find(m => m.device === DCS.layout.main) || mons[0], mfd = mons.find(m => m.device === DCS.layout.mfd) || mons[1] || mons[0];
  if (!main || !mfd) return null;
  const ox = Math.min(main.x, mfd.x), oy = Math.min(main.y, mfd.y);
  const W = Math.max(main.x + main.w, mfd.x + mfd.w) - ox, H = Math.max(main.y + main.h, mfd.y + mfd.h) - oy;
  const R = dcsRects(), views = {};
  for (const [key, , ck] of DCSV) { if (!(DCS.layout.use || {})[key]) continue; const r = R[key];
    views[key] = {x: mfd.x - ox + r.x / 100 * mfd.w, y: mfd.y - oy + r.y / 100 * mfd.h, w: r.w / 100 * mfd.w, h: r.h / 100 * mfd.h}; }
  return {name: 'ARIA ' + (DCS.layout.name || 'Cockpit'), W, H, center: {x: main.x - ox, y: main.y - oy, w: main.w, h: main.h}, views, main, mfd, ox, oy};
}
function dcsRenderLayout() {
  const L = dcsCompute(); if (!L) return;
  const rows = DCSV.map(([key, label]) => { const v = L.views[key], on = (DCS.layout.use || {})[key];
    return `<tr><td><label class="chk"><input type="checkbox" data-use="${key}" ${on ? 'checked' : ''}> ${label}</label></td><td class="mono sub">${key}</td>${v ? `<td class="r num">${Math.round(v.x)}, ${Math.round(v.y)}</td><td class="r num">${Math.round(v.w)} × ${Math.round(v.h)}</td>` : '<td colspan="2" class="sub">off</td>'}</tr>`; }).join('');
  $('#dcsViews').innerHTML = `<tr><th>Display</th><th>DCS name</th><th class="r">Position</th><th class="r">Size</th></tr>${rows}
    <tr><td>Main view</td><td class="mono sub">Center</td><td class="r num">${L.center.x}, ${L.center.y}</td><td class="r num">${L.center.w} × ${L.center.h}</td></tr>`;
  $$('#dcsViews [data-use]').forEach(c => c.onchange = () => { DCS.layout.use = {...DCS.layout.use, [c.dataset.use]: c.checked}; dcsSave(); dcsRenderLayout(); });
  $('#dcsRes').innerHTML = `In DCS → Options → System: <b>Monitors</b> = “${esc(L.name)}”, <b>Resolution</b> = <b class="mono">${L.W} × ${L.H}</b> (it has to span both screens), <b>Full screen</b> off.`;
  // little picture of the layout
  const c = $('#dcsPic'), ctx = c.getContext('2d'), sc = Math.min(c.width / L.W, c.height / L.H);
  ctx.clearRect(0, 0, c.width, c.height);
  const box = (r, fill, stroke, label) => { ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.fillRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc); ctx.strokeRect(r.x * sc + .5, r.y * sc + .5, r.w * sc - 1, r.h * sc - 1);
    if (label) { ctx.fillStyle = stroke; ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.fillText(label, r.x * sc + 4, r.y * sc + 13); } };
  box(L.center, 'rgba(95,211,240,.08)', '#5fd3f0', 'MAIN VIEW');
  box({x: L.mfd.x - L.ox, y: L.mfd.y - L.oy, w: L.mfd.w, h: L.mfd.h}, 'rgba(255,255,255,.03)', '#55657c', 'MFD SCREEN');
  for (const [key, label] of DCSV) if (L.views[key]) box(L.views[key], 'rgba(90,208,138,.25)', '#5ad08a', label.toUpperCase());
}
async function dcsWriteSetup(preview) {
  const L = dcsCompute(); if (!L) return;
  const j = await dcsPost('monitorsetup', {preview, layout: {name: L.name, center: L.center, views: L.views}});
  if (!j.ok) return;
  $('#dcsLua').textContent = j.lua; $('#dcsLuaBox').open = true;
  if (!preview) { toast(`Written: ${esc(j.path)}. Now pick it in DCS → Options → System → Monitors.`, 9000); dcsRefresh(); }
}
// FLY: shrink ARIA to the bottom band so DCS's displays show through the MFD screen; RESTORE puts it back
async function dcsFly() {
  const L = dcsCompute(); if (!L) return; const r = dcsRects().BAND, m = L.mfd;
  const rect = {x: m.x + r.x / 100 * m.w, y: m.y + r.y / 100 * m.h, w: r.w / 100 * m.w, h: r.h / 100 * m.h};
  const j = await dcsPost('window', {rect});
  toast(j.ok ? 'ARIA moved to the bottom band — the DCS displays have the MFD screen.' : 'Couldn’t move the window (Windows only).');
}
async function dcsUnfly() { await fetch('/api/display', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({move: true})}); }

/* ---------------- live flight data ---------------- */
function connectDcsFeed() {
  if (DCS.es) return;
  try { DCS.es = new EventSource('/api/dcs/stream'); DCS.es.onmessage = ev => { try { DCS.feed = JSON.parse(ev.data); renderFlight(); } catch {} }; } catch {}
}
const R2D = 180 / Math.PI;
function dm(v, pos, neg) { if (v == null) return '—'; const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return `${v >= 0 ? pos : neg} ${d}°${m.toFixed(3).padStart(6, '0')}'`; }
function renderFlight() {
  const el = $('#dcsFlight'); if (!el) return;
  const f = DCS.feed || {}, s = f.state;
  $('#dcsLive').innerHTML = f.live ? '<span class="dot live"></span> LIVE' : '<span class="dot"></span> NO FEED';
  if (!s) { el.innerHTML = `<div class="sub">${DCS.st && !DCS.st.export_installed ? 'Install the flight data add-on (left), then fly any mission.' : 'Waiting for DCS — start a mission and get in a jet.'}</div>`; return; }
  const ft = m => m == null ? '—' : fmt(m * 3.28084), kt = v => v == null ? '—' : fmt(v * 1.94384);
  const hdg = s.hdg != null ? ((s.hdg * R2D) % 360 + 360) % 360 : null, fuel = s.fuel ? s.fuel.internal : null;
  const tiles = [['AIRCRAFT', (s.unit || '—').replace(/_/g, ' ')], ['PILOT', s.pilot || '—'], ['LAT', dm(s.lat, 'N', 'S')], ['LON', dm(s.lon, 'E', 'W')],
    ['ALT MSL', ft(s.alt) + ' ft'], ['AGL', ft(s.agl) + ' ft'], ['IAS', kt(s.ias) + ' kt'], ['TAS', kt(s.tas) + ' kt'], ['MACH', s.mach != null ? s.mach.toFixed(2) : '—'],
    ['HDG (T)', hdg != null ? String(Math.round(hdg)).padStart(3, '0') + '°' : '—'], ['VVI', s.vvi != null ? fmt(s.vvi * 196.85) + ' fpm' : '—'],
    ['AOA', s.aoa != null ? s.aoa.toFixed(1) + '°' : '—'], ['G', s.g != null ? s.g.toFixed(1) : '—'],
    ['FUEL INT', fuel == null ? '—' : fuel <= 1.5 ? Math.round(fuel * 100) + ' %' : fmt(fuel * 2.20462) + ' lb']];
  el.innerHTML = tiles.map(([k, v]) => `<div class="ftile"><span>${k}</span><b>${esc(String(v))}</b></div>`).join('');
}

/* ---------------- viewport editor: outlines on the MFD screen, drag / resize / nudge ----------------
   Boxes are kept in % of the screen ARIA is on (the MFD screen), so they survive resolution changes. */
const DCS_BOX = {LEFT_MFCD: 'LEFT DDI', RIGHT_MFCD: 'RIGHT DDI', CENTER_MFCD: 'AMPCD', BAND: 'ARIA BAND (FLY)'};
function dcsRects() {
  if (!DCS.layout.rects) {  // first time: start from the cockpit alignment, if there is one
    const R = typeof ckRects === 'function' ? ckRects() : {};
    DCS.layout.rects = {LEFT_MFCD: {...(R.L || {x: 2, y: 5, w: 23, h: 42})}, RIGHT_MFCD: {...(R.R || {x: 75, y: 5, w: 23, h: 42})},
      CENTER_MFCD: {...(R.TOP || {x: 30, y: 2, w: 40, h: 50})}, BAND: {...(R.APP || {x: 0, y: 56, w: 100, h: 44})}};
    dcsSave();
  }
  return DCS.layout.rects;
}
function dcsEditor() {
  const R = JSON.parse(JSON.stringify(dcsRects())), undo = [];
  let sel = 'LEFT_MFCD';
  const ed = document.createElement('div'); ed.id = 'dcsEd';
  ed.innerHTML = `<div class="dcsgrid"></div>${Object.entries(DCS_BOX).map(([k, l]) => `<div class="dcsbox ${k === 'BAND' ? 'band' : ''}" data-k="${k}"><b>${l}</b><span class="dcssz"></span>${['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map(h => `<i class="dh dh-${h}" data-h="${h}"></i>`).join('')}</div>`).join('')}
    <div class="dcspanel" id="dcsEdPanel"><div class="dcsph" id="dcsEdDrag"><b>VIEWPORTS</b><span class="sub">drag the panel by this bar</span></div>
      <div class="sub" style="margin:6px 0">Drag a box over each bezel. Edges and corners resize. Arrow keys nudge 1 px (Shift = 10, Ctrl+arrow = resize). Ctrl+Z undo.</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(DCS_BOX).map(([k, l]) => `<button class="btn ghost small" data-pick="${k}">${l}</button>`).join('')}</div>
      <div class="mono sub" id="dcsEdInfo" style="margin:8px 0"></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn ghost small" id="dcsEdUndo">↶ Undo</button><button class="btn ghost small" id="dcsEdCopy" title="Use the boxes from ARIA's Star Citizen cockpit alignment">From cockpit layout</button>
        <button class="btn ghost small" id="dcsEdCancel">Cancel</button><button class="btn small" id="dcsEdSave">Save</button></div></div>`;
  document.body.appendChild(ed);
  const W = () => innerWidth, H = () => innerHeight, px = v => Math.round(v * (devicePixelRatio || 1));
  const draw = () => {
    for (const el of $$('.dcsbox', ed)) { const r = R[el.dataset.k]; Object.assign(el.style, {left: r.x + 'vw', top: r.y + 'vh', width: r.w + 'vw', height: r.h + 'vh'});
      el.classList.toggle('sel', el.dataset.k === sel); $('.dcssz', el).textContent = `${px(r.w / 100 * W())} × ${px(r.h / 100 * H())}`; }
    $$('[data-pick]', ed).forEach(b => b.classList.toggle('on', b.dataset.pick === sel));
    const r = R[sel]; $('#dcsEdInfo').textContent = `${DCS_BOX[sel]} · x ${px(r.x / 100 * W())} y ${px(r.y / 100 * H())} · ${px(r.w / 100 * W())} × ${px(r.h / 100 * H())} px on this screen`;
  };
  const snap = () => { undo.push(JSON.stringify(R)); if (undo.length > 60) undo.shift(); };
  const close = save => { removeEventListener('keydown', key, true); ed.remove(); if (save) { DCS.layout.rects = R; dcsSave(); dcsRenderLayout(); toast('Viewports saved. Hit “Write to DCS” to update the file.'); } };
  // drag / resize
  ed.addEventListener('pointerdown', e => {
    const box = e.target.closest('.dcsbox'); if (!box) return;
    sel = box.dataset.k; draw(); snap(); e.preventDefault();
    const h = e.target.dataset.h || 'move', r = R[sel], o = {...r}, sx = e.clientX, sy = e.clientY;
    const mv = ev => { const dx = (ev.clientX - sx) / W() * 100, dy = (ev.clientY - sy) / H() * 100;
      if (h === 'move') { r.x = o.x + dx; r.y = o.y + dy; }
      else { if (h.includes('w')) { r.x = o.x + dx; r.w = Math.max(2, o.w - dx); } if (h.includes('e')) r.w = Math.max(2, o.w + dx);
        if (h.includes('n')) { r.y = o.y + dy; r.h = Math.max(2, o.h - dy); } if (h.includes('s')) r.h = Math.max(2, o.h + dy); }
      draw(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  // the panel can be dragged out of the way
  $('#dcsEdDrag').onpointerdown = e => { const p = $('#dcsEdPanel'), b = p.getBoundingClientRect(), ox = e.clientX - b.left, oy = e.clientY - b.top;
    const mv = ev => Object.assign(p.style, {left: ev.clientX - ox + 'px', top: ev.clientY - oy + 'px', right: 'auto', bottom: 'auto'});
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
  $$('[data-pick]', ed).forEach(b => b.onclick = () => { sel = b.dataset.pick; draw(); });
  $('#dcsEdUndo').onclick = () => { const u = undo.pop(); if (u) { Object.assign(R, JSON.parse(u)); draw(); } };
  $('#dcsEdCopy').onclick = () => { if (typeof ckRects !== 'function') return; snap(); const C = ckRects(); Object.assign(R, {LEFT_MFCD: {...C.L}, RIGHT_MFCD: {...C.R}, CENTER_MFCD: {...C.TOP}, BAND: {...C.APP}}); draw(); };
  $('#dcsEdCancel').onclick = () => close(false); $('#dcsEdSave').onclick = () => close(true);
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
    if (e.key === 'Enter') { e.preventDefault(); close(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#dcsEdUndo').click(); return; }
    const d = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key]; if (!d) return;
    e.preventDefault(); snap(); const r = R[sel], step = e.shiftKey ? 10 : 1, fx = step / W() * 100 / (devicePixelRatio || 1), fy = step / H() * 100 / (devicePixelRatio || 1);
    if (e.ctrlKey) { r.w = Math.max(2, r.w + d[0] * fx); r.h = Math.max(2, r.h + d[1] * fy); } else { r.x += d[0] * fx; r.y += d[1] * fy; }
    draw();
  };
  addEventListener('keydown', key, true);
  draw();
}
