/* shop.js — "what's the best price for aluminum?" · "what does Baijini Point buy?" · our own price log.

   UEX prices are player-reported and can be days old, so every answer shows its age, flags stale ones,
   and asks "was that right?". Your answers and logged trades go to the squad price log (and stay on this PC),
   and a newer squad report beats an older UEX number. Job debriefs feed the same log. */

const PRICEDB = {
  mine: () => store.get('tradeLog', []),
  squad: [], lastPull: 0,
  async pull(force) {
    if (!force && Date.now() - this.lastPull < 5 * 60e3) return;
    this.lastPull = Date.now();
    try { const r = await fetch(`${SQUAD.url()}/api/prices?key=${encodeURIComponent(SQUAD.key())}`, {cache: 'no-store'}); const j = await r.json(); if (r.ok) this.squad = j.prices || []; } catch {}
    try { const r = await fetch(`${SQUAD.url()}/api/reports?key=${encodeURIComponent(SQUAD.key())}`, {cache: 'no-store'}); const j = await r.json();  // job debriefs count too
      if (r.ok) this.fromReports = (j.reports || []).flatMap(rep => (rep.legs || []).filter(l => l.actual && l.cid && l.term).map(l => ({kind: l.kind, cid: l.cid, term: l.term, price: l.actual, t: rep.t, name: rep.name, src: 'job'}))); } catch {}
  },
  all() { const seen = new Set(); return [...this.mine(), ...this.squad, ...(this.fromReports || [])].filter(e => { const k = e.id || `${e.t}|${e.cid}|${e.term}|${e.kind}`; if (seen.has(k)) return false; seen.add(k); return true; }); },
  async add(entries) {
    entries = entries.map(e => ({id: Math.random().toString(36).slice(2, 12), t: Date.now(), name: PILOT(), ...e}));
    store.set('tradeLog', [...this.mine(), ...entries].slice(-2000));
    try { await fetch(`${SQUAD.url()}/api/prices`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: SQUAD.key(), entries})}); } catch {}
    this.squad = [...this.squad, ...entries];
  },
  // newest real price we have for this commodity at this terminal (buy = what the shop sells to you for)
  ours(cid, term, side) {
    let best = null;
    for (const e of this.all()) {
      if (e.cid !== cid || e.term !== term || !e.price) continue;
      const sd = e.kind === 'check' ? e.side : e.kind;
      if (sd !== side || (e.kind === 'check' && e.accurate === true)) continue;
      if (!best || e.t > best.t) best = e;
    }
    return best;
  },
  votes(cid, term, side) {  // squad "was it right?" answers for this UEX price
    let up = 0, down = 0;
    for (const e of this.all()) if (e.kind === 'check' && e.cid === cid && e.term === term && e.side === side) e.accurate ? up++ : down++;
    return {up, down};
  }
};

/* ---------------- understanding the question ---------------- */
const SHOP_RX = /\b(price|prices|pricing|cost|costs|worth|pay|pays|paying|sell|sells|selling|buy|buys|buying|shop|terminal|market)\b/;
function shopFindCommodity(q) {
  const qn = norm(q); if (!qn) return null;
  let best = null, bs = 0;
  for (const c of L.commodities) {
    const n = norm(c.name), code = norm(c.code || '');
    let s = 0;
    if (n === qn || code === qn) s = 3; else if (qn.includes(n) && n.length > 3) s = 2 + n.length / 100; else if (n.startsWith(qn) && qn.length >= 4) s = 1.5; else if (n.includes(qn) && qn.length >= 4) s = 1;
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}
function shopFindTerminal(q) {
  const toks = String(q).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !['the', 'at', 'on', 'in', 'station', 'terminal'].includes(w));
  if (!toks.length) return [];
  const hits = L.terminals.filter(t => { const h = termHay(t); return toks.every(w => h.includes(w)); });
  // a station has several terminals (commodities, refinery, ships…): keep the trading ones
  const trade = hits.filter(t => L.prices.some(p => p.id_terminal === t.id));
  return trade.length ? trade : hits;
}
function shopParse(text) {
  const t = text.toLowerCase().replace(/[?.!]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!SHOP_RX.test(t)) return null;
  // "what does baijini point buy / sell / pay for"
  let m = t.match(/\b(?:what|which|whats|what's)\b.*?\b(?:does|do|can|will)\s+(.+?)\s+(buy|sell|pay for|take|carry|have|stock)\b/);
  if (m) return {kind: 'terminal', where: m[1], mode: /sell|carry|have|stock/.test(m[2]) ? 'sells' : 'buys'};
  m = t.match(/^(?:prices?|shop|market|terminal)\s+(?:at|for|of)\s+(.+)$/);
  if (m && shopFindTerminal(m[1]).length) return {kind: 'terminal', where: m[1], mode: 'buys'};
  // "best price for aluminum" · "where can i sell aluminum" · "who buys laranite" · "price of agricium" · "where to buy titanium"
  m = t.match(/\bwhere (?:can i |do i |should i |to |is best to )?(sell|buy)\s+(?:some |my )?(.+)$/) || t.match(/\bwho (buys|sells)\s+(.+)$/);
  if (m) return {kind: 'commodity', what: m[2], mode: m[1].startsWith('sell') && !/who/.test(t) ? 'sell' : m[1] === 'buys' ? 'sell' : 'buy'};
  m = t.match(/\b(?:best |top |highest |good |cheapest |lowest )?(?:sell |selling |buy |buying )?(?:price|prices|cost)\s+(?:for|of|on)\s+(.+?)(?:\s+(?:right now|now|today|in \w+))?$/);
  if (m) return {kind: 'commodity', what: m[1], mode: /cheap|lowest|buy|cost/.test(t) && !/sell/.test(t) ? 'buy' : 'sell'};
  m = t.match(/^(?:how much (?:is|does|for)|what'?s)\s+(.+?)\s+(?:worth|going for|selling for|sell for)\b/);
  if (m) return {kind: 'commodity', what: m[1], mode: 'sell'};
  return null;
}

/* ---------------- answering ---------------- */
const STALE = 2 * 86400;  // UEX numbers older than two days get a warning
function shopSys() { const h = typeof hereEnt === 'function' && hereEnt(); return h ? sysName(h.sys) : ($('#sysIn') && $('#sysIn').value) || ''; }
function shopRow(p, side) {
  const t = L.term.get(p.id_terminal), now = Date.now() / 1000, cid = p.id_commodity;
  const uexPrice = num(side === 'sell' ? p.price_sell : p.price_buy), uexAge = now - (num(p.date_modified) || num(p.date_added) || now);
  const o = PRICEDB.ours(cid, p.id_terminal, side), oAge = o ? now - o.t / 1000 : Infinity;
  const useOurs = o && oAge < uexAge;
  return {p, t, cid, term: p.id_terminal, side, price: useOurs ? o.price : uexPrice, age: useOurs ? oAge : uexAge, uexPrice,
    src: useOurs ? (o.src === 'job' ? 'SQUAD JOB' : 'SQUAD') + ' · ' + (o.name || '') : 'UEX', stale: !useOurs && uexAge > STALE,
    stock: side === 'buy' ? num(p.scu_buy) || num(p.scu_buy_avg) : num(p.scu_sell) || num(p.scu_sell_avg), votes: PRICEDB.votes(cid, p.id_terminal, side)};
}
async function shopQuery(text, spoken) {
  const q = shopParse(text); if (!q) return false;
  try { await tradeData(); } catch { return false; }
  PRICEDB.pull();
  const sys = shopSys();
  if (q.kind === 'commodity') {
    const c = shopFindCommodity(q.what); if (!c) return false;
    let rows = L.prices.filter(p => p.id_commodity === c.id && num(q.mode === 'sell' ? p.price_sell : p.price_buy) > 0).map(p => shopRow(p, q.mode));
    const inSys = rows.filter(r => !sys || (r.t && r.t.star_system_name === sys));
    if (inSys.length) rows = inSys;
    rows.sort((a, b) => q.mode === 'sell' ? b.price - a.price : a.price - b.price);
    const best = rows.find(r => !r.stale) || rows[0];
    const title = `${c.name} — ${q.mode === 'sell' ? 'best places to sell' : 'cheapest places to buy'}${sys && inSys.length ? ' in ' + sys : ''}`;
    const line = !best ? `Nobody has reported ${c.name} ${q.mode === 'sell' ? 'buyers' : 'for sale'} yet.`
      : `${q.mode === 'sell' ? 'Best sell' : 'Cheapest buy'} for ${c.name}: ${fmt(best.price)} at ${termLabel(best.t, best.p)}, ${ago(best.age)} old${best.stale ? ' — that one may be out of date' : ''}.`;
    shopCard(title, rows.slice(0, 8), line, {c, mode: q.mode});
    shopTell(line, spoken); return true;
  }
  const ts = shopFindTerminal(q.where); if (!ts.length) return false;
  const ids = new Set(ts.map(t => t.id)), side = q.mode === 'sells' ? 'buy' : 'sell';
  const rows = L.prices.filter(p => ids.has(p.id_terminal) && num(side === 'sell' ? p.price_sell : p.price_buy) > 0).map(p => shopRow(p, side))
    .sort((a, b) => b.price - a.price);
  const name = termLabel(ts[0]);
  const line = !rows.length ? `I don't have anything ${q.mode === 'sells' ? 'for sale' : 'being bought'} at ${name}.`
    : `${name} ${q.mode === 'sells' ? 'sells' : 'buys'} ${rows.length} commodit${rows.length > 1 ? 'ies' : 'y'}. Top: ${rows.slice(0, 3).map(r => `${(L.com.get(r.cid) || {}).name || r.p.commodity_name} ${fmt(r.price)}`).join(', ')}.`;
  shopCard(`${name} — what it ${q.mode === 'sells' ? 'sells' : 'buys'}`, rows.slice(0, 14), line, {term: ts[0]});
  shopTell(line, spoken); return true;
}
function shopTell(line, spoken) { if (spoken) say(line); if (typeof CK !== 'undefined' && CK.on) ufcSay(line); }

/* ---------------- the answer card, with "was it right?" ---------------- */
function shopCard(title, rows, line, ctx) {
  let el = $('#shopCard'); if (!el) { el = document.createElement('div'); el.id = 'shopCard'; document.body.appendChild(el); }
  SHOP.rows = rows; SHOP.ctx = ctx;
  const byTerm = !!ctx.term;
  el.innerHTML = `<div class="sc-hd"><b>${esc(title)}</b><button class="btn ghost small" data-sc="close" title="Close">✕</button></div>
    <div class="sc-line">${esc(line)}</div>
    <table>${rows.length ? `<tr><th>${byTerm ? 'Commodity' : 'Where'}</th><th class="r">${ctx.mode === 'buy' || (byTerm && SHOP.rows[0] && SHOP.rows[0].side === 'buy') ? 'Buy at' : 'Sell for'}</th><th class="r">SCU</th><th class="r">Age</th><th>Source</th><th></th></tr>` : ''}
    ${rows.map((r, i) => `<tr class="${r.stale ? 'stale' : ''}"><td>${byTerm ? `<b>${esc((L.com.get(r.cid) || {}).name || r.p.commodity_name)}</b>` : `<b>${esc(termLabel(r.t, r.p))}</b><div class="sub">${esc(placeLabel(r.t))}</div>`}</td>
      <td class="r num">${fmt(r.price)}</td><td class="r num">${r.stock ? fmt(r.stock) : '—'}</td><td class="r ${r.stale ? 'warn' : 'sub'}">${r.stale ? '⚠ ' : ''}${ago(r.age)}</td>
      <td class="sub">${esc(r.src)}${r.votes.up || r.votes.down ? ` · 👍${r.votes.up} 👎${r.votes.down}` : ''}</td>
      <td style="white-space:nowrap"><button class="btn ghost small" data-ok="${i}" title="This price was right">✓</button><button class="btn ghost small" data-bad="${i}" title="Wrong — tell us the real one">✗</button></td></tr>`).join('')}</table>
    <div id="scForm"></div>
    <div class="row" style="justify-content:space-between;margin-top:8px;gap:8px;flex-wrap:wrap"><span class="sub">UEX prices are player-reported. ⚠ = older than 2 days. ✓ / ✗ and logged trades go to the squad price log.</span>
      <button class="btn small" data-sc="log">+ Log a trade</button></div>`;
  el.hidden = false;
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sc === 'close') { el.hidden = true; return; }
    if (b.dataset.sc === 'log') return tradeForm($('#scForm'), {cid: ctx.c && ctx.c.id, term: ctx.term && ctx.term.id});
    if (b.dataset.ok != null) { const r = rows[+b.dataset.ok]; PRICEDB.add([{kind: 'check', side: r.side, cid: r.cid, commodity: (L.com.get(r.cid) || {}).name, term: r.term, termName: termLabel(r.t), uex: r.uexPrice, price: r.price, accurate: true}]);
      b.textContent = '✓ thanks'; b.disabled = true; return; }
    if (b.dataset.bad != null) { const r = rows[+b.dataset.bad]; return tradeForm($('#scForm'), {cid: r.cid, term: r.term, side: r.side, check: r}); }
  };
}
const SHOP = {rows: [], ctx: {}};

// one form for "that price was wrong, here's the real one" and "log a trade"
function tradeForm(box, pre) {
  const coms = L.commodities.slice().sort((a, b) => a.name.localeCompare(b.name));
  const terms = L.terminals.filter(t => L.prices.some(p => p.id_terminal === t.id)).sort((a, b) => termLabel(a).localeCompare(termLabel(b)));
  const fix = !!pre.check;
  box.innerHTML = `<div class="sc-form"><b>${fix ? 'What was the real price?' : 'Log a trade'}</b>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">
      <select data-f="kind"><option value="buy"${pre.side === 'buy' ? ' selected' : ''}>I bought</option><option value="sell"${pre.side !== 'buy' ? ' selected' : ''}>I sold</option></select>
      <select data-f="cid">${coms.map(c => `<option value="${c.id}"${c.id === pre.cid ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <span class="sub">at</span><select data-f="term" style="max-width:260px">${terms.map(t => `<option value="${t.id}"${t.id === pre.term ? ' selected' : ''}>${esc(termLabel(t))} · ${esc(t.star_system_name || '')}</option>`).join('')}</select>
      <input data-f="price" type="number" min="0" step="0.01" placeholder="aUEC / SCU" style="width:110px" value="${fix ? '' : ''}">
      <input data-f="scu" type="number" min="0" step="1" placeholder="SCU" style="width:80px">
      <input data-f="note" type="text" placeholder="note (stock ran out, price moved…)" style="flex:1;min-width:160px">
      <button class="btn small" data-f="save">Save</button></div></div>`;
  $('[data-f="save"]', box).onclick = async () => {
    const v = k => $(`[data-f="${k}"]`, box).value, cid = +v('cid'), term = +v('term'), price = num(v('price'));
    if (!price) { toast('Put in the price per SCU.'); return; }
    const t = L.term.get(term), e = {kind: v('kind'), cid, commodity: (L.com.get(cid) || {}).name, term, termName: termLabel(t), price, scu: num(v('scu')) || null, note: v('note')};
    const out = [e]; if (fix) out.push({kind: 'check', side: pre.check.side, cid, commodity: e.commodity, term, termName: e.termName, uex: pre.check.uexPrice, price, accurate: false, note: v('note')});
    await PRICEDB.add(out); box.innerHTML = '<div class="good sub">Saved to your log and the squad price log — thanks.</div>'; renderTradeLog();
  };
}

/* ---------------- trade log panel (Contracts tab) ---------------- */
function renderTradeLog() {
  const el = $('#tradeLogList'); if (!el || !L) return;
  const all = PRICEDB.all().filter(e => e.kind !== 'check').sort((a, b) => b.t - a.t).slice(0, 25), now = Date.now() / 1000;
  el.innerHTML = all.length ? `<table><tr><th>When</th><th>Who</th><th></th><th>Commodity</th><th>Where</th><th class="r">aUEC/SCU</th><th class="r">SCU</th></tr>${all.map(e => `<tr><td class="sub">${ago(now - e.t / 1000)}</td><td>${esc(e.name || '')}</td><td>${e.kind === 'buy' ? 'bought' : 'sold'}</td>
    <td>${esc(e.commodity || (L.com.get(e.cid) || {}).name || '')}</td><td>${esc(e.termName || termLabel(L.term.get(e.term)))}</td><td class="r num">${fmt(e.price)}</td><td class="r num">${e.scu ? fmt(e.scu) : '—'}</td></tr>`).join('')}</table>`
    : '<div class="muted">Nothing logged yet. Log what you actually paid and got — the whole squad sees it, and fresh reports beat old UEX numbers.</div>';
}
async function initTradeLog() {
  const p = $('#tradeLogPanel'); if (!p || p._w) return; p._w = 1;
  $('#tlAdd').onclick = async () => { await tradeData(); tradeForm($('#tlForm'), {}); };
  try { await tradeData(); } catch {}
  await PRICEDB.pull(true); renderTradeLog();
}
setTimeout(initTradeLog, 2500);
