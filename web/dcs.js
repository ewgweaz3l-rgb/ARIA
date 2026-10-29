/* dcs.js — ARIA for DCS World.
   Boot: callsign (asked once, kept until changed) → pick STAR CITIZEN or DCS WORLD.
   DCS: viewports (the real DDIs / AMPCD drawn by DCS onto the boxes you aligned on your MFD screen),
   live flight data from an Export.lua add-on, FLY mode that shrinks ARIA out of the displays' way. */

// DCS (OVERWATCH) is owner-only during the pre-alpha: it unlocks on this PC with the owner's name + password.
// A soft lock for testers, not security — the check is a hash, but the app's code is readable.
const DCS_KEY = '91656f8a87f87f8e5a955c27356662f34c53e91d903d71dfd87c5cd7c44c5588';
const dcsOpen = () => store.get('dcsKey', '') === DCS_KEY;
async function dcsHash(name, pass) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`aria-dcs|${name.trim().toLowerCase()}|${pass}`));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const GAMEMODE = {get: () => store.get('game', 'sc') === 'dcs' && dcsOpen() ? 'dcs' : 'sc', set(g) { if (g === 'dcs' && !dcsOpen()) g = 'sc'; store.set('game', g); applyGameMode(); }};
// displays you can add (DCS viewport names). The Hornet's center one is the AMPCD ⇄ UFC swap.
const VP_KINDS = [['LEFT_MFCD', 'Left DDI'], ['RIGHT_MFCD', 'Right DDI'], ['CENTER_MFCD', 'AMPCD ⇄ UFC (center)']];
const vpLabel = k => (VP_KINDS.find(v => v[0] === k) || [k, k.replace(/_/g, ' ')])[1];
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
    <button class="gp ${last === 'dcs' ? 'last' : ''}" data-g="dcs"><span class="gpico"><img alt="" hidden><i>DCS</i></span><b>DCS WORLD</b><small>${dcsOpen() ? 'viewports · flight data · GCI' : '🔒 owner only'}</small></button></div>`;
  $$('.gp', box).forEach(b => { const im = $('img', b); im.onload = () => { im.hidden = false; $('i', b).style.display = 'none'; }; im.onerror = () => { im.hidden = true; $('i', b).style.display = ''; };
    im.src = b.dataset.g === 'sc' ? '/api/launcher_icon' : '/api/gameicon/dcs';
    b.onclick = () => { if (b.dataset.g === 'dcs' && !dcsOpen()) { dcsLoginBoot(); return; } GAMEMODE.set(b.dataset.g); bootClose(); }; });
  $('#csChange').onclick = e => { e.preventDefault(); store.set('callsign', ''); store.set('pilotSet', false); bootStep(); };
  const k = e => { if (e.key === 'Enter' && !BOOT.dismissed && $('.gp') && !$('#dlName')) { removeEventListener('keydown', k); GAMEMODE.set(last); bootClose(); } };
  addEventListener('keydown', k);
  setTimeout(() => { const l = $('.gp.last', box); if (l) l.focus(); }, 200);
}

// the owner's sign-in for DCS, right on the boot screen
function dcsLoginBoot() {
  const box = $('#bootBtns'), msg = $('#bootMsg');
  msg.innerHTML = 'DCS is owner-only in this test. Sign in:';
  box.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center"><input id="dlName" type="text" placeholder="Name" autocomplete="off" style="width:150px;text-align:center"><input id="dlPass" type="password" placeholder="Password" style="width:150px;text-align:center">
    <button class="btn" id="dlGo">Unlock</button><button class="btn ghost" id="dlBack">Back</button></div><div class="sub" id="dlMsg" style="margin-top:6px;text-align:center"></div>`;
  const go = async () => {
    if (await dcsHash($('#dlName').value, $('#dlPass').value) === DCS_KEY) { store.set('dcsKey', DCS_KEY); GAMEMODE.set('dcs'); bootClose(); }
    else { $('#dlMsg').innerHTML = '<span class="warn">Not this time. Star Citizen is all yours, though.</span>'; $('#dlPass').value = ''; $('#dlPass').focus(); }
  };
  $('#dlGo').onclick = go; $('#dlBack').onclick = () => bootStep();
  [$('#dlName'), $('#dlPass')].forEach(i => i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } });
  setTimeout(() => $('#dlName').focus(), 30);
}

/* ---------------- switching between the two ---------------- */
function applyGameMode() {
  const dcs = GAMEMODE.get() === 'dcs';
  const sw = $('#btnGame'); if (sw) sw.style.display = dcsOpen() ? '' : 'none';
  document.body.classList.toggle('dcsmode', dcs);
  $('.brand span').textContent = dcs ? 'OVERWATCH' : 'QUARTERMASTER';
  $('#ttName').textContent = AI().toUpperCase(); const tp = $('#ttPwr'); if (tp && !tp.innerHTML) { tp.innerHTML = pwrSwitch(); wirePwrSwitch(tp); }
  const lb = $('#btnLaunch'); if (lb) { lb.title = dcs ? 'Start DCS World' : 'Start the RSI Launcher'; const im = $('#launchIco'); im.hidden = true; $('#launchSvg').style.display = ''; im.src = (dcs ? '/api/gameicon/dcs' : '/api/launcher_icon') + '?t=' + Date.now(); }
  if (dcs) { if (typeof CK !== 'undefined' && CK.on && !CK.cal) setCockpit(false); const v = store.get('dcsView', 'dcslog'); show(v.startsWith('dcs') ? v : 'dcslog'); }
  else if ($$('.view.on').some(v => v.id.startsWith('view-dcs'))) show('rich');
}

/* ---------------- DCS page ---------------- */
function dcsInit() {
  if (!DCS.inited) {
    DCS.inited = true;
    $('#dcsInstall').onclick = async () => { const j = await dcsPost('install'); if (j.ok) toast(j.already ? 'Already installed.' : `Installed. Restart DCS (or the mission) to start the feed.${j.backup ? ' Your old Export.lua was backed up.' : ''}`, 7000); dcsRefresh(); };
    $('#dcsUninstall').onclick = async () => { await dcsPost('uninstall'); toast('Removed ARIA from Export.lua.'); dcsRefresh(); };
    $('#dcsAlign').onclick = () => vpEditor();
    $('#dcsWrite').onclick = () => dcsWriteSetup(false);
    $('#dcsPreview').onclick = () => dcsWriteSetup(true);
    $('#dcsName').oninput = () => { DCS.layout.name = $('#dcsName').value; dcsSave(); };
    ['#dcsMain', '#dcsMfd'].forEach(id => $(id).onchange = () => { DCS.layout[id === '#dcsMain' ? 'main' : 'mfd'] = $(id).value; dcsSave(); dcsRenderLayout(); });
    $('#dcsPaths').onclick = async () => { const p = prompt('DCS install folder (the one with bin\\DCS.exe) — leave blank to auto-detect:', DCS.st && DCS.st.exe || ''); if (p === null) return;
      await fetch('/api/config', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({dcs_path: p.trim()})}); dcsRefresh(); };
    connectDcsFeed(); dlStart();
  }
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
  if (typeof pitSettingsInit === 'function') { pitSettingsInit(); pitSettingsSync(); }
}
// ARIA's cockpit alignment (left MFD, right MFD, center) IS the viewport layout — converted to DCS pixels here
function dcsCompute() {
  const mons = DCS.monsUse || [], main = mons.find(m => m.device === DCS.layout.main) || mons[0], mfd = mons.find(m => m.device === DCS.layout.mfd) || mons[1] || mons[0];
  if (!main || !mfd) return null;
  const ox = Math.min(main.x, mfd.x), oy = Math.min(main.y, mfd.y);
  const W = Math.max(main.x + main.w, mfd.x + mfd.w) - ox, H = Math.max(main.y + main.h, mfd.y + mfd.h) - oy;
  const views = {};
  for (const {k: key, ...r} of dcsVps()) {
    const v = typeof pitViewRect === 'function' ? pitViewRect(key, r, mfd.w, mfd.h) : {x: r.x / 100 * mfd.w, y: r.y / 100 * mfd.h, w: r.w / 100 * mfd.w, h: r.h / 100 * mfd.h};
    views[key] = {x: mfd.x - ox + v.x, y: mfd.y - oy + v.y, w: v.w, h: v.h}; }
  return {name: 'ARIA ' + (DCS.layout.name || 'Cockpit'), W, H, center: {x: main.x - ox, y: main.y - oy, w: main.w, h: main.h}, views, main, mfd, ox, oy};
}
function dcsRenderLayout() {
  const L = dcsCompute(); if (!L) return;
  const rows = dcsVps().map(({k: key}) => { const v = L.views[key];
    return `<tr><td>${esc(vpLabel(key))}</td><td class="mono sub">${esc(key)}</td><td class="r num">${Math.round(v.x)}, ${Math.round(v.y)}</td><td class="r num">${Math.round(v.w)} × ${Math.round(v.h)}</td><td class="r"><button class="btn ghost small" data-vpdel="${esc(key)}" title="Remove this display">✕</button></td></tr>`; }).join('')
    || '<tr><td colspan="5" class="sub">No displays yet — <b>⌗ Add / align displays</b>, then <b>+ Add display</b>.</td></tr>';
  $('#dcsViews').innerHTML = `<tr><th>Display</th><th>DCS name</th><th class="r">Position</th><th class="r">Size</th><th></th></tr>${rows}
    <tr><td>Main view</td><td class="mono sub">Center</td><td class="r num">${L.center.x}, ${L.center.y}</td><td class="r num">${L.center.w} × ${L.center.h}</td></tr>`;
  $$('#dcsViews [data-vpdel]').forEach(b => b.onclick = () => { DCS.layout.vps = dcsVps().filter(v => v.k !== b.dataset.vpdel); dcsSave(); dcsRenderLayout(); if (typeof PIT !== 'undefined' && PIT.on) pitLayout(); });
  $('#dcsRes').innerHTML = `In DCS → Options → System: <b>Monitors</b> = “${esc(L.name)}”, <b>Resolution</b> = <b class="mono">${L.W} × ${L.H}</b> (it has to span both screens), <b>Full screen</b> off.`;
  // little picture of the layout
  const c = $('#dcsPic'), ctx = c.getContext('2d'), sc = Math.min(c.width / L.W, c.height / L.H);
  ctx.clearRect(0, 0, c.width, c.height);
  const box = (r, fill, stroke, label) => { ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.fillRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc); ctx.strokeRect(r.x * sc + .5, r.y * sc + .5, r.w * sc - 1, r.h * sc - 1);
    if (label) { ctx.fillStyle = stroke; ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.fillText(label, r.x * sc + 4, r.y * sc + 13); } };
  box(L.center, 'rgba(95,211,240,.08)', '#5fd3f0', 'MAIN VIEW');
  box({x: L.mfd.x - L.ox, y: L.mfd.y - L.oy, w: L.mfd.w, h: L.mfd.h}, 'rgba(255,255,255,.03)', '#55657c', 'MFD SCREEN');
  for (const key in L.views) box(L.views[key], 'rgba(90,208,138,.25)', '#5ad08a', vpLabel(key).toUpperCase());
}
async function dcsWriteSetup(preview) {
  const L = dcsCompute(); if (!L) return;
  const j = await dcsPost('monitorsetup', {preview, layout: {name: L.name, center: L.center, views: L.views}});
  if (!j.ok) return;
  $('#dcsLua').textContent = j.lua; $('#dcsLuaBox').open = true;
  if (!preview) { toast(`Written: ${esc(j.path)}. Now pick it in DCS → Options → System → Monitors.`, 9000); dcsRefresh(); }
}
async function dcsUnfly() { await fetch('/api/display', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({move: true})}); }

/* ---------------- live flight data ---------------- */
function connectDcsFeed() {
  if (DCS.es) return;
  try { DCS.es = new EventSource('/api/dcs/stream'); DCS.es.onmessage = ev => { try { DCS.feed = JSON.parse(ev.data); renderFlight(); dlogWatch(DCS.feed); mapSync(); if (typeof PIT !== 'undefined' && PIT.on) pitUfcText(); } catch {} }; } catch {}
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

/* ---------------- displays: a list you build — "+ Add display" drops a 400×400 box, drag it onto the bezel ----------------
   Boxes are kept in % of the MFD screen, so they survive resolution changes. */
function dcsVps() {
  if (!DCS.layout.vps) {  // first run after the update: carry over the old fixed boxes that were switched on
    const old = DCS.layout.rects || {}, use = DCS.layout.use || {};
    DCS.layout.vps = ['LEFT_MFCD', 'RIGHT_MFCD', 'CENTER_MFCD'].filter(k => old[k] && use[k] !== false).map(k => ({k, ...old[k]}));
    dcsSave();
  }
  return DCS.layout.vps;
}
function vpGet(k) { return dcsVps().find(v => v.k === k); }
function vpEditor() {
  const V = JSON.parse(JSON.stringify(dcsVps())), undo = [];
  let sel = V.length ? V[0].k : null;
  const ed = document.createElement('div'); ed.id = 'dcsEd';
  document.body.appendChild(ed);
  const W = () => innerWidth, H = () => innerHeight, dpr = () => devicePixelRatio || 1, px = v => Math.round(v * dpr());
  const snap = () => { undo.push(JSON.stringify(V)); if (undo.length > 60) undo.shift(); };
  const free = () => VP_KINDS.filter(([k]) => !V.some(v => v.k === k));
  const render = () => {
    ed.innerHTML = `<div class="dcsgrid"></div>${V.map(v => `<div class="dcsbox ${v.k === sel ? 'sel' : ''}" data-k="${esc(v.k)}"><b>${esc(vpLabel(v.k))}</b><span class="dcssz"></span><button class="dcsdel" data-del="${esc(v.k)}" title="Remove">✕</button>${['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map(h => `<i class="dh dh-${h}" data-h="${h}"></i>`).join('')}</div>`).join('')}
      <div class="dcspanel" id="dcsEdPanel" style="${ed._pp || ''}"><div class="dcsph" id="dcsEdDrag"><b>DISPLAYS</b><span class="sub">drag the panel by this bar</span></div>
        <div class="sub" style="margin:6px 0">Add a display, drag the box onto its bezel, resize from the edges and corners. Arrow keys nudge 1 px (Shift = 10, Ctrl+arrow = resize). Ctrl+Z undo. Enter saves.</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${free().map(([k, l]) => `<button class="btn small" data-add="${k}">+ ${esc(l)}</button>`).join('')}<button class="btn ghost small" data-add="?">+ Other…</button></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${V.map(v => `<button class="btn ghost small" data-pick="${esc(v.k)}">${esc(vpLabel(v.k))}</button>`).join('')}</div>
        <div class="mono sub" id="dcsEdInfo" style="margin:8px 0"></div>
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn ghost small" id="dcsEdUndo">↶ Undo</button>
          <button class="btn ghost small" id="dcsEdCancel">Cancel</button><button class="btn small" id="dcsEdSave">Save</button></div></div>`;
    wire(); draw();
  };
  const draw = () => {
    for (const el of $$('.dcsbox', ed)) { const r = V.find(v => v.k === el.dataset.k); if (!r) continue;
      Object.assign(el.style, {left: r.x + 'vw', top: r.y + 'vh', width: r.w + 'vw', height: r.h + 'vh'});
      el.classList.toggle('sel', r.k === sel); $('.dcssz', el).textContent = `${px(r.w / 100 * W())} × ${px(r.h / 100 * H())}`;
      if (r.k === 'CENTER_MFCD' && typeof helAmpGeo === 'function') { let inn = $('.dcsinner', el); if (!inn) { inn = document.createElement('u'); inn.className = 'dcsinner'; el.appendChild(inn); }
        const g = pitHelLook() ? helAmpGeo(r, W(), H()) : PIT.cfg.amp ? ampGeo(r, W(), H()) : null; inn.hidden = !g;
        if (g) Object.assign(inn.style, {left: g.disp.x - g.outer.x + 'px', top: g.disp.y - g.outer.y + 'px', width: g.disp.w + 'px', height: g.disp.h + 'px'}); } }
    $$('[data-pick]', ed).forEach(b => b.classList.toggle('on', b.dataset.pick === sel));
    const r = V.find(v => v.k === sel);
    $('#dcsEdInfo').textContent = r ? `${vpLabel(r.k)} · x ${px(r.x / 100 * W())} y ${px(r.y / 100 * H())} · ${px(r.w / 100 * W())} × ${px(r.h / 100 * H())} px` : 'No displays yet — add one above.';
  };
  const add = k => {
    if (k === '?') { const n = (prompt('DCS viewport name for this display (as the aircraft calls it, e.g. RIGHT_MFCD, F18_IFEI):') || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''); if (!n || V.some(v => v.k === n)) return; k = n; }
    snap(); const n = V.length, w = 400 / dpr() / W() * 100, h = 400 / dpr() / H() * 100;  // 400 × 400 screen pixels, near the middle
    V.push({k, x: Math.max(0, 50 - w / 2 + (n - 1) * 3), y: Math.max(0, 50 - h / 2 + (n - 1) * 3), w, h}); sel = k; render();
  };
  const close = save => { removeEventListener('keydown', key, true); ed.remove();
    if (save) { DCS.layout.vps = V; dcsSave(); dcsRenderLayout(); if (typeof PIT !== 'undefined' && PIT.on) pitLayout(); toast('Displays saved. Hit <b>Write to DCS</b> (and restart DCS) to put the screens there.', 6000); }
    else if (typeof PIT !== 'undefined' && PIT.on) pitShape(); };
  const wire = () => {
    $$('[data-add]', ed).forEach(b => b.onclick = () => add(b.dataset.add));
    $$('[data-pick]', ed).forEach(b => b.onclick = () => { sel = b.dataset.pick; draw(); });
    $$('[data-del]', ed).forEach(b => b.onclick = e => { e.stopPropagation(); snap(); const i = V.findIndex(v => v.k === b.dataset.del); V.splice(i, 1); if (sel === b.dataset.del) sel = V.length ? V[0].k : null; render(); });
    $('#dcsEdUndo').onclick = () => { const u = undo.pop(); if (u) { V.splice(0, V.length, ...JSON.parse(u)); if (!V.some(v => v.k === sel)) sel = V.length ? V[0].k : null; render(); } };
    $('#dcsEdCancel').onclick = () => close(false); $('#dcsEdSave').onclick = () => close(true);
    $('#dcsEdDrag').onpointerdown = e => { const p = $('#dcsEdPanel'), b = p.getBoundingClientRect(), ox = e.clientX - b.left, oy = e.clientY - b.top;
      const mv = ev => { ed._pp = `left:${ev.clientX - ox}px;top:${ev.clientY - oy}px;right:auto;bottom:auto`; p.style.cssText = ed._pp; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
  };
  ed.addEventListener('pointerdown', e => {  // drag / resize
    const box = e.target.closest('.dcsbox'); if (!box || e.target.closest('[data-del]')) return;
    sel = box.dataset.k; draw(); snap(); e.preventDefault();
    const h = e.target.dataset.h || 'move', r = V.find(v => v.k === sel), o = {...r}, sx = e.clientX, sy = e.clientY;
    const mv = ev => { const dx = (ev.clientX - sx) / W() * 100, dy = (ev.clientY - sy) / H() * 100;
      if (h === 'move') { r.x = o.x + dx; r.y = o.y + dy; }
      else { if (h.includes('w')) { r.x = o.x + dx; r.w = Math.max(2, o.w - dx); } if (h.includes('e')) r.w = Math.max(2, o.w + dx);
        if (h.includes('n')) { r.y = o.y + dy; r.h = Math.max(2, o.h - dy); } if (h.includes('s')) r.h = Math.max(2, o.h + dy); }
      r.w = Math.min(r.w, 100); r.h = Math.min(r.h, 100); r.x = Math.min(Math.max(0, r.x), 100 - r.w); r.y = Math.min(Math.max(0, r.y), 100 - r.h);  // stay on this screen
      draw(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  const key = e => {
    if (e.target.closest && e.target.closest('input')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
    if (e.key === 'Enter') { e.preventDefault(); close(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#dcsEdUndo').click(); return; }
    const d = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key]; const r = V.find(v => v.k === sel); if (!d || !r) return;
    e.preventDefault(); snap(); const step = e.shiftKey ? 10 : 1, fx = step / W() * 100 / dpr(), fy = step / H() * 100 / dpr();
    if (e.ctrlKey) { r.w = Math.max(2, r.w + d[0] * fx); r.h = Math.max(2, r.h + d[1] * fy); } else { r.x += d[0] * fx; r.y += d[1] * fy; }
    draw();
  };
  addEventListener('keydown', key, true);
  render();
  if (typeof PIT !== 'undefined' && PIT.on) pitShape();  // the whole window while you align
}

/* ======================================================================
   LOG — call-outs (teletype strip at the bottom + full list on the LOG tab)
   ====================================================================== */
const DLOG = {list: store.get('dcsLog', []).slice(0, 300), st: {air: null, bingo: false, joker: false, mach: false, gT: 0, live: false, unit: ''}};
function dlogAdd(kind, text, level) {
  const s = (DCS.feed && DCS.feed.state) || {};
  const e = {t: Date.now(), mt: s.t != null ? s.t : null, kind, text, level: level || ''};
  DLOG.list.unshift(e); DLOG.list = DLOG.list.slice(0, 300); store.set('dcsLog', DLOG.list);
  renderTT(true); if ($('#view-dcslog').classList.contains('on')) renderLog();
  if ($('#logSpeak') && $('#logSpeak').checked && level !== 'dl') say(text);
}
const hhmmss = t => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const mtime = s => s == null ? '' : `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
function renderTT(newLine) {
  const el = $('#ttLines'); if (!el) return;
  const rows = DLOG.list.slice(0, 4).reverse();
  el.innerHTML = rows.map((e, i) => `<div class="ttl ${e.level}"><i>${hhmmss(e.t)}${e.mt != null ? ' Z+' + mtime(e.mt) : ''}</i><span>${i === rows.length - 1 && newLine ? '' : esc(e.text)}</span></div>`).join('');
  if (newLine && rows.length) { const span = $('.ttl:last-child span', el), txt = rows[rows.length - 1].text; let n = 0; clearInterval(DLOG.tw);
    DLOG.tw = setInterval(() => { n += 2; span.textContent = txt.slice(0, n) + (n < txt.length ? '▮' : ''); if (n >= txt.length) clearInterval(DLOG.tw); }, 18); }
}
function renderLog() {
  const el = $('#logList'); if (!el) return;
  el.innerHTML = DLOG.list.length ? DLOG.list.map(e => `<div class="logrow ${e.level}"><i>${hhmmss(e.t)}</i><i>${e.mt != null ? 'Z+' + mtime(e.mt) : ''}</i><span class="k">${esc(e.kind)}</span><span>${esc(e.text)}</span></div>`).join('')
    : '<div class="sub">Nothing yet — call-outs appear here once DCS is sending flight data.</div>';
}
// watch the flight data and call out the things a wingman would
function dlogWatch(f) {
  const st = DLOG.st, s = f && f.state;
  if (!!(f && f.live) !== st.live) { st.live = !!(f && f.live); $('#ttLink').textContent = st.live ? 'LINK UP' : 'NO FEED';
    if (st.live && s) dlogAdd('LINK', `Flight data up — ${(s.unit || 'aircraft').replace(/_/g, ' ')}${s.pilot ? ', ' + s.pilot : ''}.`);
    else if (!st.live && st.air !== null) dlogAdd('LINK', 'Flight data lost.', 'warn'); }
  if (!s) return;
  if (s.unit && s.unit !== st.unit) { if (st.unit) dlogAdd('A/C', `Now in ${s.unit.replace(/_/g, ' ')}.`); st.unit = s.unit; st.bingo = st.joker = false; }
  const kt = (s.ias || 0) * 1.94384, agl = (s.agl || 0) * 3.28084;
  const air = st.air === null ? (agl > 30 && kt > 60) : st.air ? !(agl < 8 && kt < 140 && Math.abs(s.vvi || 0) < 4) : (agl > 30 && kt > 60);
  if (st.air !== null && air !== st.air) dlogAdd(air ? 'AIRBORNE' : 'TOUCHDOWN', air ? `Wheels up — ${Math.round(kt)} kt.` : `Touchdown — ${Math.round(kt)} kt.`);
  st.air = air;
  const fuel = s.fuel && s.fuel.internal != null && s.fuel.internal <= 1.5 ? s.fuel.internal * 100 : null;
  const bingo = +($('#logBingo') && $('#logBingo').value) || store.get('logBingo', 25), joker = +($('#logJoker') && $('#logJoker').value) || store.get('logJoker', 40);
  if (fuel != null && air) {
    if (!st.joker && fuel <= joker) { st.joker = true; dlogAdd('JOKER', `Joker fuel — ${Math.round(fuel)} % internal.`, 'warn'); }
    if (!st.bingo && fuel <= bingo) { st.bingo = true; dlogAdd('BINGO', `Bingo fuel — ${Math.round(fuel)} % internal. Head home.`, 'alert'); }
  }
  if (s.g != null && s.g > 7.5 && Date.now() - st.gT > 15000) { st.gT = Date.now(); dlogAdd('OVER-G', `${s.g.toFixed(1)} G.`, 'warn'); }
  if (s.mach != null) { if (!st.mach && s.mach >= 1.0) { st.mach = true; dlogAdd('MACH', 'Supersonic.'); } else if (st.mach && s.mach < 0.97) st.mach = false; }
}

/* ======================================================================
   DL99 — squad datalink through the squad server (Railway)
   ====================================================================== */
const DL = {peers: [], marks: [], seq: 0, timer: 0, err: '', net: () => (store.get('dlNet', 'DL99') || 'DL99').toUpperCase(), share: () => store.get('dlShare', true)};
async function dlPost(body) {
  try { const r = await fetch(SQUAD.url() + '/api/dl', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: SQUAD.key(), net: DL.net(), callsign: store.get('callsign', '') || PILOT(), since: DL.seq, ...body})});
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); DL.err = ''; return j; }
  catch (e) { DL.err = e.message; return null; }
}
function dlTake(j) {
  if (!j) { $('#dlState') && ($('#dlState').textContent = 'OFFLINE · ' + DL.err.toUpperCase().slice(0, 30)); return; }
  const me = (store.get('callsign', '') || PILOT()).toUpperCase();
  DL.peers = j.peers.filter(p => p.callsign !== me); DL.marks = j.marks;
  for (const m of j.msgs || []) { if (m.n > DL.seq && DL.seq) dlogAdd('DL99', `${m.by}: ${m.text}`, 'dl'); DL.msgLog.push(m); }
  DL.msgLog = DL.msgLog.slice(-100);
  DL.seq = Math.max(DL.seq, j.seq || 0);
  if ($('#dlState')) $('#dlState').textContent = `${DL.net()} · ${DL.peers.length} ON NET`;
  renderDL(); mapSync();
}
DL.msgLog = [];
async function dlTick() {
  const s = DCS.feed && DCS.feed.live && DCS.feed.state;
  const j = s && DL.share() ? await dlPost({op: 'pos', pos: {lat: s.lat, lon: s.lon, alt: s.alt, hdg: s.hdg, ias: s.ias, unit: s.unit}}) : await dlPost({op: 'get'});
  dlTake(j);
}
function dlStart() { if (DL.timer) return; dlTick(); DL.timer = setInterval(() => { if (GAMEMODE.get() === 'dcs') dlTick(); }, 2500); }
function braa(a, b) {  // bearing (true) and range in nm from a to b
  const R = 3440.065, toR = Math.PI / 180, la1 = a.lat * toR, la2 = b.lat * toR, dl = (b.lon - a.lon) * toR;
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2));
  const brg = (Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) / toR + 360) % 360;
  return {brg, d};
}
function renderDL() {
  const el = $('#dlPeers'); if (!el) return;
  const s = DCS.feed && DCS.feed.state;
  el.innerHTML = `<tr><th>Callsign</th><th>Jet</th><th class="r">Angels</th><th class="r">Speed</th><th class="r">${s ? 'BRA from you' : 'Position'}</th></tr>` +
    (DL.peers.length ? DL.peers.map(p => { const b = s && s.lat != null ? braa(s, p) : null;
      return `<tr><td><b>${esc(p.callsign)}</b></td><td class="sub">${esc((p.unit || '').replace(/_/g, ' '))}</td><td class="r num">${p.alt != null ? Math.round(p.alt * 3.28084 / 1000) : '—'}</td><td class="r num">${p.ias != null ? Math.round(p.ias * 1.94384) + ' kt' : '—'}</td><td class="r num">${b ? String(Math.round(b.brg)).padStart(3, '0') + '° / ' + Math.round(b.d) + ' nm' : p.lat.toFixed(2) + ', ' + p.lon.toFixed(2)}</td></tr>`; }).join('')
      : '<tr><td colspan="5" class="sub">Nobody else on this net right now.</td></tr>');
  const m = $('#dlMsgs'); if (m) { m.innerHTML = DL.msgLog.map(x => `<div><span class="sub">${hhmmss(x.t * 1000)}</span> <b>${esc(x.by)}</b> ${esc(x.text)}</div>`).join(''); m.scrollTop = m.scrollHeight; }
}

/* ======================================================================
   MAP — F10-style: your jet, DL99 flight, shared marks (Leaflet + dark tiles)
   ====================================================================== */
const MP = {map: null, me: null, peers: {}, marks: {}, local: store.get('mapMarks', [])};
async function mapInit() {
  if (MP.map) { setTimeout(() => MP.map.invalidateSize(), 50); return; }
  if (!window.L) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/leaflet/leaflet.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }).catch(() => {});
  }
  if (!window.L) { $('#dcsMap').innerHTML = '<div class="sub" style="padding:20px">Map library missing — update ARIA.</div>'; return; }
  MP.map = window.L.map('dcsMap', {zoomControl: true, worldCopyJump: true, attributionControl: true}).setView([42, 42], 6);
  window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom: 18, subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'}).addTo(MP.map);
  MP.map.on('click', e => mapAddMark(e.latlng.lat, e.latlng.lng));
  MP.map.on('dragstart', () => { $('#mapFollow').checked = false; });
  $('#mapMe').onclick = () => { const s = DCS.feed && DCS.feed.state; if (s && s.lat != null) MP.map.setView([s.lat, s.lon], Math.max(MP.map.getZoom(), 8)); else toast('No position yet — fly a mission with the add-on installed.'); };
  mapSync();
}
const jetIcon = (hdg, color, label) => window.L.divIcon({className: '', iconSize: [26, 26], iconAnchor: [13, 13],
  html: `<div style="transform:rotate(${(hdg || 0) * 180 / Math.PI}deg);width:26px;height:26px"><svg viewBox="0 0 26 26" width="26" height="26"><path d="M13 2 L17 20 L13 16 L9 20 Z" fill="${color}" stroke="#000" stroke-width="1"/></svg></div>${label ? `<div style="position:absolute;left:26px;top:4px;color:${color};font:700 11px IBM Plex Mono,monospace;white-space:nowrap;text-shadow:0 0 3px #000">${label}</div>` : ''}`});
const MARK_COL = {point: '#f2a83b', target: '#ff6b5b', threat: '#ff3b6b', friendly: '#5fd3f0'};
const markIcon = m => window.L.divIcon({className: '', iconSize: [18, 18], iconAnchor: [9, 9],
  html: `<div style="width:14px;height:14px;border:2px solid ${MARK_COL[m.kind] || '#f2a83b'};${m.kind === 'threat' ? 'border-radius:50%' : m.kind === 'target' ? 'transform:rotate(45deg)' : ''};background:rgba(0,0,0,.4)"></div><div style="position:absolute;left:18px;top:-2px;color:${MARK_COL[m.kind] || '#f2a83b'};font:700 11px IBM Plex Mono,monospace;white-space:nowrap;text-shadow:0 0 3px #000">${esc(m.label || '')}${m.by ? ' · ' + esc(m.by) : ''}</div>`});
async function mapAddMark(lat, lon) {
  const label = prompt('Mark label (e.g. SA-6, TGT 1, TANKER):', ''); if (label === null) return;
  const m = {id: Date.now().toString(36), lat, lon, label: label.trim().slice(0, 40), kind: $('#mapKind').value};
  if (DL.share()) { const j = await dlPost({op: 'mark', mark: m}); if (j) { dlTake(j); dlogAdd('MARK', `Mark ${m.label || m.kind} shared on ${DL.net()}.`, 'dl'); return; } }
  MP.local.push(m); store.set('mapMarks', MP.local); mapSync();
}
async function mapDelMark(m) {
  if (m.local) { MP.local = MP.local.filter(x => x.id !== m.id); store.set('mapMarks', MP.local); mapSync(); return; }
  const j = await dlPost({op: 'unmark', id: m.id}); dlTake(j);
}
function mapSync() {
  if (!MP.map || !window.L) return;
  const s = DCS.feed && DCS.feed.live && DCS.feed.state;
  if (s && s.lat != null) {
    if (!MP.me) MP.me = window.L.marker([s.lat, s.lon], {icon: jetIcon(s.hdg, '#7cf59a', 'YOU'), zIndexOffset: 1000}).addTo(MP.map);
    else { MP.me.setLatLng([s.lat, s.lon]); MP.me.setIcon(jetIcon(s.hdg, '#7cf59a', 'YOU')); }
    if ($('#mapFollow').checked) MP.map.panTo([s.lat, s.lon], {animate: false});
  }
  const seen = new Set();
  for (const p of DL.peers) { seen.add(p.callsign); const ic = jetIcon(p.hdg, '#5fd3f0', `${p.callsign} ${p.alt != null ? Math.round(p.alt * 3.28084 / 1000) : ''}`);
    if (MP.peers[p.callsign]) { MP.peers[p.callsign].setLatLng([p.lat, p.lon]); MP.peers[p.callsign].setIcon(ic); } else MP.peers[p.callsign] = window.L.marker([p.lat, p.lon], {icon: ic}).addTo(MP.map); }
  for (const k of Object.keys(MP.peers)) if (!seen.has(k)) { MP.peers[k].remove(); delete MP.peers[k]; }
  const all = [...DL.marks, ...MP.local.map(m => ({...m, local: true}))], ids = new Set(all.map(m => m.id));
  for (const m of all) if (!MP.marks[m.id]) { const mk = window.L.marker([m.lat, m.lon], {icon: markIcon(m)}).addTo(MP.map); mk.on('contextmenu', () => mapDelMark(m)); mk.bindTooltip(`${m.kind.toUpperCase()}${m.local ? ' (local)' : ''} · right-click to delete`); MP.marks[m.id] = mk; }
  for (const k of Object.keys(MP.marks)) if (!ids.has(k)) { MP.marks[k].remove(); delete MP.marks[k]; }
}

/* ======================================================================
   KNEEBOARD — recovery / pattern cards per airframe (more airframes as we build them)
   Numbers are the common DCS-community values; your squadron SOP wins.
   ====================================================================== */
const KB = {
  'FA-18C_hornet': {name: 'F/A-18C Hornet', pages: [
    {id: 'case1', title: 'CASE I RECOVERY', sub: 'Day VMC · ceiling ≥ 3000 ft · vis ≥ 5 nm', rows: [
      ['Initial', '3 nm astern on BRC, 800 ft, 350 KIAS, right of the wake'],
      ['Break', 'At or past the bow, left break · idle + speedbrake · level at 800 ft'],
      ['Dirty up', 'Below 250 KIAS: gear down, flaps FULL, hook down · trim to on-speed'],
      ['Downwind', '600 ft · 1.1–1.3 nm abeam · on-speed AoA (8.1°) · landing checklist'],
      ['180 / Abeam', 'Start the turn abeam the LSO platform · ~27° bank'],
      ['45° position', '~450 ft'],
      ['Groove', 'Roll out ~350–375 ft, 15–18 s groove · call "Hornet ball, x.x" (fuel)'],
      ['Fly', 'Meatball · lineup · AoA — power for the ball, nose for AoA'],
      ['Touchdown', 'Full power on touchdown · bolter = fly away, climb to 600 ft upwind']],
      note: 'Hook down before the break. Hornet on-speed AoA 8.1° (indexer donut).', pic: 'case1'},
    {id: 'case3', title: 'CASE III RECOVERY', sub: 'Night or ceiling < 1000 ft / vis < 5 nm', rows: [
      ['Marshal', 'Radial = BRC reciprocal (or assigned) · distance = angels + 15 nm (e.g. angels 6 → 21 nm)'],
      ['Push', 'At your EAT · 250 KIAS · 4000 fpm descent'],
      ['Platform', '5000 ft → slow to 2000 fpm descent'],
      ['10 DME', '1200 ft · dirty up: gear, flaps FULL, hook · slow to on-speed'],
      ['6 DME', 'Level 1200 ft until glideslope intercept (ICLS / ACLS)'],
      ['3/4 nm', '"Hornet ball, x.x" when you see the ball · paddles takes the call'],
      ['Bolter / waveoff', 'Climb straight ahead to 1200 ft, follow the CATCC / tower instructions']],
      note: 'Tune ICLS channel and TACAN before you push. Fly the needles until the ball.', pic: 'case3'},
    {id: 'case2', title: 'CASE II RECOVERY', sub: 'Day · ceiling 1000–3000 ft · vis ≥ 5 nm', rows: [
      ['Descent', 'Case III marshal and push procedures until visual'],
      ['Visual', 'Below the layer: proceed VFR to the initial'],
      ['Pattern', 'Join and fly as Case I from the initial / break']],
      note: 'If you never get visual by 10 nm, continue as Case III.'},
    {id: 'field', title: 'FIELD OVERHEAD BREAK', sub: 'Land-based VFR pattern (check field / SOP)', rows: [
      ['Initial', '3–5 nm on runway heading · 1500 ft AGL (or field pattern) · 300–350 KIAS'],
      ['Break', 'Over the approach end / numbers · idle + speedbrake · level turn to downwind'],
      ['Dirty up', 'Below 250 KIAS: gear down, flaps HALF or FULL, on-speed AoA'],
      ['Downwind', 'Pattern altitude · ~1–1.5 nm abeam the runway'],
      ['Base turn', 'Abeam touchdown point · descending 180° turn'],
      ['Final', 'Roll out ~300–400 ft AGL · 3° glidepath · fly on-speed AoA'],
      ['Touchdown', 'First 1000 ft · idle · brakes below 100 kt'],
      ['Go-around', 'MIL/AB · positive climb · gear up, flaps auto']],
      note: 'Hook up for field landings unless arresting gear is briefed.', pic: 'field'}]}
};
function kbSvg(kind) {
  if (kind === 'case1') return `<svg viewBox="0 0 300 120" width="300" height="120"><rect x="125" y="52" width="70" height="16" fill="#9aa7b4"/><text x="160" y="64" font-size="9" text-anchor="middle" fill="#14181f">SHIP →</text>
    <path d="M10 60 H180 A35 35 0 0 0 180 -10 M180 -10" fill="none"/><path d="M20 60 L190 60 Q235 60 235 30 Q235 8 190 8 L80 8 Q40 8 40 40 Q40 60 120 60" fill="none" stroke="#0b2a4a" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="22" y="76" font-size="9" fill="#0b2a4a">INITIAL 800'</text><text x="200" y="76" font-size="9" fill="#0b2a4a">BREAK</text><text x="110" y="20" font-size="9" fill="#0b2a4a">DOWNWIND 600'</text><text x="30" y="40" font-size="9" fill="#0b2a4a">180 · 45° 450'</text></svg>`;
  if (kind === 'case3') return `<svg viewBox="0 0 300 110" width="300" height="110"><path d="M10 15 L120 15 L170 55 L270 85" fill="none" stroke="#0b2a4a" stroke-width="2"/><rect x="270" y="80" width="22" height="9" fill="#9aa7b4"/>
    <text x="10" y="10" font-size="9" fill="#0b2a4a">MARSHAL ang+15 nm</text><text x="110" y="34" font-size="9" fill="#0b2a4a">PLATFORM 5000'</text><text x="160" y="72" font-size="9" fill="#0b2a4a">10 DME 1200' DIRTY</text><text x="230" y="104" font-size="9" fill="#0b2a4a">¾ nm BALL</text></svg>`;
  if (kind === 'field') return `<svg viewBox="0 0 300 120" width="300" height="120"><rect x="40" y="56" width="200" height="10" fill="#9aa7b4"/><path d="M20 61 H150 Q190 61 190 32 Q190 14 150 14 H60 Q25 14 25 40 Q25 61 60 61" fill="none" stroke="#0b2a4a" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="20" y="84" font-size="9" fill="#0b2a4a">INITIAL → BREAK OVER THE NUMBERS</text><text x="70" y="10" font-size="9" fill="#0b2a4a">DOWNWIND</text><text x="0" y="40" font-size="9" fill="#0b2a4a">BASE</text></svg>`;
  return '';
}
function renderKB() {
  const sel = $('#kbAir'); if (!sel.options.length) sel.innerHTML = Object.entries(KB).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  const ac = KB[sel.value] || Object.values(KB)[0];
  $('#kbPages').innerHTML = ac.pages.map(p => `<div class="kbpage" data-kb="${p.id}"><h3>${esc(p.title)}</h3><div class="kbsub">${esc(ac.name)} · ${esc(p.sub)}</div>
    ${p.pic ? kbSvg(p.pic) : ''}<table>${p.rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
    ${p.note ? `<div class="kbnote">${esc(p.note)}</div>` : ''}<div class="kbsub" style="margin-top:8px;font-size:10.5px">ARIA reference · common DCS values — your squadron SOP and the boat/field brief win.</div></div>`).join('');
}
async function kbSend() {
  if (!window.html2canvas) await new Promise(res => { const sc = document.createElement('script'); sc.src = 'vendor/html2canvas.min.js'; sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
  if (!window.html2canvas) { toast('Missing vendor/html2canvas.min.js — update ARIA.'); return; }
  const pages = [];
  for (const el of $$('#kbPages .kbpage')) { const c = await html2canvas(el, {backgroundColor: '#f4f1e8', scale: 2}); pages.push({name: el.dataset.kb, png: c.toDataURL('image/png')}); }
  const j = await dcsPost('kneeboard', {aircraft: $('#kbAir').value, pages});
  if (j.ok) toast(`${j.pages} pages in your ${esc(KB[$('#kbAir').value].name)} kneeboard (${esc(j.folder)}). Restart the mission to see them.`, 9000);
}

/* ---------------- tab routing + wiring ---------------- */
function dcsView(v) {
  store.set('dcsView', v);
  if (v === 'dcslog') renderLog();
  if (v === 'dcsdl') renderDL();
  if (v === 'dcsmap') mapInit();
  if (v === 'dcskb') renderKB();
  if (v === 'dcsset') dcsRefresh();
}
(function dcsWire() {
  const on = (id, ev, fn) => { const e = $(id); if (e) e[ev] = fn; };
  on('#logSpeak', 'onchange', () => store.set('logSpeak', $('#logSpeak').checked));
  on('#logBingo', 'onchange', () => store.set('logBingo', +$('#logBingo').value));
  on('#logJoker', 'onchange', () => store.set('logJoker', +$('#logJoker').value));
  on('#logClear', 'onclick', () => { DLOG.list = []; store.set('dcsLog', []); renderLog(); renderTT(); });
  on('#logCopy', 'onclick', () => { navigator.clipboard.writeText(DLOG.list.slice().reverse().map(e => `${hhmmss(e.t)} ${e.mt != null ? 'Z+' + mtime(e.mt) : ''} ${e.kind} ${e.text}`).join('\n')).then(() => toast('Log copied.')); });
  on('#dlShare', 'onchange', () => { store.set('dlShare', $('#dlShare').checked); dlTick(); });
  on('#dlNet', 'onchange', () => { store.set('dlNet', $('#dlNet').value.trim().toUpperCase() || 'DL99'); DL.seq = 0; DL.msgLog = []; dlTick(); });
  const send = async () => { const t = $('#dlSay').value.trim(); if (!t) return; $('#dlSay').value = ''; dlTake(await dlPost({op: 'msg', text: t})); };
  on('#dlSend', 'onclick', send); on('#dlSay', 'onkeydown', e => { if (e.key === 'Enter') send(); });
  on('#kbAir', 'onchange', renderKB); on('#kbSend', 'onclick', kbSend);
  on('#kbPrint', 'onclick', () => { const w = window.open('', '_blank'); w.document.write(`<html><head><title>Kneeboard</title><style>${[...document.styleSheets].map(ss => { try { return [...ss.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; } }).join('\n')} body{background:#fff} .kbpage{box-shadow:none;page-break-after:always;margin:0 auto 20px}</style></head><body>${$('#kbPages').innerHTML}</body></html>`); w.document.close(); setTimeout(() => w.print(), 400); });
  if ($('#logSpeak')) $('#logSpeak').checked = store.get('logSpeak', false);
  if ($('#logBingo')) $('#logBingo').value = store.get('logBingo', 25);
  if ($('#logJoker')) $('#logJoker').value = store.get('logJoker', 40);
  if ($('#dlShare')) $('#dlShare').checked = DL.share();
  if ($('#dlNet')) $('#dlNet').value = DL.net();
  renderTT();
})();

// testers never see the Star Citizen ⇄ DCS switch
setTimeout(() => { const sw = $('#btnGame'); if (sw && !dcsOpen()) sw.style.display = 'none'; }, 0);
