'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lang = localStorage.getItem('lang') || 'en', token = sessionStorage.getItem('token'), me = null, page = 'overview', map = null;
const t = k => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
const fmt = (n, d = 2) => n == null ? '—' : Number(n).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const brl = n => n == null ? '—' : 'R$ ' + fmt(n);

async function api(path, opts = {}) {
  const h = {...(opts.headers || {})};
  if (token) h.Authorization = 'Bearer ' + token;
  if (opts.json !== undefined) { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); opts.method = opts.method || 'POST'; }
  const r = await fetch(path, {...opts, headers: h});
  if (r.status === 401 && !path.includes('/auth/login')) { logout(); throw new Error('Session expired'); }
  let d; try { d = await r.json(); } catch { d = {detail: 'Unexpected server response'}; }
  if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail));
  return d;
}
function toast(msg) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = msg; document.body.append(e); setTimeout(() => e.remove(), 4200); }
const safe = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

// ---------- shell
const PAGES = [['overview', 'viewer'], ['shipments', 'viewer'], ['compare', 'viewer'], ['sourcing', 'viewer'], ['batch', 'operator'], ['whatif', 'viewer'], ['carriers', 'viewer'], ['analytics', 'viewer'], ['backtest', 'viewer'], ['import', 'admin']];
const RANK = {viewer: 1, operator: 2, admin: 3};
function applyLang() {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = t(e.dataset.i18n));
  $('#langBtn').textContent = lang === 'ar' ? 'English' : 'العربية';
  if (me) buildNav();
}
function buildNav() {
  $('#nav').innerHTML = PAGES.filter(([, r]) => RANK[me.role] >= RANK[r]).map(([p]) => `<button data-p="${p}" class="${p === page ? 'active' : ''}">${esc(t(p))}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => show(b.dataset.p));
}
function logout() { token = null; me = null; sessionStorage.removeItem('token'); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#langBtn').onclick = () => { lang = lang === 'ar' ? 'en' : 'ar'; localStorage.setItem('lang', lang); applyLang(); if (me) show(page); };
$('#logout').onclick = logout;
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { const d = await api('/api/auth/login', {json: Object.fromEntries(new FormData(e.target))}); token = d.access_token; sessionStorage.setItem('token', token); await boot(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
async function boot() {
  try { me = await api('/api/auth/me'); } catch { logout(); return; }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#whoami').textContent = `${me.username} · ${me.role}`; applyLang(); show('overview');
  api('/api/health').then(() => { $('#apiStatus').textContent = '● API'; }).catch(() => { $('#apiStatus').textContent = '● down'; $('#apiStatus').className = 'pill bad'; });
}
async function show(p) {
  page = p; buildNav(); $('#pageTitle').textContent = t(p); $('#crumb').textContent = p.toUpperCase();
  if (map) { map.remove(); map = null; }
  $('#view').innerHTML = `<div class="muted">${t('loading')}</div>`;
  try { await PAGE[p](); } catch (e) { $('#view').innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
}
const table = (rows, cols) => !rows.length ? `<div class="muted">${t('empty')}</div>` :
  `<div class="scroll"><table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr class="${c0(r)}">${cols.map(c => `<td>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const c0 = r => r._best ? 'best' : '';
const stPill = s => `<span class="pill ${s === 'Delivered' ? 'ok' : s === 'Canceled' ? 'bad' : s === 'Pending' ? '' : 'warn'}">${esc(s)}</span>`;
const objectiveSelect = (id = 'objective') => `<select id="${id}">${['balanced', 'cost', 'speed', 'reliability', 'custom'].map(o => `<option value="${o}">${esc(t(o))}</option>`).join('')}</select>`;
const weightsFields = () => `<div class="row" id="wBox" style="display:none;margin-top:8px">${[['cost', .4], ['speed', .4], ['risk', .2]].map(([k, v]) => `<div class="field"><label>w ${k}</label><input id="w_${k}" type="number" min="0" max="1" step="0.05" value="${v}"></div>`).join('')}</div>`;
function readObjective() { const o = $('#objective').value, out = {objective: o}; if (o === 'custom') out.weights = {cost: +$('#w_cost').value, speed: +$('#w_speed').value, risk: +$('#w_risk').value}; return out; }
function bindObjective() { const s = $('#objective'); if (s) s.onchange = () => { $('#wBox').style.display = s.value === 'custom' ? 'flex' : 'none'; }; }

// ---------- map & pareto
function drawMap(o, d) {
  const el = $('#map'); if (!el) return;
  if (!window.L) { el.innerHTML = '<div class="notice">Map library not reachable (offline?). Route: ' + esc(o.label) + ' → ' + esc(d.label) + '</div>'; return; }
  map = L.map(el); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '© OpenStreetMap', maxZoom: 12}).addTo(map);
  const a = [o.lat, o.lng], b = [d.lat, d.lng];
  L.marker(a).addTo(map).bindPopup(esc(o.label)); L.marker(b).addTo(map).bindPopup(esc(d.label));
  L.polyline([a, b], {color: '#2f6bea', weight: 3, dashArray: '6 6'}).addTo(map); map.fitBounds([a, b], {padding: [40, 40]});
}
function paretoSvg(rows) {
  if (!rows.length) return ''; const W = 520, H = 240, m = 42;
  const xs = rows.map(r => r.eta_p90_days), ys = rows.map(r => r.price), x0 = Math.min(...xs) * .9, x1 = Math.max(...xs) * 1.05, y0 = Math.min(...ys) * .9, y1 = Math.max(...ys) * 1.05;
  const X = v => m + (v - x0) / ((x1 - x0) || 1) * (W - m - 12), Y = v => H - m - (v - y0) / ((y1 - y0) || 1) * (H - m - 12);
  const fr = rows.filter(r => r.pareto).sort((a, b) => a.eta_p90_days - b.eta_p90_days);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:560px"><line x1="${m}" y1="${H - m}" x2="${W - 8}" y2="${H - m}" stroke="#cbd5e3"/><line x1="${m}" y1="10" x2="${m}" y2="${H - m}" stroke="#cbd5e3"/>
  <text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="#6e7f96">ETA P90 (days)</text><text x="12" y="${H / 2}" fill="#6e7f96" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">BRL</text>
  ${fr.length > 1 ? `<polyline fill="none" stroke="#138a68" stroke-width="2" points="${fr.map(r => X(r.eta_p90_days) + ',' + Y(r.price)).join(' ')}"/>` : ''}
  ${rows.map(r => `<circle cx="${X(r.eta_p90_days)}" cy="${Y(r.price)}" r="6" fill="${r.pareto ? '#138a68' : '#9aa9bd'}"/><text x="${X(r.eta_p90_days) + 9}" y="${Y(r.price) + 4}" fill="#1b2b40">${esc(r.carrier_code)}</text>`).join('')}</svg>`;
}
function quoteTable(res, assignFn) {
  const rows = res.quotes.map((q, i) => ({...q, _best: res.recommendation && q.carrier_code === res.recommendation.carrier_code}));
  const cols = [{label: t('carrier'), html: r => `<b>${esc(r.carrier)}</b>${r._best ? `<span class="badge">${t('recommended')}</span>` : ''}${r.pareto ? '<span class="badge">Pareto</span>' : ''}<div class="muted sm">${esc(r.service)}</div>`},
    {label: t('price'), html: r => `<b>${brl(r.price)}</b><div class="muted sm">${r.breakdown ? `base ${fmt(r.breakdown.base)} · kg ${fmt(r.breakdown.weight)} · fuel ${fmt(r.breakdown.fuel)}` : ''}</div>`},
    {label: t('eta50'), html: r => fmt(r.eta_p50_days, 1) + ' d'}, {label: t('eta90'), html: r => fmt(r.eta_p90_days, 1) + ' d'},
    {label: t('risk'), html: r => `<div class="bar" style="width:70px"><i style="width:${Math.round(r.late_risk * 100)}%;background:${r.late_risk > .3 ? '#c0392b' : '#2f6bea'}"></i></div>${fmt(r.late_risk * 100, 0)}%`},
    {label: t('why'), html: r => `<span class="${r.eligible ? '' : 'muted'}">${esc(r.reason || '')}</span>`}];
  if (assignFn) cols.push({label: '', html: r => r.eligible ? `<button class="ghost sm" data-assign="${esc(r.carrier_code)}">${t('choose')}</button>` : ''});
  return table(rows, cols);
}
function excludedBlock(res) { return res.excluded.length ? `<div class="muted sm" style="margin-top:10px"><b>${t('excluded')}:</b> ${res.excluded.map(e => esc(e.carrier_code + ' — ' + e.reason)).join(' · ')}</div>` : ''; }

// ---------- pages
const PAGE = {
  async overview() {
    const k = await api('/api/kpis');
    const cards = [['total', k.total], ['pending', k.pending], ['booked', k.booked], ['in_transit', k.in_transit]].map(([n, v]) => `<div class="card"><div class="muted">${t(n)}</div><div class="metric">${fmt(v, 0)}</div></div>`).join('');
    const cards2 = [['delivered', fmt(k.delivered, 0)], ['canceled', fmt(k.canceled, 0)], ['avg_price', brl(k.avg_booked_price)], ['avg_hist', brl(k.avg_historical_freight)]].map(([n, v]) => `<div class="card"><div class="muted">${t(n)}</div><div class="metric">${v}</div></div>`).join('');
    const rec = await api('/api/shipments?limit=6');
    $('#view').innerHTML = `<div class="notice">${t('notice_sim')}</div><div class="grid g4">${cards}</div><div class="grid g4">${cards2}</div><div class="panel"><h2>${t('shipments')}</h2>${table(rec.items, [{label: 'ID', key: 'order_id'}, {label: t('origin'), key: 'origin'}, {label: t('destination'), key: 'destination'}, {label: t('status'), html: r => stPill(r.status)}])}</div>`;
  },

  async shipments(state = {q: '', status: '', offset: 0}) {
    const L = 15, qs = `?limit=${L}&offset=${state.offset}&q=${encodeURIComponent(state.q)}${state.status ? '&status=' + encodeURIComponent(state.status) : ''}`;
    const d = await api('/api/shipments' + qs);
    const canOp = RANK[me.role] >= 2;
    $('#view').innerHTML = `${canOp ? `<div class="panel"><h2>${t('new_shipment')}</h2><form id="newForm" class="row">
      <div class="field"><label>${t('origin')}</label><input name="origin" value="Campinas, SP" required></div><div class="field"><label>${t('destination')}</label><input name="destination" value="Recife, PE" required></div>
      <div class="field" style="max-width:110px"><label>${t('weight')}</label><input name="weight_kg" type="number" step="0.1" min="0.1" value="2" required></div>
      <div class="field" style="max-width:150px"><label>Deadline</label><input name="deadline" type="date"></div><button class="primary">${t('create')}</button></form></div>` : ''}
      <div class="panel"><div class="row" style="margin-bottom:10px"><div class="field"><input id="q" placeholder="${t('search')}" value="${esc(state.q)}"></div>
      <div class="field" style="max-width:170px"><select id="st"><option value="">All</option>${['Pending', 'Booked', 'In Transit', 'Delivered', 'Canceled'].map(s => `<option ${s === state.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      ${table(d.items, [{label: 'ID', html: r => `<code>${esc(r.order_id.slice(0, 14))}${r.order_id.length > 14 ? '…' : ''}</code>`}, {label: t('origin'), key: 'origin'}, {label: t('destination'), key: 'destination'}, {label: 'kg', html: r => fmt(r.weight_kg, 2)},
        {label: t('status'), html: r => stPill(r.status)}, {label: t('carrier'), html: r => esc(r.carrier_code || '—')}, {label: t('price'), html: r => brl(r.price)},
        {label: '', html: r => canOp ? `<button class="ghost sm" data-open="${r.id}">${r.status === 'Pending' ? t('assign') : t('tracking')}</button>` : ''}])}
      <div class="pager"><span class="muted sm">${d.total ? state.offset + 1 : 0}–${Math.min(state.offset + L, d.total)} / ${fmt(d.total, 0)}</span><button class="ghost sm" id="prev" ${state.offset ? '' : 'disabled'}>${t('prev')}</button><button class="ghost sm" id="next" ${state.offset + L < d.total ? '' : 'disabled'}>${t('next')}</button></div></div><div id="detail"></div>`;
    const reload = (p = {}) => PAGE.shipments({...state, ...p});
    if ($('#newForm')) $('#newForm').onsubmit = safe(async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.weight_kg = +f.weight_kg; if (!f.deadline) delete f.deadline; await api('/api/shipments', {json: f}); toast('OK'); reload({offset: 0}); });
    let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => reload({q: e.target.value, offset: 0}), 350); };
    $('#st').onchange = e => reload({status: e.target.value, offset: 0});
    $('#prev').onclick = () => reload({offset: Math.max(0, state.offset - L)}); $('#next').onclick = () => reload({offset: state.offset + L});
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = safe(() => openShipment(+b.dataset.open, () => reload())));
  },

  async compare() {
    $('#view').innerHTML = `<div class="panel"><h2>${t('compare')}</h2><form id="qf"><div class="row">
      <div class="field"><label>${t('origin')}</label><input name="origin" value="Sao Paulo, SP" required></div><div class="field"><label>${t('destination')}</label><input name="destination" value="Manaus, AM" required></div>
      <div class="field" style="max-width:100px"><label>${t('weight')}</label><input name="weight_kg" type="number" step="0.1" min="0.1" value="2.5"></div>
      <div class="field" style="max-width:150px"><label>L×H×W cm</label><input name="dims" placeholder="30x20x15"></div>
      <div class="field" style="max-width:110px"><label>R$ value</label><input name="declared_value" type="number" min="0" value="150"></div>
      <div class="field" style="max-width:120px"><label>${t('deadline')}</label><input name="deadline_days" type="number" min="1" placeholder="—"></div>
      <div class="field" style="max-width:170px"><label>${t('objective')}</label>${objectiveSelect()}</div><button class="primary">${t('compare_btn')}</button></div>${weightsFields()}</form></div><div id="qres"></div>`;
    bindObjective();
    $('#qf').onsubmit = safe(async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), body = {origin: f.origin, destination: f.destination, weight_kg: +f.weight_kg, declared_value: +f.declared_value || 0, ...readObjective()};
      if (f.deadline_days) body.deadline_days = +f.deadline_days;
      const m = (f.dims || '').toLowerCase().match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/); if (m) { body.length_cm = +m[1]; body.height_cm = +m[2]; body.width_cm = +m[3]; }
      $('#qres').innerHTML = `<div class="muted">${t('loading')}</div>`; const r = await api('/api/quotes', {json: body});
      $('#qres').innerHTML = `<div class="notice">${esc(r.notice)}</div>${r.infeasible ? `<div class="notice" style="background:#fdecea;color:#a33">${t('none_feasible')} — ${esc(JSON.stringify(r.infeasible.fastest_available || {}))}</div>` : ''}
        <div class="panel"><div class="muted sm">${esc(r.origin.label)} → ${esc(r.destination.label)} · ${fmt(r.quotes[0] ? r.quotes[0].distance_km : 0, 0)} km · zone ${r.quotes[0] ? r.quotes[0].zone : '—'}</div>${quoteTable(r)}${excludedBlock(r)}</div>
        <div class="grid g2"><div class="panel"><h2>${t('map')}</h2><div id="map"></div></div><div class="panel"><h2>${t('pareto')}</h2>${paretoSvg(r.quotes.filter(q => q.eligible))}</div></div>`;
      drawMap(r.origin, r.destination);
    });
  },

  async sourcing() {
    const prods = await api('/api/products/multi-seller?limit=12');
    $('#view').innerHTML = `<div class="panel"><h2>${t('sourcing')}</h2><div class="notice">Olist has no inventory data: candidates are sellers that sold the product before.</div><form id="sf" class="row">
      <div class="field" style="flex:2"><label>${t('product')}</label><select name="product_id">${prods.map(p => `<option value="${esc(p.product_id)}">${esc(p.category || '?')} · ${p.sellers} sellers · ${fmt(p.weight_kg, 2)}kg · ${esc(p.product_id.slice(0, 8))}</option>`).join('')}</select></div>
      <div class="field"><label>${t('destination')}</label><input name="destination" value="Salvador, BA" required></div><div class="field" style="max-width:90px"><label>${t('qty')}</label><input name="quantity" type="number" min="1" value="1"></div>
      <div class="field" style="max-width:170px"><label>${t('objective')}</label>${objectiveSelect()}</div><button class="primary">${t('run')}</button></form></div><div id="sres"></div>`;
    $('#sf').onsubmit = safe(async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const o = $('#objective').value;
      const r = await api('/api/sourcing/rank', {json: {product_id: f.product_id, destination: f.destination, quantity: +f.quantity, objective: o === 'custom' ? 'balanced' : o}});
      $('#sres').innerHTML = `<div class="panel">${table(r.candidates.map(c => ({...c, _best: c.rank === 1})), [{label: '#', key: 'rank'}, {label: t('seller'), html: r => `<code>${esc(r.seller_id.slice(0, 8))}</code><div class="muted sm">${esc(r.origin.label)}</div>`},
        {label: t('distance'), html: r => fmt(r.distance_km, 0)}, {label: 'Handling', html: r => fmt(r.seller_handling_days, 1) + ' d'}, {label: t('carrier'), html: r => r.best_option ? esc(r.best_option.carrier) : '—'},
        {label: t('price'), html: r => r.best_option ? brl(r.best_option.price) : '—'}, {label: t('eta90'), html: r => r.best_option ? fmt(r.best_option.eta_p90_days, 1) + ' d' : '—'}, {label: 'Score', html: r => r.source_score ?? '—'}])}</div>`;
    });
  },

  async batch() {
    $('#view').innerHTML = `<div class="panel"><h2>${t('batch')}</h2><div class="notice">Assigns Pending shipments to carriers with a MILP (HiGHS): minimises the weighted score subject to each carrier's remaining daily capacity.</div>
      <form id="bf" class="row"><div class="field" style="max-width:120px"><label>${t('orders')}</label><input name="limit" type="number" min="1" max="2000" value="300"></div><div class="field" style="max-width:190px"><label>${t('objective')}</label>${objectiveSelect()}</div>
      <label class="row" style="gap:6px"><input type="checkbox" id="applyChk" style="width:auto"> ${t('apply')}</label><label class="row" style="gap:6px" title="Assign orders whose deadline no carrier can meet (flagged as at risk)"><input type="checkbox" id="relaxChk" style="width:auto"> Relax impossible deadlines</label><button class="primary">${t('run')}</button></form>${weightsFields()}</div><div id="bres"></div>`;
    bindObjective();
    $('#bf').onsubmit = safe(async e => {
      e.preventDefault(); $('#bres').innerHTML = `<div class="muted">${t('loading')}</div>`;
      const r = await api('/api/optimize/batch', {json: {limit: +new FormData(e.target).get('limit'), apply: $('#applyChk').checked, relax_deadline: $('#relaxChk').checked, ...readObjective()}});
      const row = (n, x) => ({policy: n, ...x, load: Object.entries(x.carrier_load || {}).map(([k, v]) => `${k}:${v}`).join(' ')});
      const rows = [row('OPTIMIZED', r.optimized), ...Object.entries(r.baselines).map(([k, v]) => row(k, v))].map((x, i) => ({...x, _best: i === 0}));
      const cmp = Object.entries(r.baselines).filter(([, v]) => v.vs_optimized && v.vs_optimized.common_orders).map(([k, v]) => ({policy: k, ...v.vs_optimized}));
      const why = Object.entries(r.unassigned_summary || {}).map(([k, v]) => `<b>${esc(k)}</b>: ${v}`).join(' · ') || '—';
      const un = r.unassigned.slice(0, 15).map(u => ({order: u.order_id.slice(0, 12), code: u.reason_code, reason: u.reason}));
      $('#bres').innerHTML = `<div class="panel"><h2>Optimized plan</h2>${table(rows, [{label: 'Policy', key: 'policy'}, {label: t('orders'), key: 'assigned'}, {label: 'Total', html: r => brl(r.total_cost)}, {label: 'ETA P50', html: r => fmt(r.avg_eta_p50_days, 1) + ' d'}, {label: 'Exp. late', key: 'expected_late_orders'}, {label: 'Load', key: 'load'}])}
        <p class="muted sm">solver: ${esc(r.solver ? r.solver.name : '')}${r.applied != null ? ` · applied: ${r.applied}` : ''}${r.relaxed_assignments ? ` · ${r.relaxed_assignments} assigned with deadline at risk` : ''}. The totals above cover different order sets when a policy assigns a different number of orders — use the like-for-like table below.</p></div>
        <div class="panel"><h2>Optimized vs each policy (same orders only)</h2>${table(cmp, [{label: 'Policy', key: 'policy'}, {label: 'Common orders', key: 'common_orders'}, {label: 'Cost change', html: x => (x.cost_change_pct > 0 ? '+' : '') + fmt(x.cost_change_pct, 1) + '%'}, {label: 'ETA change', html: x => (x.avg_eta_change_days > 0 ? '+' : '') + fmt(x.avg_eta_change_days, 1) + ' d'}, {label: 'Exp. late change', html: x => (x.expected_late_change > 0 ? '+' : '') + fmt(x.expected_late_change, 1)}])}
        <p class="muted sm">Negative = the optimized plan is better (cheaper / faster / fewer late orders).</p></div>
        <div class="panel"><h2>Unassigned: ${r.unassigned.length}</h2><p class="sm">${why}</p>${r.unassigned.length ? table(un, [{label: 'Order', key: 'order'}, {label: 'Code', key: 'code'}, {label: 'Reason', key: 'reason'}]) : ''}${r.unassigned.length > 15 ? `<p class="muted sm">… and ${r.unassigned.length - 15} more (full list in the API response)</p>` : ''}</div>`;
    });
  },

  async whatif() {
    $('#view').innerHTML = `<div class="panel"><h2>${t('whatif')}</h2><div class="row"><div class="field"><label>Cost ←→ Speed: <b id="wl">50</b>% cost</label><input id="slider" type="range" min="0" max="100" value="50"></div><button class="primary" id="wgo">${t('run')}</button></div></div><div id="wres"></div>`;
    const go = safe(async () => {
      const r = await api('/api/simulate/what-if', {json: {limit: 300}}), w = +$('#slider').value / 100, pt = r.sweep.reduce((a, b) => Math.abs(b.w_cost - w) < Math.abs(a.w_cost - w) ? b : a);
      const mx = Math.max(...r.sweep.map(s => s.total_cost)), mn = Math.min(...r.sweep.map(s => s.total_cost));
      $('#wres').innerHTML = `<div class="grid g3"><div class="card"><div class="muted">Total cost</div><div class="metric">${brl(pt.total_cost)}</div></div><div class="card"><div class="muted">Avg ETA P50</div><div class="metric">${fmt(pt.avg_eta_p50_days, 1)} d</div></div><div class="card"><div class="muted">Expected late orders</div><div class="metric">${pt.expected_late_orders}</div></div></div>
        <div class="panel">${table(r.sweep.map(s => ({...s, _best: s === pt})), [{label: 'w cost', key: 'w_cost'}, {label: 'w speed', key: 'w_speed'}, {label: 'Total', html: x => brl(x.total_cost)}, {label: 'ETA P50', html: x => fmt(x.avg_eta_p50_days, 1)}, {label: 'Exp. late', key: 'expected_late_orders'}, {label: '', html: x => `<div class="bar"><i style="width:${mx === mn ? 50 : (x.total_cost - mn) / (mx - mn) * 100}%"></i></div>`}])}<p class="muted sm">${r.orders_considered} Pending shipments</p></div>`;
    });
    $('#slider').oninput = e => { $('#wl').textContent = e.target.value; }; $('#slider').onchange = go; $('#wgo').onclick = go; go();
  },

  async carriers() {
    const [cs, hs] = await Promise.all([api('/api/carriers'), api('/api/carriers/health')]); const adm = me.role === 'admin', H = Object.fromEntries(hs.map(h => [h.carrier_code, h]));
    $('#view').innerHTML = `<div class="notice">${t('notice_sim')}</div><div class="panel">${table(cs, [{label: t('carrier'), html: r => `<b>${esc(r.name)}</b><div class="muted sm">${esc(r.service)}</div>`}, {label: t('coverage'), html: r => r.coverage_states ? esc(r.coverage_states.join(' ')) : 'All Brazil'},
      {label: 'Price×', key: 'price_mult'}, {label: 'Speed×', key: 'speed_mult'}, {label: 'Max kg', key: 'max_weight_kg'}, {label: t('capacity'), html: r => `${r.load_today} / ${r.daily_capacity}`},
      {label: t('health'), html: r => H[r.code] && H[r.code].ok ? '<span class="pill ok">OK</span>' : '<span class="pill bad">DOWN</span>'}, {label: 'Type', html: r => esc(r.kind)},
      {label: '', html: r => adm ? (H[r.code] && H[r.code].ok ? `<button class="ghost sm" data-out="${r.code}">${t('sim_outage')}</button>` : `<button class="ghost sm" data-rec="${r.code}">${t('recover')}</button>`) : ''}])}</div>`;
    document.querySelectorAll('[data-out]').forEach(b => b.onclick = safe(async () => { await api(`/api/carriers/${b.dataset.out}/simulate-outage?down=true`, {method: 'POST'}); show('carriers'); }));
    document.querySelectorAll('[data-rec]').forEach(b => b.onclick = safe(async () => { await api(`/api/carriers/${b.dataset.rec}/simulate-outage?down=false`, {method: 'POST'}); show('carriers'); }));
  },

  async analytics() {
    const [a, k] = await Promise.all([api('/api/analytics'), api('/api/kpis')]); const h = a.historical;
    $('#view').innerHTML = `<div class="grid g4"><div class="card"><div class="muted">Historical SLA breach rate</div><div class="metric">${h.sla_breach_rate == null ? '—' : fmt(h.sla_breach_rate * 100, 1) + '%'}</div><div class="muted sm">${fmt(h.sla_breaches, 0)} / ${fmt(h.delivered_with_deadline, 0)}</div></div>
      <div class="card"><div class="muted">${t('avg_hist')}</div><div class="metric">${brl(k.avg_historical_freight)}</div></div><div class="card"><div class="muted">Avg transit (days)</div><div class="metric">${fmt(k.avg_historical_transit_days, 1)}</div></div><div class="card"><div class="muted">${t('avg_price')}</div><div class="metric">${brl(k.avg_booked_price)}</div></div></div>
      <div class="panel"><h2>${t('carriers')} — booked shipments</h2>${table(a.carriers, [{label: t('carrier'), key: 'carrier_code'}, {label: t('shipments'), key: 'n'}, {label: 'Avg price', html: r => brl(r.avg_price)}, {label: 'Avg ETA', html: r => fmt(r.avg_eta, 1)}, {label: 'Avg late risk', html: r => r.avg_late_risk == null ? '—' : fmt(r.avg_late_risk * 100, 1) + '%'}, {label: 'On-time', html: r => r.on_time_rate == null ? '—' : fmt(r.on_time_rate * 100, 1) + '%'}, {label: 'SLA breaches', key: 'breaches'}])}</div>
      <div class="panel"><h2>Average cost &amp; transit per route (historical)</h2>${table(a.routes, [{label: 'Route', html: r => `${esc(r.o)} → ${esc(r.d)}`}, {label: 'Shipments', html: r => fmt(r.n, 0)}, {label: 'Avg cost', html: r => brl(r.avg_cost)}, {label: 'Avg transit d', html: r => fmt(r.avg_transit_days, 1)}])}</div>`;
  },

  async backtest() {
    const b = await api('/api/backtest'), P = b.policies, G = b.gains, N = b.nearest_source, A = b.model_accuracy;
    const names = {random: 'Random carrier', status_quo_single_carrier: 'Status quo (single carrier)', cheapest: 'Always cheapest', fastest: 'Always fastest', system_cost_with_deadline: 'SYSTEM: cheapest that meets deadline', system_balanced: 'SYSTEM: balanced'};
    $('#view').innerHTML = `<div class="notice">Hold-out backtest: models calibrated on orders before ${esc(b.train_until)}, evaluated on ${fmt(b.holdout_orders_evaluated, 0)} unseen later orders. Carriers are simulated → savings are valid inside the simulated carrier universe.</div>
      <div class="grid g3"><div class="card"><div class="muted">Price model R² (hold-out)</div><div class="metric">${fmt(A.price.r2_holdout, 2)}</div><div class="muted sm">MAE R$ ${fmt(A.price.mae_holdout_brl)}</div></div>
      <div class="card"><div class="muted">ETA P90 coverage (target 90%)</div><div class="metric">${fmt(A.eta.p90_coverage * 100, 1)}%</div><div class="muted sm">P50 coverage ${fmt(A.eta.p50_coverage * 100, 1)}%</div></div>
      <div class="card"><div class="muted">Actual history (same orders)</div><div class="metric">R$ ${fmt(b.actual_history_same_orders.avg_freight_paid_brl)}</div><div class="muted sm">late ${fmt(b.actual_history_same_orders.late_rate * 100, 1)}%</div></div></div>
      <div class="panel"><h2>Policies on the same orders</h2>${table(Object.entries(P).map(([k, v]) => ({name: names[k] || k, ...v, _best: k.startsWith('system')})), [{label: 'Policy', key: 'name'}, {label: 'Total cost', html: r => brl(r.total_cost_brl)}, {label: 'Avg cost', html: r => brl(r.avg_cost_brl)}, {label: 'ETA P50', html: r => fmt(r.avg_eta_p50_days, 1) + ' d'}, {label: 'Expected late', html: r => fmt(r.expected_late_rate * 100, 1) + '%'}])}
      <p class="sm">vs status quo — <b>cost+deadline</b>: ${fmt(G.system_cost_with_deadline_vs_status_quo.cost_saving_pct, 1)}% cost, ${fmt(G.system_cost_with_deadline_vs_status_quo.late_rate_change_pp, 1)} pp late rate · <b>balanced</b>: ${fmt(G.system_balanced_vs_status_quo.cost_saving_pct, 1)}% cost, ${fmt(G.system_balanced_vs_status_quo.late_rate_change_pp, 1)} pp late rate.</p></div>
      <div class="panel"><h2>Nearest-source selection (${fmt(N.orders_evaluated, 0)} orders)</h2><div class="kv"><span>Different seller chosen</span><span>${N.pct_orders_where_system_picks_different_seller}%</span><span>Avg distance</span><span>${N.avg_distance_km.actual_seller} → ${N.avg_distance_km.system_pick} km</span><span>Avg price</span><span>R$ ${N.avg_price_brl.actual_seller} → R$ ${N.avg_price_brl.system_pick}</span><span>Avg ETA P50</span><span>${N.avg_eta_p50_days.actual_seller} → ${N.avg_eta_p50_days.system_pick} d</span></div><p class="muted sm">${esc(N.assumption)}</p></div>
      <div class="panel"><h2>Assumptions</h2><ul>${b.assumptions.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  },

  async import() {
    $('#view').innerHTML = `<div class="panel"><h2>${t('import')}</h2><p class="muted">Joins orders × items × products × sellers × customers × geolocation, splits multi-seller orders into sub-shipments, maps statuses, bulk-inserts. Max upload ${'60'} MB — for the full archive use <i>Server folder</i> or <code>scripts/import_olist.py</code>.</p>
      <div class="row"><button class="primary" id="impSrv">Import from server folder (OLIST_DATA_DIR)</button><div class="field"><label>Olist archive (.zip)</label><input type="file" id="zipf" accept=".zip"></div><div class="field" style="max-width:120px"><label>Limit orders</label><input id="lim" type="number" min="1" placeholder="all"></div><button class="ghost" id="impZip">Upload &amp; import</button></div><div id="imsg" style="margin-top:14px"></div></div>`;
    const poll = async id => { for (;;) { const j = await api('/api/import/jobs/' + id); $('#imsg').innerHTML = `<div class="bar"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></div><div class="sm">${esc(j.status)} ${j.error ? esc(j.error) : ''}</div>${j.result ? `<pre class="sm">${esc(JSON.stringify(j.result, null, 2))}</pre>` : ''}`; if (['done', 'failed'].includes(j.status)) break; await new Promise(r => setTimeout(r, 1500)); } };
    const lim = () => $('#lim').value ? '?limit=' + $('#lim').value : '';
    $('#impSrv').onclick = safe(async () => poll((await api('/api/import/olist-server' + lim(), {method: 'POST'})).job_id));
    $('#impZip').onclick = safe(async () => { const f = $('#zipf').files[0]; if (!f) return toast('Choose a .zip'); const fd = new FormData(); fd.append('file', f); poll((await api('/api/import/olist-archive' + lim(), {method: 'POST', body: fd})).job_id); });
  }
};

// ---------- shipment detail drawer (assign / lifecycle / tracking / reroute)
async function openShipment(id, refresh) {
  const s = await api('/api/shipments/' + id), box = $('#detail');
  let html = `<div class="panel"><h2>${esc(s.order_id)} ${stPill(s.status)}</h2><div class="kv"><span>${t('origin')}</span><span>${esc(s.origin)}</span><span>${t('destination')}</span><span>${esc(s.destination)}</span><span>${t('weight')}</span><span>${fmt(s.weight_kg, 2)}</span><span>Deadline</span><span>${esc(s.deadline || '—')}</span><span>${t('carrier')}</span><span>${esc(s.carrier_code || '—')} ${s.tracking_code ? '· ' + esc(s.tracking_code) : ''}</span><span>${t('price')}</span><span>${brl(s.price)}${s.eta_p90 ? ' · ETA P90 ' + s.eta_p90 + ' d' : ''}</span></div>`;
  if (s.status === 'Pending') {
    const r = await api(`/api/shipments/${id}/quotes`, {json: {}});
    html += `<h2 style="margin-top:14px">${t('compare')}</h2>${quoteTable(r, true)}${excludedBlock(r)}`;
  } else {
    const nxt = {Booked: ['In Transit', 'Canceled'], 'In Transit': ['Delivered']}[s.status] || [];
    html += `<div class="row" style="margin-top:12px">${nxt.map(n => `<button class="ghost" data-mv="${n}">→ ${n}</button>`).join('')}${s.status === 'Booked' ? `<button class="ghost" id="rr">${t('reroute')}?</button>` : ''}</div><div id="rrbox"></div>`;
    const tr = await api(`/api/shipments/${id}/tracking`); html += `<h2 style="margin-top:14px">${t('tracking')}</h2>${table(tr.events.length ? tr.events : tr.projected, [{label: 'Event', key: 'event'}, {label: 'When', key: 'ts'}, {label: '', html: r => esc(r.description || '') + (r.simulated ? ' (projected)' : '')}])}`;
  }
  box.innerHTML = html + '</div>'; box.scrollIntoView({behavior: 'smooth'});
  box.querySelectorAll('[data-assign]').forEach(b => b.onclick = safe(async () => { await api(`/api/shipments/${id}/assign`, {json: {carrier_code: b.dataset.assign}}); toast('Booked'); refresh(); }));
  box.querySelectorAll('[data-mv]').forEach(b => b.onclick = safe(async () => { await api(`/api/shipments/${id}`, {method: 'PATCH', json: {status: b.dataset.mv}}); refresh(); }));
  const rr = $('#rr'); if (rr) rr.onclick = safe(async () => {
    const r = await api(`/api/shipments/${id}/reroute-suggestion`);
    $('#rrbox').innerHTML = `<p class="sm">${r.reroute_recommended ? '<span class="pill bad">Re-route recommended</span> ' + esc(r.reasons.join('; ')) : '<span class="pill ok">Carrier healthy</span>'}</p>` + (r.alternatives.length ? table(r.alternatives, [{label: t('carrier'), key: 'carrier'}, {label: t('price'), html: x => brl(x.price)}, {label: t('eta90'), html: x => fmt(x.eta_p90_days, 1)}, {label: '', html: x => `<button class="ghost sm" data-rr="${x.carrier_code}">${t('reroute')}</button>`}]) : '');
    $('#rrbox').querySelectorAll('[data-rr]').forEach(b => b.onclick = safe(async () => { await api(`/api/shipments/${id}/reroute`, {json: {carrier_code: b.dataset.rr}}); toast('Re-routed'); refresh(); }));
  });
}

applyLang();
if (token) boot(); else $('#login').classList.remove('hidden');
