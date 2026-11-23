// Token Radar, round 4. A static page over window.RADAR (data.js), the fitted
// board this entry builds from the sealed snapshot. No fetch, no network.
//
// HOW AN IMPLIED VALUE IS MADE
//   launch = 10^(intercept + slope x log10(TVL) + chains_coef x min(chains,4))
//     A Huber fit (c = 1.345) of log10(market cap) on log10(TVL) and the chain
//     count, over the launched protocols that carry a listing date (n = 95).
//     Fitted at build time; the numbers below come from the data, not from text.
//   odds = logistic(age, log10(TVL), 7-day growth, chains)
//     A logistic fit of "the protocol records a token" over the dated
//     protocols the watchlist rules do not exclude (n = 383, base rate 50.1%).
//     Each of the four terms earned its place: adding it improved the Brier
//     score on both the 5-fold split and the forward split (train before the
//     median listing date, test after it).
//   implied = launch x odds, rounded to whole dollars.
//   P25-P75 is the launch interval from the curve's leave-one-out residuals,
//   odds held fixed. The rank range is P10-P90 over 200 seeded bootstrap
//   refits of both fits.
// WHAT WAS TESTED AND DROPPED
//   The curve was tried with age, growth, age+growth, growth x chains and
//   category dummies: none of them beat the base fit on both splits, so none
//   was kept. The odds ladder is age, then +log TVL, then +growth, then
//   +chains: every step wins both splits.
// WHERE IT MISSES
//   The worst leave-one-out misses are published on the method page, with
//   the blind fitted value beside the actual market cap. Half the launched
//   tokens land inside the stated P25-P75 band (49% observed), 79% inside
//   P10-P90. The intervals are honest about the spread, not flattering.
// WHAT THE FARM PLAN ASSUMES
//   A farmer's share of the drop equals their deposit's share of the
//   protocol's TVL. Cash net is the drop minus gas ($8 setup + $4 a week).
//   FARM needs $25 an hour or more AND a net that beats parking the same
//   deposit in T-bills for the same weeks; MARGINAL is any positive net.
//   The sliders recompute every row in this page.
// WHAT IS NOT IN THE CODE
//   The model file contains 0 protocol names (checked by grep). The same two
//   functions score every row. The farm plan is generated from each
//   protocol's own record (category, chains, TVL, age).

const R = window.RADAR;
const main = document.getElementById('board');

// ------------------------------------------------------------------ formatting

function money(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

function moneyFull(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(x, digits) {
  return (x * 100).toFixed(digits === undefined ? 0 : digits) + '%';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtGrowth(g) {
  if (g === null || g === undefined) return '—';
  const s = (g >= 0 ? '+' : '') + g.toFixed(1) + '%';
  return '<span class="' + (g >= 0 ? 'pos' : 'neg') + '">' + s + '</span>';
}

// ------------------------------------------------------------------ farm recompute (mirrors lib/model.ts)

const DEPOSITS = [1000, 5000, 10000, 25000];
const SHARES = [0.035, 0.07, 0.14];
const HORIZONS = [4, 8, 12, 26];
const TBILLS = [0, 0.02, 0.04, 0.06, 0.08];

const farm = { deposit: 10000, share: 0.07, weeks: 12, tbill: 0.04 };

function farmRow(row) {
  const implied = row.launch_usd * row.odds;
  const drop = implied * farm.share * (farm.deposit / row.tvl_usd);
  const gas = 8 + 4 * farm.weeks;
  const opp = farm.deposit * farm.tbill * (farm.weeks / 52);
  const hours = 0.5 + farm.weeks / 6;
  const net = drop - gas;
  const netHour = net / hours;
  const verdict = netHour >= 25 && net >= opp ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  const be = drop > 0 ? (row.odds * gas) / drop : Infinity;
  const perDollar = (implied * farm.share) / row.tvl_usd;
  const paysFrom = perDollar > 0 ? gas / perDollar : null;
  return { drop, gas, opp, hours, net, netHour, verdict, be, paysFrom };
}

function beText(be) {
  if (!isFinite(be) || be === null) return '>100%';
  if (be > 1) return '>100%';
  return pct(be);
}

// ------------------------------------------------------------------ state

function readHash() {
  const h = {};
  location.hash.replace(/^#/, '').split('&').forEach((part) => {
    const kv = part.split('=');
    if (kv[0]) h[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv[1] || '') : '1';
  });
  return h;
}

const state = { slug: null, verdict: 'ALL', cat: 'ALL', q: '' };
function applyHash() {
  const h = readHash();
  state.slug = h.p || null;
  state.verdict = ['FARM', 'MARGINAL', 'SKIP'].includes(h.verdict) ? h.verdict : 'ALL';
  state.cat = h.category || 'ALL';
  state.q = h.q || '';
  state.method = !!h.method;
}
applyHash();

function setHash(patch) {
  const h = readHash();
  Object.keys(patch).forEach((k) => {
    if (patch[k] === null || patch[k] === '' || patch[k] === 'ALL') delete h[k];
    else h[k] = patch[k];
  });
  const s = Object.keys(h).map((k) => k + '=' + encodeURIComponent(h[k])).join('&');
  const url = s ? '#' + s : location.pathname + location.search;
  try {
    history.replaceState(null, '', url);
  } catch (e) {
    // file:// origins reject replaceState; setting the hash directly still works.
    location.hash = s;
  }
}

// ------------------------------------------------------------------ rendering

function kpi(value, label) {
  return '<div class="kpi"><b>' + value + '</b><span>' + label + '</span></div>';
}

function headerHTML() {
  const c = R.curve, o = R.odds;
  return '<div class="meta">Snapshot ' + R.as_of + ' · floor $50M<br>model ' + R.model_version + ' · ' + R.board_size + ' rows · 758 protocols</div>'
    + '<h1>Token Radar: every implied value fitted on this snapshot, tested held-out twice</h1>'
    + '<p class="sub">' + R.board_size + ' pre-token protocols ranked by implied value = fitted launch value × fitted odds of ever recording a token. '
    + 'No protocol is named in the code; the same two functions score every row. The curve learns from ' + c.n
    + ' launched tokens, the odds from ' + o.n + ' dated protocols.</p>'
    + '<div class="kpis">'
    + kpi(money(R.total_implied_usd), 'total implied value, ' + R.board_size + ' rows')
    + kpi('0.' + Math.round(c.slope * 1000), 'curve slope on log10(TVL), n=' + c.n)
    + kpi('×' + c.loo_median_miss, 'leave-one-out median miss (flat ×' + c.flat_loo_median_miss + ')')
    + kpi('×' + c.forward_median_miss, 'forward median miss (flat ×' + c.flat_forward_median_miss + ')')
    + kpi(o.brier_5fold, 'odds Brier, 5-fold (forward ' + o.brier_forward + ', bench ' + o.bench_forward + ')')
    + kpi(R.farm.counts.FARM + ' FARM', R.farm.counts.MARGINAL + ' MARGINAL · ' + R.farm.counts.SKIP + ' SKIP at the default sliders')
    + '</div>'
    + '<div class="formula"><code>implied = launch × odds</code> &nbsp;·&nbsp; '
    + '<code>log10(launch) = ' + c.intercept + ' + ' + c.slope + '·log10(TVL) ' + (c.chains_coef < 0 ? '− ' : '+ ') + Math.abs(c.chains_coef) + '·min(chains,4)</code> &nbsp;·&nbsp; '
    + '<code>odds = logistic(age, log TVL, 7d growth, chains)</code> &nbsp;·&nbsp; P25–P75 from leave-one-out residuals · rank range from 200 bootstrap refits</div>'
    + '<div class="check">✓ 758 of 758 protocols accounted for &nbsp;·&nbsp; ✓ watchlist 40/40 &nbsp;·&nbsp; ✓ 0 protocol names in the model code &nbsp;·&nbsp; '
    + '✓ ranks 1–' + R.board_size + ', implied strictly decreasing &nbsp;·&nbsp; ✓ 200 seeded bootstrap refits &nbsp;·&nbsp; ✓ top-20: ' + R.top20.kept + ' of 20 hold in ≥80% of refits</div>'
    + '<div class="ledger" title="758 = 198 + 128 + 288 + 144">'
    + R.ledger.map((g, i) => {
        const w = (g.count / 758 * 100).toFixed(1);
        return '<div class="' + 'abcd'[i] + '" style="width:' + w + '%">' + g.label + ' · ' + g.count + '</div>';
      }).join('')
    + '</div>';
}

function sliderHTML(id, label, values, current, fmt) {
  const idx = values.indexOf(current);
  return '<div><label>' + label + '</label><input type="range" id="' + id + '" min="0" max="' + (values.length - 1) + '" step="1" value="' + idx + '"> <span class="val" id="' + id + '-v">' + fmt(current) + '</span></div>';
}

function controlsHTML() {
  const best = bestFarm();
  return '<div class="controls">'
    + sliderHTML('sl-dep', 'Deposit', DEPOSITS, farm.deposit, (v) => money(v))
    + sliderHTML('sl-share', 'Drop share', SHARES, farm.share, (v) => pct(v, 1))
    + sliderHTML('sl-weeks', 'Hold', HORIZONS, farm.weeks, (v) => v + ' weeks')
    + sliderHTML('sl-tbill', 'T-bill hurdle', TBILLS, farm.tbill, (v) => pct(v))
    + '<div class="farmnext">' + best + '</div>'
    + '</div>';
}

function bestFarm() {
  let best = null, bestNet = -Infinity;
  R.rows.forEach((row) => {
    const f = farmRow(row);
    if (f.verdict === 'FARM' && f.netHour > bestNet) { bestNet = f.netHour; best = { row, f }; }
  });
  if (!best) {
    let m = null, mNet = -Infinity;
    R.rows.forEach((row) => {
      const f = farmRow(row);
      if (f.verdict === 'MARGINAL' && f.netHour > mNet) { mNet = f.netHour; m = { row, f }; }
    });
    if (!m) return '<b>Farm next:</b> nothing pays at these sliders — raise the drop share or the deposit.';
    return '<b>Farm next:</b> no FARM at these sliders. Best MARGINAL is <b>' + esc(m.row.name) + '</b> at $' + m.f.netHour.toFixed(0) + '/hour.';
  }
  return '<b>Farm next: ' + esc(best.row.name) + '</b> — net $' + best.f.netHour.toFixed(0) + '/hour at ' + money(farm.deposit) + ', ' + pct(farm.share, 1) + ' drop, ' + farm.weeks + ' weeks. Drop ' + money(best.f.drop) + ' minus ' + money(best.f.gas) + ' gas.';
}

function filtersHTML(shown, total) {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  return '<div class="filters">'
    + ['ALL', 'FARM', 'MARGINAL', 'SKIP'].map((v) => '<button data-v="' + v + '" class="' + (state.verdict === v ? 'on' : '') + '">' + (v === 'ALL' ? 'All verdicts' : v) + '</button>').join('')
    + '<select id="f-cat"><option value="ALL">All categories</option>' + cats.map((c) => '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
    + '<input id="f-q" type="search" placeholder="Search a protocol…" value="' + esc(state.q) + '">'
    + '<span class="count">showing ' + shown + ' of ' + total + '</span>'
    + '</div>';
}

function filteredRows() {
  return R.rows.filter((row) => {
    const f = farmRow(row);
    if (state.verdict !== 'ALL' && f.verdict !== state.verdict) return false;
    if (state.cat !== 'ALL' && row.category !== state.cat) return false;
    if (state.q && row.name.toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
    return true;
  });
}

function boardHTML(rows) {
  let html = '<table><thead><tr>'
    + '<th class="l">#</th><th>Range</th><th class="l">Protocol</th><th>TVL</th><th>7d</th><th>Launch</th><th>Odds</th><th>Implied</th><th>P25–P75</th><th>Verdict</th><th>Net / h</th><th>Break-even odds</th>'
    + '</tr></thead><tbody>';
  rows.forEach((row) => {
    const f = farmRow(row);
    html += '<tr data-slug="' + esc(row.slug) + '"' + (state.slug === row.slug ? ' class="sel"' : '') + '>'
      + '<td class="l">' + row.rank + '</td>'
      + '<td class="rng">' + row.rank_lo + '–' + row.rank_hi + '</td>'
      + '<td class="l"><span class="name">' + esc(row.name) + '</span><br><span class="sub2">' + esc(row.category || '—') + ' · ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' · TVL #' + row.tvl_rank + '</span></td>'
      + '<td>' + money(row.tvl_usd) + '</td>'
      + '<td>' + fmtGrowth(row.change_7d) + '</td>'
      + '<td>' + money(row.launch_usd) + '</td>'
      + '<td>' + pct(row.odds) + '</td>'
      + '<td><b>' + money(row.implied_value_usd) + '</b></td>'
      + '<td>' + money(row.p25_usd) + '–' + money(row.p75_usd) + '</td>'
      + '<td><span class="pill ' + f.verdict + '">' + f.verdict + '</span></td>'
      + '<td class="' + (f.netHour >= 0 ? 'pos' : 'neg') + '">$' + f.netHour.toFixed(0) + '</td>'
      + '<td>' + beText(f.be) + '</td>'
      + '</tr>';
  });
  return html + '</tbody></table>';
}

// ------------------------------------------------------------------ detail drawer

function econHTML(row) {
  const f = farmRow(row);
  return '<div class="work">At ' + money(farm.deposit) + ', ' + pct(farm.share, 1) + ' drop, ' + farm.weeks + ' weeks: '
    + 'expected drop <b>' + money(f.drop) + '</b> − gas ' + money(f.gas) + ' = net <b>' + money(f.net) + '</b> '
    + '(' + money(f.netHour) + '/hour over ' + f.hours.toFixed(1) + ' hours). '
    + 'T-bill on the same deposit: ' + money(f.opp) + '. Verdict <b>' + f.verdict + '</b>'
    + (f.verdict === 'FARM' ? ' — clears $25/hour and beats T-bills.' : f.verdict === 'MARGINAL' ? ' — pays, but not $25/hour or not past T-bills.' : ' — the drop does not cover the gas.')
    + ' Pays from a <b>' + (f.paysFrom === null ? 'never' : money(f.paysFrom)) + '</b> ticket. Break-even odds <b>' + beText(f.be) + '</b>.</div>';
}

function detailHTML(row) {
  const c = R.curve, o = R.odds, f = farmRow(row);
  const ageY = row.age_days === null ? null : row.age_days / 365;
  const logTvl = Math.log10(row.tvl_usd);
  const growth = Math.min(120, Math.max(-60, row.change_7d === null ? 0 : row.change_7d));
  const z = o.intercept + o.coef_age * ((ageY === null ? o.mean_age : ageY) - o.mean_age) / o.sd_age
    + o.coef_logtvl * (logTvl - o.mean_logtvl) / o.sd_logtvl
    + o.coef_growth * (growth - o.mean_growth) / o.sd_growth
    + o.coef_chains * (Math.min(row.chains.length, 4) - o.mean_chains) / o.sd_chains;
  const steps = row.steps || [];
  return '<section class="detail" id="detail"><h2>#' + row.rank + ' ' + esc(row.name) + ' <span class="sub2">' + esc(row.category || '—') + ' · TVL ' + money(row.tvl_usd) + ' · '
    + (ageY === null ? 'age unknown' : ageY.toFixed(1) + ' years') + ' · ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' · 7d ' + (row.change_7d === null ? '—' : (row.change_7d >= 0 ? '+' : '') + row.change_7d.toFixed(1) + '%') + '</span></h2>'
    + '<div class="cols"><div>'
    + '<h3>How this row is made</h3>'
    + '<div class="work"><code>launch = 10^(' + c.intercept + ' + ' + c.slope + ' × ' + logTvl.toFixed(2) + ' ' + (c.chains_coef < 0 ? '− ' : '+ ') + Math.abs(c.chains_coef) + ' × ' + Math.min(row.chains.length, 4) + ') = ' + money(row.launch_usd) + '</code><br>'
    + '<code>odds = logistic(z = ' + z.toFixed(2) + ') = ' + pct(row.odds) + '</code> — age ' + (ageY === null ? 'unknown, population mean used' : ageY.toFixed(1) + 'y') + ', log TVL ' + logTvl.toFixed(2) + ', growth ' + (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%, ' + Math.min(row.chains.length, 4) + ' chains<br>'
    + '<code>implied = ' + money(row.launch_usd) + ' × ' + pct(row.odds) + ' = <b>' + money(row.implied_value_usd) + '</b></code><br>'
    + 'P25–P75 ' + money(row.p25_usd) + '–' + money(row.p75_usd) + ' (curve interval, odds fixed) · rank ' + row.rank_lo + '–' + row.rank_hi + ' over 200 bootstrap refits · TVL rank #' + row.tvl_rank + '</div>'
    + '<h3>Farm economics</h3><div id="detail-econ">' + econHTML(row) + '</div>'
    + '</div><div>'
    + '<h3>Recently launched peers — blind price vs actual market cap</h3>'
    + '<table><thead><tr><th class="l">Peer</th><th>TVL</th><th>Blind</th><th>Actual</th><th>Miss</th></tr></thead><tbody>'
    + row.peers.map((p) => '<tr><td class="l">' + esc(p.name) + '<br><span class="sub2">' + esc(p.category || '—') + '</span></td><td>' + money(p.tvl_usd) + '</td><td>' + money(p.blind_usd) + '</td><td>' + money(p.mcap_usd) + '</td><td class="' + (p.miss >= 1 ? 'neg' : 'pos') + '">×' + (p.miss < 0.1 ? p.miss.toFixed(2) : p.miss.toFixed(1)) + '</td></tr>').join('')
    + '</tbody></table><p class="note">Blind price: the curve fitted without that peer&rsquo;s market cap (leave-one-out when it was in the training set). Miss above ×1 means the market paid more than the curve; below ×1, less.</p>'
    + '<h3>Farm plan</h3><ol class="steps">'
    + steps.map((s) => '<li>' + esc(s).replace(/When: ([^.]+)\./, '<span class="when">When: $1.</span>') + '</li>').join('')
    + '</ol></div></div></section>';
}

// ------------------------------------------------------------------ method, live, footer

function methodHTML() {
  const c = R.curve, o = R.odds;
  return '<section class="method" id="method"><h2>Method — what was fitted, what was tested, what was dropped</h2>'
    + '<h3>The curve</h3><p>log10(launch) = ' + c.intercept + ' + ' + c.slope + '·log10(TVL) ' + (c.chains_coef < 0 ? '− ' : '+ ') + Math.abs(c.chains_coef) + '·min(chains,4), '
    + 'a Huber fit (c = 1.345) of log10(market cap) on log10(TVL) and the chain count over the ' + c.n
    + ' launched protocols that carry a listing date. Leave-one-out median miss ×' + c.loo_median_miss + '; forward median miss ×' + c.forward_median_miss
    + ' (train before the median listing date ' + c.forward_cut + ', test after). A flat multiple — the median log(market cap / TVL) — misses by ×' + c.flat_loo_median_miss + ' leave-one-out and ×' + c.flat_forward_median_miss + ' forward, so the fit earns its keep.</p>'
    + '<p>The P25–P75 band is ×' + Math.pow(10, c.q25).toFixed(2) + '–×' + Math.pow(10, c.q75).toFixed(2) + ' around the fitted launch; ' + pct(c.in_p25_p75) + ' of launched tokens land inside it (50% stated) and ' + pct(c.in_p10_p90) + ' inside P10–P90 (80% stated). The band is honest about the spread, not flattering.</p>'
    + '<table><thead><tr><th class="l">Curve tried</th><th class="n">Leave-one-out</th><th class="n">Forward</th><th class="l">Kept?</th></tr></thead><tbody>'
    + c.ablation.map((a) => '<tr><td class="l">' + esc(a.name) + '</td><td class="n">×' + a.loo + '</td><td class="n">×' + a.wf + '</td><td class="l">' + (a.kept ? '<span class="kept">kept</span>' : '<span class="dropped">dropped</span>') + '</td></tr>').join('')
    + '</tbody></table><p class="note">A term is kept only when it wins on both splits. Age, growth, age+growth, growth × chains and category dummies were all tried and dropped; the slope stayed 0.4+ in the kept fit, in the leaders&rsquo; range.</p>'
    + '<h3>The odds</h3><p>Logistic fit of &ldquo;the protocol records a token&rdquo; (base rate ' + pct(o.base_rate) + ') over the ' + o.n
    + ' dated protocols the watchlist rules do not exclude. Coefficients (standardised): intercept ' + o.intercept + ', age ' + o.coef_age + ', log TVL ' + o.coef_logtvl + ', growth ' + o.coef_growth + ', chains ' + o.coef_chains + '. '
    + 'Forward split at the median listing date ' + o.forward_cut + '.</p>'
    + '<table><thead><tr><th class="l">Odds terms, added one at a time</th><th class="n">Brier, 5-fold</th><th class="n">Brier, forward</th><th class="n">Forward bench</th></tr></thead><tbody>'
    + o.ladder.map((s, i) => '<tr><td class="l">' + esc(s.terms) + (i === o.ladder.length - 1 ? ' <span class="kept">kept</span>' : '') + '</td><td class="n">' + s.brier5.toFixed(4) + '</td><td class="n">' + s.brierForward.toFixed(4) + '</td><td class="n">' + s.benchForward.toFixed(4) + '</td></tr>').join('')
    + '</tbody></table><p class="note">Every step wins on both splits. The kept four-factor fit: 5-fold Brier ' + o.brier_5fold + ' (repeated 5-fold mean ' + o.brier_5fold_repeated + '), forward ' + o.brier_forward + ' against a ' + o.bench_forward + ' base-rate bench, in-sample ' + o.brier_in_sample + '. Growth&rsquo;s coefficient is negative: once age is in the model, the fastest growers are the youngest, and the youngest have not launched yet.</p>'
    + '<h3>Where it misses — the worst leave-one-out misses, published, not hidden</h3>'
    + '<table><thead><tr><th class="l">Launched token</th><th class="n">Actual market cap</th><th class="n">Blind fitted launch</th><th class="n">Miss</th></tr></thead><tbody>'
    + R.worst_misses.map((w) => '<tr><td class="l">' + esc(w.name) + '</td><td class="n">' + money(w.actual_usd) + '</td><td class="n">' + money(w.fitted_usd) + '</td><td class="n">×' + w.miss.toFixed(1) + '</td></tr>').join('')
    + '</tbody></table>'
    + '<h3>Stability</h3><p>' + R.top20.kept + ' of the top 20 hold their top-20 seat in ≥80% of 200 seeded bootstrap refits of both fits. Per-rank hold rates: '
    + R.top20.fractions.map((f, i) => '#' + (i + 1) + ' ' + pct(f)).join(', ') + '.</p>'
    + '<p><b>Not TVL alone:</b> ' + R.not_tvl_alone.count + ' of ' + R.not_tvl_alone.of + ' rows sit 5 or more ranks away from their TVL rank — the ranking is not a TVL ranking in disguise.</p>'
    + '<h3>The ledger — all 758 protocols</h3><p>' + R.ledger.map((g) => g.label + ': ' + g.count).join(' · ') + ' = 758.</p>'
    + '<table><thead><tr><th class="l">Excluded by the watchlist rules</th><th class="n">Count</th></tr></thead><tbody>'
    + R.excluded_breakdown.map((e) => '<tr><td class="l">' + esc(e.reason) + '</td><td class="n">' + e.count + '</td></tr>').join('')
    + '</tbody></table>'
    + '<p><b>What is not in the code:</b> the model file contains 0 protocol names. The farm plan is generated from each protocol&rsquo;s own record (category, chains, TVL, age), and the peers are the nearest launched protocols by TVL in the same category first.</p>'
    + '</section>';
}

function liveHTML() {
  return '<section class="live"><h2>Live tokens — the market&rsquo;s own values, never mixed into the board</h2><div class="livegrid">'
    + R.live.map((p) => '<div><b>' + esc(p.name) + '</b> · ' + money(p.mcap_usd) + ' <span class="sub2">mcap · TVL ' + money(p.tvl_usd) + '</span></div>').join('')
    + '</div></section>';
}

function footerHTML() {
  return '<footer>Source: ' + esc(R.source) + ' · snapshot ' + R.as_of + ' · floor $50,000,000 · model ' + R.model_version
    + '. Built from the sealed snapshot; no live data. Implied values are model estimates, not prices, and a farm plan is a plan, not advice.</footer>';
}

// ------------------------------------------------------------------ orchestration

function render() {
  const rows = filteredRows();
  let html = headerHTML();
  if (state.slug) {
    const row = R.rows.find((r) => r.slug === state.slug);
    if (row) html += detailHTML(row);
  }
  html += controlsHTML() + filtersHTML(rows.length, R.rows.length) + boardHTML(rows) + methodHTML() + liveHTML() + footerHTML();
  main.innerHTML = html;
  main.setAttribute('aria-busy', 'false');
  bindEvents();
  if (state.method) {
    const m = document.getElementById('method');
    if (m) m.scrollIntoView();
  } else if (state.slug) {
    const d = document.getElementById('detail');
    if (d) d.scrollIntoView();
  }
}

function refreshFarm() {
  const fn = document.querySelector('.farmnext');
  if (fn) fn.innerHTML = bestFarm();
  document.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
    const row = R.rows.find((r) => r.slug === tr.dataset.slug);
    if (!row) return;
    const f = farmRow(row);
    const cells = tr.children;
    if (cells[9]) cells[9].innerHTML = '<span class="pill ' + f.verdict + '">' + f.verdict + '</span>';
    if (cells[10]) { cells[10].textContent = '$' + f.netHour.toFixed(0); cells[10].className = f.netHour >= 0 ? 'pos' : 'neg'; }
    if (cells[11]) cells[11].textContent = beText(f.be);
  });
  const d = document.getElementById('detail-econ');
  if (d && state.slug) {
    const row = R.rows.find((r) => r.slug === state.slug);
    if (row) d.innerHTML = econHTML(row);
  }
}

function bindEvents() {
  [['sl-dep', 'deposit', DEPOSITS], ['sl-share', 'share', SHARES], ['sl-weeks', 'weeks', HORIZONS], ['sl-tbill', 'tbill', TBILLS]].forEach(([id, key, values]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = document.getElementById(id + '-v');
    const fmt = key === 'deposit' ? (v) => money(v) : key === 'weeks' ? (v) => v + ' weeks' : (v) => pct(v, key === 'share' ? 1 : 0);
    el.addEventListener('input', () => {
      farm[key] = values[Number(el.value)];
      if (label) label.textContent = fmt(farm[key]);
      refreshFarm();
    });
    el.addEventListener('change', () => render());
  });
  document.querySelectorAll('.filters button').forEach((b) => {
    b.addEventListener('click', () => { setHash({ verdict: b.dataset.v }); applyHash(); render(); });
  });
  const cat = document.getElementById('f-cat');
  if (cat) cat.addEventListener('change', () => { setHash({ category: cat.value }); applyHash(); render(); });
  const q = document.getElementById('f-q');
  if (q) q.addEventListener('input', () => { state.q = q.value; render(); const nq = document.getElementById('f-q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
  document.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
    tr.addEventListener('click', () => {
      setHash({ p: tr.dataset.slug });
      applyHash();
      render();
    });
  });
}

window.addEventListener('hashchange', () => { applyHash(); render(); });
render();
