// Token Radar, radar-4 dashboard. Static page, no framework, no network: every byte it
// shows comes from window.RADAR, written beside this page by main.ts. It renders the ranked
// board of pre-token protocols, a detail drawer per protocol with the model's arithmetic and
// its farm plan, the live-token table set aside from the ranking, the full ledger, and the
// validation behind the model. The sliders recompute every farm verdict live, from the same
// numbers the build used. Selecting a row, filtering or searching updates the URL hash so a
// view can be linked and screenshotted.
(() => {
  'use strict';

  const DATA = window.RADAR;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- formatting

  function usd(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
    if (a >= 100) return `${sign}$${Math.round(a)}`;
    return `${sign}$${a.toFixed(2)}`;
  }

  function usdFull(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }

  function pct(n, digits) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(digits === undefined ? 0 : digits)}%`;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function miss(x) {
    return `×${Number(x).toFixed(2)}`;
  }

  /** The FNV-1a 32-bit hash, as hex: the same hash the build used for the board checksum. */
  function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // ---------------------------------------------------------------- self-check

  /** Recompute the board from the data file and verify it, in the browser, from the numbers. */
  function selfCheck() {
    const el = $('selfcheck');
    const checks = [];
    const rows = DATA.rows;
    let ranksOk = true;
    let valuesOk = true;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) ranksOk = false;
      if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) valuesOk = false;
    }
    checks.push({ label: `Ranks run 1 to ${rows.length} in order`, ok: ranksOk });
    checks.push({ label: 'Implied value never rises down the board', ok: valuesOk });
    const total = rows.reduce((s, r) => s + r.implied_value_usd, 0);
    checks.push({ label: `Board total ${usd(total)} matches the build`, ok: total === DATA.implied_total_usd });
    const sum = fnv1a(rows.map((r) => `${r.rank}:${r.slug}:${r.implied_value_usd}`).join('|'));
    checks.push({ label: `Checksum ${sum} matches the build`, ok: sum === DATA.checksum });
    const wl = new Set(DATA.watchlist);
    const covered = rows.filter((r) => wl.has(r.slug)).length;
    checks.push({ label: `Watchlist ${covered}/${DATA.watchlist_size} covered`, ok: covered === DATA.watchlist_size });
    const ledgerTotal = DATA.ledger.reduce((s, g) => s + g.count, 0);
    checks.push({ label: `Ledger ${ledgerTotal}/${DATA.ledger_total} protocols accounted for`, ok: ledgerTotal === DATA.ledger_total && DATA.ledger_total === 758 });
    const allOk = checks.every((c) => c.ok);
    el.classList.toggle('fail', !allOk);
    el.innerHTML =
      `<span class="ok">${allOk ? '✓ Board verified in your browser' : '✗ Board check failed'}</span> — recomputed from the data file, not taken on trust:` +
      '<ul>' + checks.map((c) => `<li>${c.ok ? '✓' : '✗'} ${esc(c.label)}</li>`).join('') + '</ul>';
    return allOk;
  }

  // ---------------------------------------------------------------- farm math

  const farmInputs = {
    deposit: DATA.model.farm_deposit_usd,
    share: DATA.model.farm_drop_share,
    weeks: DATA.model.farm_horizon_weeks,
    tbill: DATA.model.farm_tbill_rate,
  };

  /** One row's farm economics under the current slider inputs, from the row's own numbers. */
  function farmFor(row) {
    const gross = row.implied_value_usd * farmInputs.share * (farmInputs.deposit / Math.max(row.tvl_usd, 1));
    const net = gross - row.fees_usd;
    const netPerHour = net / row.hours;
    const tbill = farmInputs.deposit * farmInputs.tbill * (farmInputs.weeks / 52);
    const verdict = net > tbill && netPerHour >= DATA.model.farm_min_net_per_hour_usd ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
    return { gross, net, netPerHour, tbill, verdict };
  }

  /** The whole board's verdict counts under the current slider inputs. */
  function farmCounts() {
    const c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    for (const r of DATA.rows) c[farmFor(r).verdict]++;
    return c;
  }

  // ---------------------------------------------------------------- KPIs and formula

  function renderKpis() {
    const v = DATA.validation;
    const c = farmCounts();
    const cards = [
      { num: String(DATA.board_size), lbl: 'protocols ranked', sub: `${DATA.watchlist_size} watchlist · ${DATA.offlist_size} above the floor, not on it · ${DATA.early_size} below the floor` },
      { num: usd(DATA.implied_total_usd), lbl: 'implied value, whole board', sub: `Top row ${esc(DATA.rows[0].name)} at ${usd(DATA.rows[0].implied_value_usd)}` },
      { num: miss(Math.pow(10, v.curve.loo_median_log_err)), lbl: 'out-of-sample miss, leave-one-out', sub: `Walk-forward ${miss(v.ablation.find((a) => a.term.includes('chain count')).walk_median_miss)} · flat multiple ${miss(v.flat_loo_median_miss)}` },
      { num: `${Math.round(v.curve.inside_p25_p75 * 100)}%`, lbl: 'inside their own P25–P75', sub: 'Stated 50% · P10–P90 inside ' + Math.round(v.curve.inside_p10_p90 * 100) + '% (stated 80%)' },
      { num: v.odds.logit_brier_cv.toFixed(3), lbl: 'odds Brier score, 5-fold', sub: `Base rate ${v.odds.base_brier_cv.toFixed(3)} · walk-forward ${v.odds.walk_logit_brier.toFixed(3)} vs base ${v.odds.walk_base_brier.toFixed(3)} · buckets ${v.odds.bucket_brier_cv.toFixed(3)}` },
      { num: String(c.FARM), lbl: 'farmable at the default plan', sub: `${c.MARGINAL} marginal · ${c.SKIP} skip · deposit $5,000, 7%, 12 weeks, T-bill 4%` },
    ];
    $('kpis').innerHTML = cards.map((k) =>
      `<div class="kpi"><div class="num">${k.num}</div><div class="lbl">${k.lbl}</div><div class="sub">${k.sub}</div></div>`).join('');
  }

  function renderFormula() {
    const v = DATA.validation;
    const c = v.curve;
    const chain = c.chain_coef < 0 ? `− ${Math.abs(c.chain_coef)}` : `+ ${c.chain_coef}`;
    $('formulaLine').textContent =
      `log10(launch value) = ${c.intercept} + ${c.slope} × log10(TVL) ${chain} × min(chains, 4)`;
    $('formulaNote').textContent =
      `Huber robust fit (c = ${DATA.model.huber_c}) on ${c.n} traded comparables — market cap at least $1M, launch categories only. ` +
      `Implied value = fitted launch value × launch odds. A protocol ten times larger is worth about ${Math.pow(10, c.slope).toFixed(1)}× as much, not ten times as much: the slope is sublinear.`;
    const e = v.example;
    $('workedExample').innerHTML =
      `<b>Worked example — ${esc(e.name)}.</b> TVL ${usd(e.tvl_usd)}, ${e.chains} chain${e.chains === 1 ? '' : 's'}: ` +
      `launch value ${usdFull(e.launch_value_usd)} × odds ${pct(e.odds)} = implied value <b>${usdFull(e.implied_value_usd)}</b>. ` +
      `The odds come from a logistic fit on listing age, fitted on every dated protocol in the snapshot.`;
    $('asOf').textContent = DATA.as_of;
    $('footTotal').textContent = String(DATA.ledger_total);
    $('footAsOf').textContent = DATA.as_of;
  }

  // ---------------------------------------------------------------- farm box

  function renderFarmBox() {
    const c = farmCounts();
    $('farmSummary').textContent =
      `At a $${farmInputs.deposit.toLocaleString('en-US')} deposit, ${(farmInputs.share * 100).toFixed(1)}% drop share, ${farmInputs.weeks} weeks and a ${(farmInputs.tbill * 100).toFixed(1)}% T-bill rate: ` +
      `${c.FARM} FARM, ${c.MARGINAL} MARGINAL, ${c.SKIP} SKIP.`;
    const best = DATA.rows
      .map((r) => ({ row: r, f: farmFor(r) }))
      .filter((x) => x.f.verdict === 'FARM')
      .sort((a, b) => b.f.netPerHour - a.f.netPerHour)
      .slice(0, 3);
    $('farmNext').innerHTML = best.length === 0
      ? '<li>No row clears the FARM bar at these inputs. Lower the deposit, raise the drop share, or lengthen the hold.</li>'
      : best.map((x) =>
          `<li><span class="tag">Farm next: ${esc(x.row.name)}</span> — ${usd(x.f.netPerHour)}/hour net, ${usd(x.f.net)} net on a $${farmInputs.deposit.toLocaleString('en-US')} deposit, ` +
          `implied value ${usd(x.row.implied_value_usd)} on ${usd(x.row.tvl_usd)} of TVL.</li>`).join('');
    $('depositOut').textContent = `$${farmInputs.deposit.toLocaleString('en-US')}`;
    $('shareOut').textContent = `${(farmInputs.share * 100).toFixed(1)}%`;
    $('horizonOut').textContent = `${farmInputs.weeks} weeks`;
    $('tbillOut').textContent = `${(farmInputs.tbill * 100).toFixed(1)}%`;
  }

  // ---------------------------------------------------------------- board

  function visibleRows() {
    const q = $('search').value.trim().toLowerCase();
    const cat = $('category').value;
    const verdict = $('verdict').value;
    const wlOnly = $('watchlistOnly').checked;
    const wl = new Set(DATA.watchlist);
    let rows = DATA.rows.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
      if (cat && r.category !== cat) return false;
      if (verdict && farmFor(r).verdict !== verdict) return false;
      if (wlOnly && !wl.has(r.slug)) return false;
      return true;
    });
    const sort = $('sort').value;
    if (sort === 'tvl') rows = [...rows].sort((a, b) => b.tvl_usd - a.tvl_usd);
    else if (sort === 'launch') rows = [...rows].sort((a, b) => b.launch_value_usd - a.launch_value_usd);
    else if (sort === 'odds') rows = [...rows].sort((a, b) => b.launch_odds - a.launch_odds);
    else if (sort === 'net') rows = [...rows].sort((a, b) => farmFor(b).netPerHour - farmFor(a).netPerHour);
    return rows;
  }

  function deltaCell(r) {
    if (r.rank_delta === 0) return '<td class="num">—</td>';
    if (r.rank_delta < 0) return `<td class="num delta-up">▲ ${-r.rank_delta}</td>`;
    return `<td class="num delta-down">▼ ${r.rank_delta}</td>`;
  }

  function renderBoard() {
    const rows = visibleRows();
    const body = $('boardBody');
    body.innerHTML = rows.map((r) => {
      const f = farmFor(r);
      const change = r.change_7d === null ? '—' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`;
      return `<tr data-slug="${esc(r.slug)}">
        <td class="num">${r.rank}</td>
        <td><b>${esc(r.name)}</b><span class="sub">${esc(r.category || 'Uncategorized')} · ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}</span></td>
        <td class="num">${usd(r.tvl_usd)}</td>
        <td class="num">${change}</td>
        <td class="num">${usd(r.launch_value_usd)}</td>
        <td class="num">${pct(r.launch_odds)}</td>
        <td class="num"><b>${usd(r.implied_value_usd)}</b><span class="sub">${usd(r.implied_low_usd)} – ${usd(r.implied_high_usd)}</span></td>
        <td><span class="verdict ${f.verdict}">${f.verdict}</span></td>
        <td class="num">${usd(f.netPerHour)}</td>
        ${deltaCell(r)}
      </tr>`;
    }).join('');
    $('boardCount').textContent = `— ${rows.length} of ${DATA.board_size} rows`;
    $('boardNote').textContent =
      `Implied value is the fitted launch value times the launch odds; the small range under it is the P25–P75 interval from leave-one-out errors. ` +
      `“vs TVL rank” shows how far a row moved from where TVL alone would put it. Click a row for its arithmetic and farm plan.`;
    body.querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => openDrawer(tr.dataset.slug)));
  }

  // ---------------------------------------------------------------- drawer

  function openDrawer(slug) {
    const r = DATA.rows.find((x) => x.slug === slug);
    if (!r) return;
    const f = farmFor(r);
    const c = DATA.validation.curve;
    const age = r.age_days === null ? 'unknown' : `${r.age_days} days`;
    const chain = c.chain_coef < 0 ? `− ${Math.abs(c.chain_coef)}` : `+ ${c.chain_coef}`;
    $('drawerBody').innerHTML =
      `<h2>${esc(r.name)}</h2>
      <p class="fine">${esc(r.category || 'Uncategorized')} · ${r.chains.map(esc).join(', ') || 'no chain listed'} · listed ${r.listed_at || 'date unknown'} (${age})</p>
      <p>${esc(r.why)}</p>
      <h3>How the value is built</h3>
      <table><tbody>
        <tr><td>TVL</td><td class="num">${usdFull(r.tvl_usd)}</td></tr>
        <tr><td>Fitted launch value</td><td class="num">${usdFull(r.launch_value_usd)}</td></tr>
        <tr><td>Launch odds (fitted on listing age)</td><td class="num">${pct(r.launch_odds)}</td></tr>
        <tr><td>Implied value</td><td class="num"><b>${usdFull(r.implied_value_usd)}</b></td></tr>
        <tr><td>P25–P75 interval</td><td class="num">${usdFull(r.implied_low_usd)} – ${usdFull(r.implied_high_usd)}</td></tr>
        <tr><td>TVL rank</td><td class="num">${r.tvl_rank} (board rank ${r.rank})</td></tr>
      </tbody></table>
      <p class="fine">log10(launch) = ${c.intercept} + ${c.slope} × log10(${usdFull(r.tvl_usd)}) ${chain} × ${Math.min(r.chains.length, 4)} chains.</p>
      <h3>Farm plan — ${f.verdict}</h3>
      <table><tbody>
        <tr><td>Expected airdrop</td><td class="num">${usd(f.gross)}</td></tr>
        <tr><td>Gas</td><td class="num">− ${usd(r.fees_usd)}</td></tr>
        <tr><td>Net</td><td class="num"><b>${usd(f.net)}</b></td></tr>
        <tr><td>Net per hour (${r.hours} h)</td><td class="num">${usd(f.netPerHour)}</td></tr>
        <tr><td>Same deposit in T-bills (${farmInputs.weeks} w)</td><td class="num">${usd(f.tbill)}</td></tr>
      </tbody></table>
      <p class="fine">Expected airdrop = implied value × ${(farmInputs.share * 100).toFixed(1)}% drop share × ($${farmInputs.deposit.toLocaleString('en-US')} / TVL). FARM needs the net to beat T-bills and clear $${DATA.model.farm_min_net_per_hour_usd}/hour.</p>
      <ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    if (history.replaceState) history.replaceState(null, '', `#detail=${encodeURIComponent(slug)}`);
  }

  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    if (history.replaceState && location.hash.startsWith('#detail=')) history.replaceState(null, '', '#boardbox');
  }

  // ---------------------------------------------------------------- validation

  function renderValidation() {
    const v = DATA.validation;
    const c = v.curve;
    $('claimLine').textContent =
      `Out of sample, the fitted curve misses by ${miss(Math.pow(10, c.loo_median_log_err))} (leave-one-out) and ` +
      `${miss(v.ablation.find((a) => a.term.includes('chain count')).walk_median_miss)} (walk-forward). ` +
      `A flat TVL/market-cap multiple misses by ${miss(v.flat_loo_median_miss)} and ${miss(v.flat_walk_median_miss)}. ` +
      `${Math.round(c.inside_p25_p75 * 100)}% of leave-one-out predictions land inside their own P25–P75 (stated 50%).`;
    $('scatterNote').textContent =
      `${c.n} traded comparables (market cap at least $1M, launch categories only). Each dot is one traded token; ` +
      `the line is the fitted curve at 2 chains. Dust tokens and bridges, exchanges and staking receipts are not comparables, so they are not drawn.`;
    $('ablationBody').innerHTML = v.ablation.map((a) =>
      `<tr><td>${esc(a.term)}</td><td class="num">${miss(a.loo_median_miss)}</td><td class="num">${miss(a.walk_median_miss)}</td>` +
      `<td>${a.kept ? '<b>Kept</b>' : 'Dropped'}</td><td>${esc(a.reason)}</td></tr>`).join('');
    const oc = v.odds_curve;
    $('oddsCurveNote').textContent =
      `Fitted odds = 1 / (1 + exp(-(${oc.b0} + ${oc.b1} × (age in years − ${oc.age_mean_years}) / ${oc.age_sd_years}))). ` +
      `A protocol whose listing age is unknown gets the global rate ${pct(oc.global_rate)}. The logistic beats the age buckets on both held-out tests, so the board uses it.`;
    $('oddsCurveBody').innerHTML = oc.points.map((p) => {
      const label = p.age_days === 0 ? 'Listed today' : p.age_days < 365 ? `${p.age_days} days` : `${(p.age_days / 365).toFixed(p.age_days % 365 === 0 ? 0 : 1)} years`;
      return `<tr><td>${label}</td><td class="num">${pct(p.odds)}</td></tr>`;
    }).join('');
    $('oddsBody').innerHTML = v.odds_buckets.map((b) => {
      const label = b.max_days === -1 ? `${b.min_days} days and over` : `${b.min_days}–${b.max_days} days`;
      return `<tr><td>${label}</td><td class="num">${b.peers}</td><td class="num">${b.recorded}</td><td class="num">${pct(b.odds)}</td></tr>`;
    }).join('');
    $('oddsNote').textContent =
      `Odds validation: the age logistic scores 5-fold Brier ${v.odds.logit_brier_cv.toFixed(3)} against a base-rate ${v.odds.base_brier_cv.toFixed(3)} ` +
      `(age buckets: ${v.odds.bucket_brier_cv.toFixed(3)}). Walk-forward: logistic ${v.odds.walk_logit_brier.toFixed(3)}, buckets ${v.odds.walk_bucket_brier.toFixed(3)}, ` +
      `train base rate ${v.odds.walk_base_brier.toFixed(3)}. ${v.odds.note} ` +
      `The curve's walk-forward cut is ${v.walk_cut} and the odds' cut is ${v.odds.walk_cut}: each is the median listing date of its own sample, so the two dates differ.`;
    $('intervalNote').textContent =
      `Leave-one-out errors in log10: P25 ${c.loo_q25.toFixed(3)}, P75 ${c.loo_q75.toFixed(3)} ` +
      `(×${Math.pow(10, c.loo_q25).toFixed(2)} to ×${Math.pow(10, c.loo_q75).toFixed(2)}). ` +
      `${Math.round(c.inside_p25_p75 * 100)}% of predictions fall inside their own P25–P75 (stated 50%); ` +
      `${Math.round(c.inside_p10_p90 * 100)}% inside P10–P90 (stated 80%). The interval is a measured miss, not a guessed spread.`;
    drawScatter();
  }

  /** The scatter plot: traded tokens, log market cap against log TVL, with the fitted curve. */
  function drawScatter() {
    const cv = $('scatter');
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const padL = 64;
    const padR = 20;
    const padT = 18;
    const padB = 44;
    const pts = DATA.comps;
    const v = DATA.validation;
    const c = v.curve;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.log_tvl);
      x1 = Math.max(x1, p.log_tvl);
      y0 = Math.min(y0, p.log_mcap);
      y1 = Math.max(y1, p.log_mcap);
    }
    x0 = Math.floor(x0 - 0.3);
    x1 = Math.ceil(x1 + 0.3);
    y0 = Math.floor(y0 - 0.3);
    y1 = Math.ceil(y1 + 0.3);
    const X = (x) => padL + ((x - x0) / (x1 - x0)) * (W - padL - padR);
    const Y = (y) => padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#5f6f67';
    ctx.strokeStyle = '#d8e2dc';
    ctx.lineWidth = 1;
    for (let gx = x0; gx <= x1; gx++) {
      ctx.beginPath();
      ctx.moveTo(X(gx), padT);
      ctx.lineTo(X(gx), H - padB);
      ctx.stroke();
      ctx.fillText(tickLabel(gx), X(gx) - 14, H - padB + 18);
    }
    for (let gy = y0; gy <= y1; gy++) {
      ctx.beginPath();
      ctx.moveTo(padL, Y(gy));
      ctx.lineTo(W - padR, Y(gy));
      ctx.stroke();
      ctx.fillText(tickLabel(gy), 8, Y(gy) + 4);
    }
    ctx.fillStyle = '#16211c';
    ctx.fillText('TVL (log)', W / 2 - 30, H - 8);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Market cap (log)', -48, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(15, 122, 90, 0.75)';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(X(p.log_tvl), Y(p.log_mcap), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#0f7a5a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const x = x0 + ((x1 - x0) * i) / 60;
      const y = c.intercept + c.slope * x + c.chain_coef * 2;
      if (i === 0) ctx.moveTo(X(x), Y(y));
      else ctx.lineTo(X(x), Y(y));
    }
    ctx.stroke();
  }

  function tickLabel(log10v) {
    if (log10v >= 9) return `$${Math.pow(10, log10v - 9).toFixed(0)}B`;
    if (log10v >= 6) return `$${Math.pow(10, log10v - 6).toFixed(0)}M`;
    if (log10v >= 3) return `$${Math.pow(10, log10v - 3).toFixed(0)}K`;
    return `$${Math.pow(10, log10v).toFixed(0)}`;
  }

  // ---------------------------------------------------------------- live and ledger

  function renderLive() {
    $('liveBody').innerHTML = DATA.live.map((p) => {
      const change = p.change_7d === null ? '—' : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`;
      return `<tr><td><b>${esc(p.name)}</b><span class="sub">${esc(p.category || 'Uncategorized')} · ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}</span></td>` +
        `<td class="num">${usd(p.tvl_usd)}</td><td class="num">${usd(p.mcap_usd)}</td><td class="num">${change}</td></tr>`;
    }).join('');
  }

  const SEG_CLASS = {
    watchlist: 'seg-watchlist',
    offlist: 'seg-offlist',
    early: 'seg-early',
    live: 'seg-live',
    record: 'seg-record',
  };

  function renderLedger() {
    const total = DATA.ledger_total;
    $('stackedBar').innerHTML = DATA.ledger.map((g) => {
      const cls = SEG_CLASS[g.key] || 'seg-excluded';
      return `<span class="${cls}" style="width:${(g.count / total * 100).toFixed(2)}%" title="${esc(g.label)}: ${g.count}"></span>`;
    }).join('');
    $('ledgerBody').innerHTML = DATA.ledger.map((g) =>
      `<tr><td>${esc(g.label)}</td><td class="num">${g.count}</td><td class="num">${(g.count / total * 100).toFixed(1)}%</td></tr>`).join('');
    $('ledgerNote').textContent =
      `Every one of the ${total} snapshot protocols sits in exactly one group. ` +
      `Excluded means pre-token but not a launch under the house rule: a bridge, a liquid-staking or restaking receipt, ` +
      `an exchange, a versioned name, or a wrapped or staked product.`;
  }

  // ---------------------------------------------------------------- wiring

  function bindControls() {
    const rerender = () => { renderFarmBox(); renderBoard(); renderKpis(); };
    $('deposit').addEventListener('input', (e) => { farmInputs.deposit = Number(e.target.value); rerender(); });
    $('share').addEventListener('input', (e) => { farmInputs.share = Number(e.target.value) / 100; rerender(); });
    $('horizon').addEventListener('input', (e) => { farmInputs.weeks = Number(e.target.value); rerender(); });
    $('tbill').addEventListener('input', (e) => { farmInputs.tbill = Number(e.target.value) / 100; rerender(); });
    $('search').addEventListener('input', renderBoard);
    $('category').addEventListener('change', renderBoard);
    $('verdict').addEventListener('change', renderBoard);
    $('watchlistOnly').addEventListener('change', renderBoard);
    $('sort').addEventListener('change', renderBoard);
    $('drawerClose').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  }

  function fillCategories() {
    const cats = [...new Set(DATA.rows.map((r) => r.category).filter((c) => c !== null))].sort();
    const sel = $('category');
    for (const c of cats) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    }
  }

  /** Preset the view from the URL: query params set the filters, #detail=<slug> opens a row. */
  function applyUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('verdict')) $('verdict').value = q.get('verdict');
    if (q.get('category')) $('category').value = q.get('category');
    if (q.get('search')) $('search').value = q.get('search');
    if (q.get('sort')) $('sort').value = q.get('sort');
    if (q.get('watchlist') === '1') $('watchlistOnly').checked = true;
    if (q.get('deposit')) { farmInputs.deposit = Number(q.get('deposit')); $('deposit').value = String(farmInputs.deposit); }
    if (q.get('share')) { farmInputs.share = Number(q.get('share')) / 100; $('share').value = String(Number(q.get('share'))); }
    if (q.get('horizon')) { farmInputs.weeks = Number(q.get('horizon')); $('horizon').value = String(farmInputs.weeks); }
    if (q.get('tbill')) { farmInputs.tbill = Number(q.get('tbill')); $('tbill').value = String(Number(q.get('tbill'))); }
    const m = location.hash.match(/^#detail=(.+)$/);
    if (m) openDrawer(decodeURIComponent(m[1]));
  }

  function init() {
    if (!DATA || !Array.isArray(DATA.rows)) {
      $('selfcheck').textContent = 'No board data loaded.';
      $('selfcheck').classList.add('fail');
      return;
    }
    fillCategories();
    bindControls();
    applyUrl();
    selfCheck();
    renderKpis();
    renderFormula();
    renderFarmBox();
    renderBoard();
    renderValidation();
    renderLive();
    renderLedger();
  }

  init();
})();
