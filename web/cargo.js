/* cargo.js — CARGO HOLD: a blueprint of your ship's cargo grid and the best way to stack it.

   A grid is width × length × height in SCU cells (1 SCU = one 1.25 m cube). ARIA packs the boxes
   biggest-first (fewer boxes = faster loading at the terminal), shows every layer floor-up, and what room is left.
   Grid sizes come from you or the squad (Ruger's sheet imports as CSV); until then ARIA guesses from the SCU.
   Box sizes are the standard containers — editable below if CIG changes them. */

const BOXES_DEF = {32: [2, 8, 2], 24: [2, 6, 2], 16: [2, 4, 2], 8: [2, 2, 2], 4: [2, 2, 1], 2: [1, 2, 1], 1: [1, 1, 1]};
const BOX_COLOR = {32: '#ff6b5b', 24: '#ff9f43', 16: '#f2d43b', 8: '#5ad08a', 4: '#5fd3f0', 2: '#a78bfa', 1: '#e8eef4'};
const CARGO = {
  grids: () => store.get('cargoGrids', {}),
  boxes: () => ({...BOXES_DEF, ...store.get('cargoBoxes', {})}),
  get(ship) { return this.grids()[norm(ship)] || null; },
  set(ship, g) { const a = this.grids(); if (g && g.length) a[norm(ship)] = g; else delete a[norm(ship)]; store.set('cargoGrids', a); },
  guess(scu) {  // until someone measures it: a single grid of about the right size
    scu = Math.max(1, Math.round(scu || 1));
    const h = scu >= 16 ? 2 : 1, w = scu >= 8 ? 2 : 1, l = Math.ceil(scu / (w * h));
    return [{name: 'Grid', w, l, h, guess: true}];
  }
};

/* ---------------- packing ---------------- */
function cargoPack(grids, want, maxBox) {
  const B = CARGO.boxes(), sizes = Object.keys(B).map(Number).filter(n => n <= maxBox).sort((a, b) => b - a);
  const out = grids.map(g => ({g, occ: new Uint8Array(g.w * g.l * g.h), boxes: []}));
  const at = (o, x, y, z) => o.occ[(z * o.g.l + y) * o.g.w + x];
  const fits = (o, x, y, z, w, l, h) => { if (x + w > o.g.w || y + l > o.g.l || z + h > o.g.h) return false;
    for (let k = z; k < z + h; k++) for (let j = y; j < y + l; j++) for (let i = x; i < x + w; i++) if (at(o, i, j, k)) return false;
    if (z > 0) for (let j = y; j < y + l; j++) for (let i = x; i < x + w; i++) if (!at(o, i, j, z - 1)) return false;  // nothing floats
    return true; };
  const put = (o, x, y, z, w, l, h, size) => { for (let k = z; k < z + h; k++) for (let j = y; j < y + l; j++) for (let i = x; i < x + w; i++) o.occ[(k * o.g.l + j) * o.g.w + i] = 1; o.boxes.push({x, y, z, w, l, h, size}); };
  let left = want;
  for (const size of sizes) {
    const [bw, bl, bh] = B[size];
    while (left >= size) {
      let placed = false;
      for (const o of out) {
        for (let z = 0; z < o.g.h && !placed; z++) for (let y = 0; y < o.g.l && !placed; y++) for (let x = 0; x < o.g.w && !placed; x++)
          for (const [w, l] of [[bw, bl], [bl, bw]]) if (!placed && fits(o, x, y, z, w, l, bh)) { put(o, x, y, z, w, l, bh, size); placed = true; }
        if (placed) break;
      }
      if (!placed) break;
      left -= size;
    }
  }
  const cap = grids.reduce((a, g) => a + g.w * g.l * g.h, 0), used = want - left;
  return {out, cap, used, left, free: cap - used, count: out.reduce((a, o) => a + o.boxes.length, 0),
    tally: out.flatMap(o => o.boxes).reduce((t, b) => (t[b.size] = (t[b.size] || 0) + 1, t), {})};
}

/* ---------------- drawing: blueprint layers + an isometric view ---------------- */
function cargoLayerSvg(o, z, cell) {
  const g = o.g, W = g.w * cell, H = g.l * cell;
  let s = `<svg class="cg-layer" viewBox="-2 -2 ${W + 4} ${H + 4}" width="${W + 4}" height="${H + 4}"><rect x="0" y="0" width="${W}" height="${H}" class="cg-floor"/>`;
  for (let i = 1; i < g.w; i++) s += `<line x1="${i * cell}" y1="0" x2="${i * cell}" y2="${H}" class="cg-line"/>`;
  for (let j = 1; j < g.l; j++) s += `<line x1="0" y1="${j * cell}" x2="${W}" y2="${j * cell}" class="cg-line"/>`;
  for (const b of o.boxes) {
    if (z < b.z || z >= b.z + b.h) continue;
    const top = z === b.z + b.h - 1, c = BOX_COLOR[b.size] || '#fff';
    s += `<rect x="${b.x * cell + 1.5}" y="${b.y * cell + 1.5}" width="${b.w * cell - 3}" height="${b.l * cell - 3}" rx="2" fill="${c}" fill-opacity="${top ? .82 : .35}" stroke="${c}" stroke-width="1.5"/>`;
    if (z === b.z) s += `<text x="${(b.x + b.w / 2) * cell}" y="${(b.y + b.l / 2) * cell + 4}" class="cg-txt">${b.size}</text>`;
  }
  return s + '</svg>';
}
function cargoIsoSvg(o, cell) {
  const g = o.g, cx = cell * .87, cy = cell * .5, P = (x, y, z) => [(x - y) * cx, (x + y) * cy - z * cell];
  const xs = [], ys = []; for (const [x, y, z] of [[0, 0, 0], [g.w, 0, 0], [0, g.l, 0], [g.w, g.l, 0], [0, 0, g.h], [g.w, g.l, g.h], [g.w, 0, g.h], [0, g.l, g.h]]) { const [a, b] = P(x, y, z); xs.push(a); ys.push(b); }
  const minX = Math.min(...xs) - 4, minY = Math.min(...ys) - 4, W = Math.max(...xs) - minX + 4, H = Math.max(...ys) - minY + 4;
  const pt = (x, y, z) => P(x, y, z).join(',');
  let s = `<svg class="cg-iso" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">`;
  s += `<polygon points="${pt(0, 0, 0)} ${pt(g.w, 0, 0)} ${pt(g.w, g.l, 0)} ${pt(0, g.l, 0)}" class="cg-floor"/>`;
  for (let i = 0; i <= g.w; i++) s += `<line x1="${P(i, 0, 0)[0]}" y1="${P(i, 0, 0)[1]}" x2="${P(i, g.l, 0)[0]}" y2="${P(i, g.l, 0)[1]}" class="cg-line"/>`;
  for (let j = 0; j <= g.l; j++) s += `<line x1="${P(0, j, 0)[0]}" y1="${P(0, j, 0)[1]}" x2="${P(g.w, j, 0)[0]}" y2="${P(g.w, j, 0)[1]}" class="cg-line"/>`;
  const boxes = o.boxes.slice().sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z) || a.z - b.z);
  for (const b of boxes) {
    const c = BOX_COLOR[b.size] || '#fff', x0 = b.x, y0 = b.y, z0 = b.z, x1 = b.x + b.w, y1 = b.y + b.l, z1 = b.z + b.h;
    s += `<polygon points="${pt(x0, y1, z0)} ${pt(x1, y1, z0)} ${pt(x1, y1, z1)} ${pt(x0, y1, z1)}" fill="${c}" fill-opacity=".55" stroke="#0b2a4a" stroke-width="1"/>`;
    s += `<polygon points="${pt(x1, y0, z0)} ${pt(x1, y1, z0)} ${pt(x1, y1, z1)} ${pt(x1, y0, z1)}" fill="${c}" fill-opacity=".38" stroke="#0b2a4a" stroke-width="1"/>`;
    s += `<polygon points="${pt(x0, y0, z1)} ${pt(x1, y0, z1)} ${pt(x1, y1, z1)} ${pt(x0, y1, z1)}" fill="${c}" fill-opacity=".85" stroke="#0b2a4a" stroke-width="1"/>`;
  }
  return s + '</svg>';
}

/* ---------------- the planner window ---------------- */
async function openCargo(shipName) {
  if (!shipName) shipName = ($('#shipIn') && $('#shipIn').value) || '';
  try { await tradeData(); } catch {}
  const v = shipName && typeof uexShipByName === 'function' ? uexShipByName(shipName) : null;
  const scu = (shipName && typeof scuOver !== 'undefined' && scuOver.get(shipName)) || (v && num(v.scu)) || num($('#scuIn') && $('#scuIn').value) || 32;
  let el = $('#cargoWin'); if (!el) { el = document.createElement('div'); el.id = 'cargoWin'; document.body.appendChild(el); }
  const st = {ship: shipName || 'My ship', scu, want: null, maxBox: store.get('cargoMaxBox', 32)};
  const grids = () => CARGO.get(st.ship) || CARGO.guess(st.scu);
  const draw = () => {
    const G = grids(), cap = G.reduce((a, g) => a + g.w * g.l * g.h, 0), want = Math.min(st.want == null ? cap : st.want, cap);
    const R = cargoPack(G, want, st.maxBox), cell = Math.max(14, Math.min(34, 420 / Math.max(...G.map(g => Math.max(g.w, g.l)))));
    el.innerHTML = `<div class="cg-hd"><b>CARGO HOLD · ${esc(st.ship.toUpperCase())}</b><button class="btn ghost small" data-cg="close">✕</button></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 10px">
        <label class="f" style="flex-direction:row;align-items:center;gap:6px">Load<input data-cg="want" type="number" min="0" max="${cap}" value="${want}" style="width:80px"> of ${cap} SCU</label>
        <label class="f" style="flex-direction:row;align-items:center;gap:6px">Biggest box<select data-cg="max">${Object.keys(CARGO.boxes()).map(Number).sort((a, b) => b - a).map(n => `<option value="${n}"${n === st.maxBox ? ' selected' : ''}>${n} SCU</option>`).join('')}</select></label>
        <span class="sub">${R.count} boxes: ${Object.keys(R.tally).map(Number).sort((a, b) => b - a).map(n => `<b style="color:${BOX_COLOR[n]}">${R.tally[n]}×${n}</b>`).join(' ') || '—'} · <b>${fmt(R.used)}</b> loaded · <b class="good">${fmt(R.free)}</b> SCU free${R.left > 0 ? ` · <span class="warn">${fmt(R.left)} SCU didn't fit in whole boxes</span>` : ''}</span>
      </div>
      ${G.some(g => g.guess) ? `<div class="sub warn" style="margin-bottom:8px">This grid is a guess from the ship's ${fmt(st.scu)} SCU. Set the real size below, or import the squad's sheet, so the stacking matches the ship.</div>` : ''}
      <div class="cg-body">${R.out.map((o, gi) => `<div class="cg-grid"><div class="cg-gt">${esc(o.g.name || 'Grid ' + (gi + 1))} · ${o.g.w}×${o.g.l}×${o.g.h} = ${o.g.w * o.g.l * o.g.h} SCU</div>
        <div class="cg-row"><div class="cg-iso-wrap">${cargoIsoSvg(o, cell * .8)}</div>
        <div class="cg-layers">${Array.from({length: o.g.h}, (_, z) => `<div><div class="cg-lt">LAYER ${z + 1}${z === 0 ? ' · FLOOR' : ''}</div>${cargoLayerSvg(o, z, cell)}</div>`).join('')}</div></div></div>`).join('')}</div>
      <div class="cg-legend">${Object.keys(CARGO.boxes()).map(Number).sort((a, b) => b - a).map(n => `<span><i style="background:${BOX_COLOR[n]}"></i>${n} SCU <span class="faint">${CARGO.boxes()[n].join('×')}</span></span>`).join('')} <span class="faint">width × length × height in SCU cells · faded = a box continuing from the layer below</span></div>
      <details style="margin-top:10px"${st.open ? ' open' : ''}><summary class="sub">Grid size for this ship — and the squad sheet</summary>
        <div class="sub" style="margin:6px 0">Each grid: width × length × height in SCU (count the floor squares in game: across, along, and how many boxes high). Several grids for ships with more than one hold.</div>
        <div id="cgEdit">${G.map((g, i) => `<div class="row" style="gap:6px;align-items:center;margin-bottom:4px"><input data-gi="${i}" data-k="name" value="${esc(g.name || 'Grid ' + (i + 1))}" style="width:120px">
          W<input data-gi="${i}" data-k="w" type="number" min="1" max="40" value="${g.w}" style="width:60px"> L<input data-gi="${i}" data-k="l" type="number" min="1" max="60" value="${g.l}" style="width:60px"> H<input data-gi="${i}" data-k="h" type="number" min="1" max="10" value="${g.h}" style="width:60px">
          <button class="btn ghost small" data-gdel="${i}">✕</button></div>`).join('')}</div>
        <div class="row" style="gap:6px;margin-top:4px"><button class="btn ghost small" data-cg="addgrid">+ Grid</button><button class="btn small" data-cg="savegrid">Save grid</button><button class="btn ghost small" data-cg="reset">Back to the guess</button></div>
        <div class="sub" style="margin-top:10px"><b>Squad sheet:</b> paste rows of <span class="mono">ship, grid name, width, length, height</span> (Ruger's spreadsheet saved as CSV works). Every ship in it gets its grids.</div>
        <textarea data-cg="csv" rows="4" style="width:100%;margin-top:4px" placeholder="Cutlass Black, Main, 2, 12, 2"></textarea>
        <div class="row" style="gap:6px;margin-top:4px"><button class="btn small" data-cg="import">Import</button><button class="btn ghost small" data-cg="export">Copy all my grids as CSV</button></div>
      </details>`;
    const g = k => $(`[data-cg="${k}"]`, el);
    const det = $('details', el); det.ontoggle = () => { st.open = det.open; };
    g('want').onchange = () => { st.want = Math.max(0, num(g('want').value)); draw(); };
    g('max').onchange = () => { st.maxBox = +g('max').value; store.set('cargoMaxBox', st.maxBox); draw(); };
  };
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.cg, G = grids().map(x => ({...x}));
    const read = () => { $$('#cgEdit input', el).forEach(i => { const r = G[+i.dataset.gi]; r[i.dataset.k] = i.dataset.k === 'name' ? i.value : Math.max(1, Math.round(num(i.value))); delete r.guess; }); return G; };
    if (a === 'close') { el.hidden = true; return; }
    if (a === 'addgrid') { CARGO.set(st.ship, [...read(), {name: 'Grid ' + (G.length + 1), w: 2, l: 4, h: 2}]); draw(); return; }
    if (b.dataset.gdel != null) { const r = read(); r.splice(+b.dataset.gdel, 1); CARGO.set(st.ship, r); draw(); return; }
    if (a === 'savegrid') { CARGO.set(st.ship, read()); toast(`Saved the cargo grid for ${esc(st.ship)}.`); draw(); return; }
    if (a === 'reset') { CARGO.set(st.ship, null); draw(); return; }
    if (a === 'import') { const n = cargoImport($('[data-cg="csv"]', el).value); toast(n ? `Imported grids for ${n} ship${n > 1 ? 's' : ''}.` : 'Nothing to import — one row per grid: ship, grid, width, length, height.'); draw(); return; }
    if (a === 'export') { const csv = cargoExport(); try { navigator.clipboard.writeText(csv); toast('Copied — paste it to the squad or into the sheet.'); } catch { $('[data-cg="csv"]', el).value = csv; } }
  };
  el.hidden = false; draw();
}
function cargoImport(text) {
  const by = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const c = line.split(/[,\t;]/).map(s => s.trim()); if (c.length < 5) continue;
    const [ship, name, w, l, h] = c, W = Math.round(num(w)), Ln = Math.round(num(l)), Hh = Math.round(num(h));
    if (!ship || !W || !Ln || !Hh || /^ship$/i.test(ship)) continue;
    (by[ship] = by[ship] || []).push({name: name || 'Grid', w: W, l: Ln, h: Hh});
  }
  Object.entries(by).forEach(([s, g]) => CARGO.set(s, g));
  return Object.keys(by).length;
}
function cargoExport() {
  const rows = ['ship,grid,width,length,height'];
  for (const [ship, gs] of Object.entries(CARGO.grids())) for (const g of gs) rows.push([ship, g.name || 'Grid', g.w, g.l, g.h].join(','));
  return rows.join('\n');
}
