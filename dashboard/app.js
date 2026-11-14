// Token Radar — the dashboard. Renders window.RADAR (written by main.ts
// into data.js beside this page): the ranked board, the live-token table,
// the model page and one detail drawer per protocol.
//
// State lives in the hash so a view can be linked to: #/p/<slug> opens a
// protocol's detail, #/?q=&cat=&chain=&wl=1&sort= applies a filter. The
// page works with no network: no fetch, no remote asset, no link out.

(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !Array.isArray(D.rows)) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="7">No radar data loaded.</td></tr>';
    return;
  }

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), countEl = $('count'), emptyEl = $('empty');
  var qEl = $('q'), catEl = $('cat'), chainEl = $('chain'), sortEl = $('sort'), wlEl = $('wl');

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
    return s;
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- header facts ---- */
  $('modelTag').textContent = D.model_version;
  $('modelVer').textContent = D.model_version;
  $('footAsOf').textContent = 'Snapshot ' + D.as_of + ' · floor ' + money(D.floor_usd);
  $('srcLine').textContent = D.source + ' · as of ' + D.as_of;
  var liveCount = D.rows.length + D.live_size;
  $('facts').innerHTML =
    '<div><dt>Watchlist</dt><dd>' + D.watchlist_size + ' protocols</dd></div>' +
    '<div><dt>Board</dt><dd>' + D.board_size + ' ranked</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + D.early_size + ' below the floor</dd></div>' +
    '<div><dt>Global multiple</dt><dd>' + D.global_multiple.toFixed(3) + '× mcap/TVL</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + D.as_of + '</dd></div>';

  /* ---- filter selects ---- */
  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { catEl.insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });
  chains.forEach(function (c) { chainEl.insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });

  var state = { q: '', cat: '', chain: '', wl: false, sort: 'implied' };
  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = D.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d);
      if (key === 'age') return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days);
      if (key === 'name') return a.name < b.name ? -1 : 1;
      if (key === 'rank') return a.rank - b.rank;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return out;
  }

  function renderBoard() {
    var list = filtered();
    countEl.textContent = list.length + ' of ' + D.rows.length + ' protocols';
    emptyEl.hidden = list.length > 0;
    var html = list.map(function (r) {
      var g = r.change_7d;
      var gCls = g === null ? '' : (g >= 0 ? 'pos' : 'neg');
      var bar = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="false" tabindex="0">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name"><b>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</b>' +
        '<span class="sub">' + esc(r.slug) + ' · ' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</span></span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + gCls + '">' + pct(g) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td><span class="implied"><span class="num">' + money(r.implied_value_usd) + '</span>' +
        '<span class="bar" aria-hidden="true"><i style="width:' + bar + '%"></i></span></span></td></tr>';
    }).join('');
    rowsEl.innerHTML = html;
  }

  /* ---- detail drawer ---- */
  var detailEl = $('detail');
  var selectedSlug = null;
  function bySlug(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }
  function openDetail(slug) {
    var r = bySlug(slug);
    if (!r) return;
    selectedSlug = slug;
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.setAttribute('data-selected', tr.getAttribute('data-slug') === slug ? 'true' : 'false');
    });
    $('dName').textContent = r.name;
    $('dSub').textContent = r.slug + ' · ' + (r.category || 'no category') + ' · ' + (r.chains.join(', ') || 'no chain listed') +
      (r.on_watchlist ? ' · on the watchlist' : ' · below the watchlist floor');
    $('dImplied').textContent = moneyFull(r.implied_value_usd);
    var catNote = r.cat_fallback
      ? 'global median — too few live comps in ' + (r.category || 'this category')
      : 'median of ' + r.cat_comps + ' live comps';
    $('dEquation').innerHTML =
      '<div><span>TVL</span><b>' + moneyFull(r.tvl_usd) + '</b></div>' +
      '<div><span>Category multiple · ' + esc(catNote) + '</span><b>× ' + r.cat_multiple.toFixed(3) + '</b></div>' +
      '<div><span>Growth mult · 7d ' + pct(r.growth_pct) + '</span><b>× ' + r.growth_mult.toFixed(3) + '</b></div>' +
      '<div><span>Age mult · ' + ageText(r.age_days) + '</span><b>× ' + r.age_mult.toFixed(3) + '</b></div>' +
      '<div><span>Chain mult · ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span><b>× ' + r.chain_mult.toFixed(3) + '</b></div>' +
      '<div class="total"><span>Implied value</span><b>' + moneyFull(r.implied_value_usd) + '</b></div>';
    $('dSteps').innerHTML = r.farm_steps.map(function (s) {
      var m = s.match(/^(.*?)\s*Cost:\s*(.*?)\s*Time:\s*(.*?)\.?$/);
      if (!m) return '<li>' + esc(s) + '</li>';
      return '<li>' + esc(m[1]) + '<span class="cost">Cost: ' + esc(m[2]) + ' · Time: ' + esc(m[3]) + '</span></li>';
    }).join('');
    $('dRecord').innerHTML =
      '<div><dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
      '<div><dt>Tracked since</dt><dd>' + esc(r.listed_at || 'not reported') + '</dd></div>' +
      '<div><dt>Token recorded</dt><dd>none — records no token</dd></div>' +
      '<div><dt>Board rank</dt><dd>#' + r.rank + ' of ' + D.rows.length + '</dd></div>';
    detailEl.hidden = false;
  }
  function closeDetail() {
    hideDetail();
    if (location.hash.indexOf('#/p/') === 0) history.replaceState(null, '', '#/');
  }
  function hideDetail() {
    detailEl.hidden = true;
    selectedSlug = null;
    document.querySelectorAll('#rows tr').forEach(function (tr) { tr.setAttribute('data-selected', 'false'); });
  }
  $('closeDetail').addEventListener('click', closeDetail);
  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  rowsEl.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  /* ---- live table + multiples ---- */
  $('liveRows').innerHTML = D.live.map(function (p) {
    var ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    return '<tr><td><span class="name"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.slug) + ' · ' + esc(p.chains.slice(0, 3).join(', ') || '—') + '</span></span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + ratio + '</td>' +
      '<td class="num ' + (p.change_7d === null ? '' : (p.change_7d >= 0 ? 'pos' : 'neg')) + '">' + pct(p.change_7d) + '</td></tr>';
  }).join('');
  var mults = Object.keys(D.category_multiples).sort(function (a, b) { return D.category_multiples[b] - D.category_multiples[a]; });
  $('multRows').innerHTML = mults.map(function (c) {
    return '<tr><td>' + esc(c) + '</td><td class="num">' + D.category_multiples[c].toFixed(3) + '×</td></tr>';
  }).join('') + '<tr><td>Global median (fallback)</td><td class="num">' + D.global_multiple.toFixed(3) + '×</td></tr>';

  /* ---- tabs ---- */
  var views = { board: $('view-board'), live: $('view-live'), model: $('view-model') };
  function showView(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === name ? 'true' : 'false');
    });
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
  });

  /* ---- filters + hash routing ---- */
  function readHash() {
    var h = location.hash || '';
    if (h.indexOf('#/p/') === 0) { renderBoard(); openDetail(decodeURIComponent(h.slice(4))); return; }
    hideDetail();
    if (h.indexOf('#/?') === 0) {
      var params = new URLSearchParams(h.slice(3));
      state.q = params.get('q') || '';
      state.cat = params.get('cat') || '';
      state.chain = params.get('chain') || '';
      state.wl = params.get('wl') === '1';
      state.sort = params.get('sort') || 'implied';
    }
    qEl.value = state.q; catEl.value = state.cat; chainEl.value = state.chain;
    wlEl.checked = state.wl; sortEl.value = state.sort;
    renderBoard();
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat) params.set('cat', state.cat);
    if (state.chain) params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    var s = params.toString();
    history.replaceState(null, '', s ? '#/?' + s : '#/');
  }
  qEl.addEventListener('input', function () { state.q = qEl.value; writeHash(); renderBoard(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; writeHash(); renderBoard(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; writeHash(); renderBoard(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; writeHash(); renderBoard(); });
  wlEl.addEventListener('change', function () { state.wl = wlEl.checked; writeHash(); renderBoard(); });
  document.querySelectorAll('th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-sort');
      state.sort = k === 'rank' ? 'rank' : (k === 'name' ? 'name' : state.sort === k ? 'implied' : k);
      if (k === 'tvl' || k === 'growth' || k === 'age') state.sort = k;
      sortEl.value = ['implied', 'tvl', 'growth', 'age'].indexOf(state.sort) >= 0 ? state.sort : 'implied';
      writeHash(); renderBoard();
    });
  });
  $('clearFilters').addEventListener('click', function () {
    state = { q: '', cat: '', chain: '', wl: false, sort: 'implied' };
    qEl.value = ''; catEl.value = ''; chainEl.value = ''; wlEl.checked = false; sortEl.value = 'implied';
    writeHash(); renderBoard();
  });
  window.addEventListener('hashchange', readHash);

  readHash();
})();
