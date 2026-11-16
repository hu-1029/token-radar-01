// Token Radar, radar-2 dashboard. Static page, no framework, no network: every byte it
// shows comes from window.RADAR, written beside this page by main.ts. It renders the ranked
// board of pre-token protocols, a detail drawer per protocol with the model's arithmetic and
// its farm plan, a live-token table set aside from the ranking, and the calibration table
// behind the category multiples. Selecting a row, filtering or searching updates the URL hash
// so a view can be linked and screenshotted.
(() => {
  'use strict';

  const DATA = window.RADAR;
  const app = document.getElementById('board');
  if (!DATA || !app) return;

  const state = {
    q: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };
  const WATCHLIST = new Set(DATA.watchlist || []);

  // ---- formatting ---------------------------------------------------------
  const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  };
  const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
  const age = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };
  const chainLabel = (row) => (row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain');

  // ---- the model, recomputed in the page ----------------------------------
  // Same arithmetic as lib/model.ts, so the page can check the number board.json carries.
  // Multiples are calibrated per category from the traded protocols in this snapshot; a
  // category with fewer than 3 traded comparables uses the global multiple.
  const multipleFor = (category) => {
    const table = DATA.category_multiples || [];
    const hit = table.find((x) => x.category === (category || 'Uncategorized'));
    return hit ? hit.multiple : DATA.global_multiple;
  };
  const impliedOf = (row) => {
    const m = DATA.model;
    const growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d ?? 0));
    const growthMult = 1 + (growth / 100) * m.growth_weight;
    const ageDays = row.age_days ?? m.unknown_age_days;
    const maturity = m.maturity_floor + m.maturity_range * Math.sqrt(Math.min(Math.max(ageDays, 0), m.maturity_days) / m.maturity_days);
    const chainMult = 1 + m.chain_bonus * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_bonus_max);
    return Math.max(1, Math.round(row.tvl_usd * multipleFor(row.category) * growthMult * maturity * chainMult));
  };

  // Farm plans arrive verbatim from board.json, so the page can never disagree with the
  // board about a plan. They were derived in main.ts from each protocol's category, main
  // chain, TVL and age; no protocol name is special-cased.
  const farmSteps = (row) => row.farm_steps || [];

  // ---- tiny DOM helper -----------------------------------------------------
  // h('div', { class: 'x', text: 'hi' }, child1, child2) — attrs starting with "on"
  // are event listeners, "text" sets textContent, everything else is an attribute.
  const h = (tag, attrs, ...kids) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined) continue;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  };

  // ---- URL hash: shareable views -------------------------------------------
  const readHash = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlistOnly = true;
  };
  const writeHash = () => {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    const next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  };

  // ---- filtering and sorting -------------------------------------------------
  const visibleRows = () => {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.watchlistOnly && !WATCHLIST.has(r.slug)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().includes(q);
    });
  };
  const sortValue = (r, key) => {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d ?? -Infinity;
    if (key === 'age') return r.age_days ?? Infinity;
    return r.implied_value_usd;
  };
  const sortedRows = (list) => list.slice().sort((a, b) => {
    const av = sortValue(a, state.sort);
    const bv = sortValue(b, state.sort);
    if (av < bv) return -state.dir;
    if (av > bv) return state.dir;
    return a.slug < b.slug ? -1 : 1;
  });

  // ---- page sections ---------------------------------------------------------
  const pageHeader = () => h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
    h('div', { class: 'top-meta' },
      h('span', { text: 'Snapshot ' + DATA.as_of }),
      h('span', { text: 'DefiLlama protocol index' }),
      h('span', { text: DATA.model_version + ' model' })));

  const lede = () => h('section', { class: 'lede' },
    h('div', null,
      h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' clean pre-token protocols below that floor, every one of them, and drops bridges, staking receipts and wrapped assets even when they sit below the floor. Implied value is a model, not a promise.' })),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))));

  const optionList = (values, current, allLabel) => [
    h('option', { value: 'all', text: allLabel }),
    ...values.map((v) => h('option', { value: v, text: v, selected: v === current ? 'selected' : null })),
  ];
  const controls = () => {
    const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
    const chains = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
    const categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' }, ...optionList(categories, state.category, 'All categories'));
    categorySelect.addEventListener('change', () => { state.category = categorySelect.value; writeHash(); render(); });
    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, ...optionList(chains, state.chain, 'All chains'));
    chainSelect.addEventListener('change', () => { state.chain = chainSelect.value; writeHash(); render(); });
    const wlBtn = h('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: () => { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    const tabBtn = (tab, label) => h('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: () => { state.tab = tab; render(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Watchlist' }), wlBtn),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'))),
      h('span', { class: 'count', text: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  };

  const sortHeader = (key, label) => h('th', { scope: 'col' },
    h('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label,
      state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));

  const boardTable = () => {
    const list = sortedRows(visibleRows());
    if (!list.length) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })));
    }
    const max = list[0].implied_value_usd || 1;
    const tbody = h('tbody');
    for (const r of list) {
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) + (WATCHLIST.has(r.slug) ? ' · watchlist' : '') }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: pct(r.change_7d) }),
        h('td', { class: 'num', text: age(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) }))),
        h('td', null, h('span', { class: 'status', text: 'no token' }))));
    }
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
        h('thead', null, h('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'),
          h('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  };

  const liveTable = () => {
    const tbody = h('tbody');
    for (const r of DATA.live) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))));
    }
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  };

  const modelPanel = () => {
    const m = DATA.model;
    const present = new Set(DATA.rows.map((r) => r.category || 'Uncategorized'));
    const multRows = (DATA.category_multiples || []).filter((x) => present.has(x.category))
      .sort((a, b) => b.multiple - a.multiple);
    const tbody = h('tbody');
    for (const x of multRows) {
      tbody.appendChild(h('tr', null,
        h('td', { text: x.category }),
        h('td', { class: 'num', text: String(x.samples) }),
        h('td', { class: 'num', text: x.median_ratio === null ? 'n/a' : String(x.median_ratio) }),
        h('td', { class: 'num', text: String(x.multiple) }),
        h('td', { text: x.source === 'category' ? 'category median' : 'global median' })));
    }
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula', text: 'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x sqrt(min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ')) x (1 + ' + m.chain_bonus + ' x min(chains - 1, ' + m.chain_bonus_max + ')) )' }),
      h('p', { class: 'sub', text: 'The category multiple is 1 / median TVL per market-cap of that category\u2019s protocols that already trade, clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '. A category with fewer than ' + m.category_min_samples + ' traded comparables uses the global multiple ' + DATA.global_multiple + ' instead, so one outlier cannot set the price. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every clean pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' }),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Category multiples, calibrated from this snapshot\u2019s traded protocols.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Category' }), h('th', { scope: 'col', text: 'Traded comps' }), h('th', { scope: 'col', text: 'Median TVL / mcap' }), h('th', { scope: 'col', text: 'Multiple' }), h('th', { scope: 'col', text: 'Source' }))),
          tbody)));
  };

  // ---- detail drawer ---------------------------------------------------------
  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  const equationRow = (label, value) => h('div', null, h('span', { text: label }), h('b', { class: 'num', text: value }));
  const openDetail = (slug) => {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    const recomputed = impliedOf(row);
    const matches = Math.abs(recomputed - row.implied_value_usd) / row.implied_value_usd < 0.005;
    dialog.append(
      h('div', { class: 'detail-head' },
        h('div', null,
          h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
          h('h2', { id: 'detail-title', text: row.name }),
          h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })),
      h('section', { class: 'detail-section' },
        h('h3', { text: 'Implied value' }),
        h('div', { class: 'equation' },
          equationRow('TVL', money(row.tvl_usd)),
          equationRow('Seven-day growth', pct(row.change_7d)),
          equationRow('Age with no token', age(row.age_days)),
          equationRow('Category multiple', String(row.category_multiple)),
          equationRow('Growth multiplier', String(row.growth_multiplier)),
          equationRow('Maturity multiplier', String(row.maturity_multiplier)),
          equationRow('Chain multiplier', String(row.chain_multiplier)),
          equationRow('Implied value', money(row.implied_value_usd))),
        h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (matches ? ', the same number board.json carries, within rounding.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })),
      h('section', { class: 'detail-section' },
        h('h3', { text: 'Farm plan' }),
        h('ol', { class: 'steps' }, farmSteps(row).map((s) => {
          const at = s.indexOf(' Cost: ');
          const action = at >= 0 ? s.slice(0, at) : s;
          const tail = at >= 0 ? s.slice(at + 1) : '';
          return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
        }))));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  // ---- render ------------------------------------------------------------------
  const render = () => {
    app.textContent = '';
    const shell = h('div', { class: 'shell' },
      pageHeader(), lede(), controls(),
      state.tab === 'pre-token' ? boardTable() : liveTable(),
      ...(state.tab === 'pre-token' ? [modelPanel()] : []));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  };

  readHash();
  render();
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
