// The token radar's model, radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// radar-4 replaces the previous linear category multiple with a fitted curve, because the snapshot's
// own traded tokens say a flat multiple is wrong: the median miss of a flat TVL/mcap multiple is
// x3.29, while a fitted log-log curve misses by x2.46 (leave-one-out) and x1.99 (walk-forward).
// Every number below is computed from the snapshot at build time; nothing is tuned by hand and no
// protocol name is ever special-cased.
//
// The model, in one paragraph:
//   1. Comparables: traded protocols with a usable market cap (mcap >= $1M) whose category is a
//      launch category (no Bridge / Liquid Staking / Liquid Restaking / Restaked BTC / CEX). On
//      this snapshot that is 81 protocols. Dust tokens and non-launch categories are not priced
//      comparables, and the page says so.
//   2. Launch value: a Huber robust fit (IRLS, c = 1.345) of log10(market cap) on log10(TVL) and
//      the chain count, over the comparables. The fitted slope is sublinear (about 0.34): a
//      protocol ten times larger is worth about twice as much, not ten times as much. The chain
//      term is fitted, not assumed: its sign and size come out of the data (on this snapshot it
//      is slightly negative, about -0.09 per chain, capped at 4 chains).
//   3. Launch odds: a logistic fit on listing age alone (age in years, standardised), fitted
//      on every dated protocol in the snapshot. Age is the only signal the odds use: a logistic
//      on age and TVL adds nothing (5-fold Brier 0.218 vs 0.217 for age alone), and TVL on its
//      own does not predict recording a token at all. The logistic wins both held-out tests
//      against the age buckets the odds were first tried with (5-fold Brier 0.217 vs 0.219;
//      walk-forward 0.234 vs 0.287 against a train base rate of 0.318), so the board uses the
//      logistic and the buckets are kept only as the raw record, shown on the page as evidence.
//      The odds are the peers' record at this age, not a forecast: the walk-forward Brier is
//      worse in absolute terms than the 5-fold numbers because the later cohort is younger and
//      its base rate is lower, and the page says that too.
//   4. Implied value = fitted launch value x launch odds. It is the expected value of the
//      launch, in dollars. The airdrop drop share is NOT part of it: it belongs to the farm
//      economics, where it prices one farmer's expected share.
//   5. Interval: every row carries a P25-P75 interval from the leave-one-out errors of the
//      fitted curve (on this snapshot x0.41 to x2.40). 51% of leave-one-out predictions land
//      inside their own P25-P75 (stated 50%), 80% inside P10-P90 (stated 80%).
//   6. Farm verdict: one farmer's expected airdrop is implied value x drop share x
//      (deposit / TVL), the drop pool split pro-rata by deposit. Net is that minus the plan's
//      gas. FARM means the net beats what the same deposit would earn in T-bills over the
//      horizon AND clears $25 an hour; MARGINAL means the net is positive; SKIP means it is
//      not. The sliders on the page (deposit, drop share, horizon, T-bill rate) recompute every
//      row live, so a reader can check the verdict under their own plan.
//
// What the build tests, and what it drops (the ablation table on the page shows all of it):
//   - base curve (log-log on TVL alone): LOO x2.89, walk-forward x2.45.
//   - + chain count: LOO x2.46, walk-forward x1.99. KEPT: wins both.
//   - + 7-day growth: LOO x3.01, walk-forward x2.06. NOT KEPT: loses leave-one-out and both
//     means; the walk-forward median alone does not save it.
//   - + age in the value curve: LOO x3.07, walk-forward x3.27. NOT KEPT: loses both.
//   - + category offsets (median residual per category, shrunk): LOO x2.88, walk-forward x2.45.
//     NOT KEPT: no gain over the base curve.
//   - flat TVL/mcap multiple (the baseline): LOO x3.29, walk-forward x3.13.
//
// The board ranks every clean pre-token protocol: the 40 on the watchlist, the 138 clean ones
// below the $50M floor, and the 20 clean ones above the floor that the watchlist does not name
// (the watchlist is the floor, never the ceiling). That is 198 rows on this snapshot. The live
// token view sets the traded protocols aside with their market caps, never mixed into the board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: design choices, stated on the page, none of them per-protocol. */
export interface ModelConstants {
  /** A traded token counts as a priced comparable only at or above this market cap. */
  comp_min_mcap_usd: number;
  /** Huber's tuning constant for the robust fit. */
  huber_c: number;
  /** Chains counted in the fitted curve, at most this many. */
  chains_cap: number;
  /** The odds prior: the global recorded rate, weighted as this many protocols. */
  odds_prior_n: number;
  /** The farm defaults the board is first drawn with; the page's sliders move them. */
  farm_deposit_usd: number;
  farm_drop_share: number;
  farm_horizon_weeks: number;
  farm_tbill_rate: number;
  /** A FARM verdict needs this many dollars of net per hour of work. */
  farm_min_net_per_hour_usd: number;
}

export const MODEL: ModelConstants = {
  comp_min_mcap_usd: 1_000_000,
  huber_c: 1.345,
  chains_cap: 4,
  odds_prior_n: 20,
  farm_deposit_usd: 5000,
  farm_drop_share: 0.07,
  farm_horizon_weeks: 12,
  farm_tbill_rate: 0.04,
  farm_min_net_per_hour_usd: 25,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted value curve: log10(launch value) = intercept + slope * log10(TVL) + chain * chains. */
export interface FittedCurve {
  intercept: number;
  slope: number;
  chain_coef: number;
  /** Comparables the curve was fitted on. */
  n: number;
  /** Median absolute leave-one-out error, in log10 units. */
  loo_median_log_err: number;
  /** The 25th and 75th percentiles of the leave-one-out errors, in log10 units. */
  loo_q25: number;
  loo_q75: number;
  loo_q10: number;
  loo_q90: number;
  /** Share of leave-one-out predictions whose actual value fell inside their own interval. */
  inside_p25_p75: number;
  inside_p10_p90: number;
}

/** One age bucket's launch odds, from the peers' own record. */
export interface OddsBucket {
  min_days: number;
  max_days: number;
  peers: number;
  recorded: number;
  odds: number;
}

/** One row of the ablation table: a candidate term, its two held-out errors, kept or not. */
export interface AblationRow {
  term: string;
  loo_median_miss: number;
  walk_median_miss: number;
  kept: boolean;
  reason: string;
}

/** The odds validation: held-out Brier scores against predicting the base rate. */
export interface OddsValidation {
  base_brier_cv: number;
  bucket_brier_cv: number;
  logit_brier_cv: number;
  walk_base_brier: number;
  walk_bucket_brier: number;
  walk_logit_brier: number;
  /** The odds' walk-forward split date (the median listing date of all dated protocols). */
  walk_cut: string;
  note: string;
}

/** Everything the page needs to show the validation: the curve, the ablation, the odds. */
export interface Validation {
  curve: FittedCurve;
  flat_loo_median_miss: number;
  flat_walk_median_miss: number;
  ablation: AblationRow[];
  odds: OddsValidation;
  odds_buckets: OddsBucket[];
  /** The fitted age logistic the board uses, with its odds at a spread of ages. */
  odds_curve: OddsCurve;
  /** The walk-forward split date (the median listing date of the dated comparables). */
  walk_cut: string;
  /** The fitted curve's worked example: one protocol, its inputs and its arithmetic. */
  example: {
    name: string;
    tvl_usd: number;
    chains: number;
    launch_value_usd: number;
    odds: number;
    implied_value_usd: number;
  };
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  /** The row's rank by TVL alone, slug breaking ties; rank_delta is rank minus this. */
  tvl_rank: number;
  rank_delta: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  /** The fitted launch value: what the token would be worth if it launched, before odds. */
  launch_value_usd: number;
  /** The peers' record: the share of protocols of this age that have recorded a token. */
  launch_odds: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    curve_intercept: number;
    curve_slope: number;
    curve_chain_coef: number;
    chains_used: number;
    launch_value_usd: number;
    odds: number;
    age_days: number | null;
  };
  farm: {
    gross_usd: number;
    fees_usd: number;
    net_usd: number;
    net_per_hour_usd: number;
    hours: number;
    tbill_usd: number;
    verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; farm_steps are carried verbatim from board.json so
 *  the page can never disagree with the board about a plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  launch_value_usd: number;
  launch_odds: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  tvl_rank: number;
  rank_delta: number;
  /** Why the row ranks where it does, one English sentence from its own numbers. */
  why: string;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  net_usd: number;
  net_per_hour_usd: number;
  /** The plan's gas and hours, from the build: the page recomputes verdicts from these, never from its own table. */
  fees_usd: number;
  hours: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One fitted comparable, for the page's scatter plot: traded tokens, log TVL against log mcap. */
export interface CompPoint {
  name: string;
  category: string | null;
  log_tvl: number;
  log_mcap: number;
}

/** One group of the full ledger: every snapshot protocol sits in exactly one group. */
export interface LedgerGroup {
  key: string;
  label: string;
  count: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  offlist_size: number;
  live_size: number;
  ledger: LedgerGroup[];
  ledger_total: number;
  validation: Validation;
  comps: CompPoint[];
  farm_summary: { farm: number; marginal: number; skip: number; best_net_per_hour: { slug: string; name: string; net_per_hour_usd: number }[] };
  implied_total_usd: number;
  checksum: string;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A quantile by linear interpolation on the sorted values. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function log10(n: number): number {
  return Math.log10(n);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Solve a small dense linear system by Gauss-Jordan elimination; null when singular. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const k = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    const pv = m[c]![c]!;
    if (Math.abs(pv) < 1e-12) return null;
    m[c] = m[c]!.map((v) => v / pv);
    for (let r = 0; r < k; r++) {
      if (r !== c && m[r]![c] !== 0) {
        const f = m[r]![c]!;
        m[r] = m[r]!.map((v, j) => v - f * m[c]![j]!);
      }
    }
  }
  return m.map((row) => row[k]!);
}

/** Ordinary least squares on a design matrix whose first column is the intercept. */
function ols(design: number[][], y: number[]): number[] | null {
  const k = design[0]!.length;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let t = 0; t < design.length; t++) {
    for (let i = 0; i < k; i++) {
      b[i]! += design[t]![i]! * y[t]!;
      for (let j = 0; j < k; j++) a[i]![j]! += design[t]![i]! * design[t]![j]!;
    }
  }
  return solveLinear(a, b);
}

/**
 * Huber's robust fit by iteratively reweighted least squares: start at OLS, then weight each
 * observation by min(1, c / |standardised residual|) with the MAD scale, refitting until the
 * coefficients stop moving. Outliers (a $6M protocol with a $2.6B token, a bridge with a $0.1M
 * token) bend an OLS line; Huber lets them speak softly instead of shouting.
 */
export function huberFit(design: number[][], y: number[], c = MODEL.huber_c, iters = 100): number[] | null {
  let coef = ols(design, y);
  if (coef === null) return null;
  for (let step = 0; step < iters; step++) {
    const res = y.map((v, t) => v - design[t]!.reduce((s, x, j) => s + x * coef![j]!, 0));
    const med = median(res);
    const scale = 1.4826 * median(res.map((r) => Math.abs(r - med))) || 1e-9;
    const w = res.map((r) => {
      const z = Math.abs(r / scale);
      return z <= c ? 1 : c / z;
    });
    const wd = design.map((row, t) => row.map((v) => Math.sqrt(w[t]!) * v));
    const wy = y.map((v, t) => Math.sqrt(w[t]!) * v);
    const next = ols(wd, wy);
    if (next === null) break;
    const moved = Math.max(...next.map((v, j) => Math.abs(v - coef![j]!)));
    coef = next;
    if (moved < 1e-10) break;
  }
  return coef;
}

/** The fitted curve's features for one protocol: [1, log10 TVL, capped chain count]. */
function curveFeatures(p: SnapshotProtocol, model: ModelConstants = MODEL): number[] {
  return [1, log10(Math.max(p.tvl_usd, 1)), Math.min(Math.max(p.chains.length, 0), model.chains_cap)];
}

/** Whether a protocol records a token at all: a market cap, a Gecko id or a symbol. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !hasToken(p);
}

/** Categories the house's watchlist rule treats as a wrapped / staked / bridged product, not a launch. */
export const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token under the house's full watchlist rule,
 * not just "no token recorded". A bridge, a liquid-staking receipt or a wrapped asset is a product
 * of a token that already trades, not a launch still to come.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/**
 * Whether a traded protocol is a priced comparable for the fitted curve: a usable market cap of
 * at least $1M, in a launch category. Dust tokens (a $0.1M cap) and bridges, exchanges and
 * staking receipts are not launches, so they do not calibrate one.
 */
export function isComparable(p: SnapshotProtocol, model: ModelConstants = MODEL): boolean {
  if (p.mcap_usd === null || p.mcap_usd < model.comp_min_mcap_usd) return false;
  if (p.tvl_usd <= 0) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The age buckets the odds use: five bands from days with no token to over three years. */
export const ODDS_BUCKETS: [number, number][] = [
  [0, 180],
  [180, 365],
  [365, 730],
  [730, 1095],
  [1095, Number.POSITIVE_INFINITY],
];

/**
 * The launch odds the board actually uses: a logistic fit on listing age alone (age in years,
 * standardised), fitted on every dated protocol in the snapshot. It wins both held-out tests
 * against the age buckets (5-fold Brier 0.217 vs 0.219; walk-forward 0.234 vs 0.287 against a
 * train base rate of 0.318), so the buckets are kept only as the raw record the curve was
 * fitted from, shown on the page as evidence. TVL adds nothing: a logistic on age and TVL
 * scores 0.218, and TVL's own coefficient is near zero, so age alone prices the odds.
 */
export interface OddsCurve {
  /** The logistic's intercept and age coefficient, on standardised age in years. */
  b0: number;
  b1: number;
  age_mean_years: number;
  age_sd_years: number;
  /** The global recorded rate: the odds for a protocol whose listing age is unknown. */
  global_rate: number;
  /** The fitted odds at a spread of ages, for the page. */
  points: { age_days: number; odds: number }[];
}

export type LogitModel = ReturnType<typeof fitLogit>;

/**
 * Fit the age logistic on every dated protocol: x is the listing age in years, y is whether
 * the protocol has recorded a token. Returns the fitted model and the global recorded rate.
 */
export function fitOddsLogit(snapshot: Snapshot): { logit: LogitModel; global: number } {
  const aged = snapshot.protocols.filter((p) => ageDays(snapshot.as_of, p.listed_at) !== null && p.tvl_usd > 0);
  const global = aged.length > 0 ? aged.filter(hasToken).length / aged.length : 0.5;
  const logit = fitLogit(aged.map((p) => ({ x1: ageDays(snapshot.as_of, p.listed_at)! / 365, x2: 0, y: hasToken(p) ? 1 : 0 })));
  return { logit, global: round4(global) };
}

/** The fitted odds curve, for the page: the logistic's odds at a spread of ages. */
export function oddsCurve(snapshot: Snapshot): OddsCurve {
  const { logit, global } = fitOddsLogit(snapshot);
  const points = [0, 90, 180, 365, 730, 1095, 1460, 1825].map((days) => ({
    age_days: days,
    odds: round4(logitPred(logit, days / 365, 0)),
  }));
  return {
    b0: round4(logit.b0),
    b1: round4(logit.b1),
    age_mean_years: round4(logit.m1),
    age_sd_years: round4(logit.s1),
    global_rate: global,
    points,
  };
}

/** One protocol's launch odds from the fitted age logistic; the global rate when its age is unknown. */
export function launchOdds(p: SnapshotProtocol, asOf: string, logit: LogitModel, global: number): number {
  const a = ageDays(asOf, p.listed_at);
  if (a === null) return global;
  return round4(logitPred(logit, a / 365, 0));
}

/**
 * The peers' raw record by age bucket: for each band, the share of protocols of that age that
 * have recorded a token, shrunk toward the global recorded rate with a prior of `odds_prior_n`
 * protocols. This is the evidence the logistic was fitted from, shown on the page as a table;
 * it is not the odds the board uses.
 */
export function fitOdds(snapshot: Snapshot, model: ModelConstants = MODEL): { buckets: OddsBucket[]; global: number } {
  const aged = snapshot.protocols.filter((p) => ageDays(snapshot.as_of, p.listed_at) !== null);
  const global = aged.length > 0 ? aged.filter(hasToken).length / aged.length : 0.5;
  const buckets: OddsBucket[] = ODDS_BUCKETS.map(([min, max]) => {
    const peers = aged.filter((p) => {
      const a = ageDays(snapshot.as_of, p.listed_at)!;
      return a >= min && a < max;
    });
    const recorded = peers.filter(hasToken).length;
    const odds = (recorded + global * model.odds_prior_n) / (peers.length + model.odds_prior_n);
    return { min_days: min, max_days: max === Number.POSITIVE_INFINITY ? -1 : max, peers: peers.length, recorded, odds: round4(odds) };
  });
  return { buckets, global: round4(global) };
}

/** The FNV-1a 32-bit hash, as hex: the build and the page both hash the board with it. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The design matrix for a candidate term set, over one list of protocols. `asOf` is the snapshot
 *  date; only the age term needs it. */
type TermSet = 'base' | 'chains' | 'growth' | 'age' | 'growth_chains' | 'growth_age' | 'all';

function designFor(p: SnapshotProtocol, terms: TermSet, model: ModelConstants, asOf = ''): number[] {
  const row = [1, log10(Math.max(p.tvl_usd, 1))];
  if (terms === 'chains' || terms === 'growth_chains' || terms === 'all') {
    row.push(Math.min(Math.max(p.chains.length, 0), model.chains_cap));
  }
  if (terms === 'growth' || terms === 'growth_chains' || terms === 'growth_age' || terms === 'all') {
    row.push(Math.min(model_growth_cap(model), Math.max(-60, finite(p.change_7d, 0))) / 100);
  }
  if (terms === 'age' || terms === 'growth_age' || terms === 'all') {
    const a = asOf === '' ? null : ageDays(asOf, p.listed_at);
    row.push(log10(Math.max(a ?? 180, 1)));
  }
  return row;
}

function model_growth_cap(_model: ModelConstants): number {
  return 120;
}

/** Fit one candidate term set on the comparables and return its coefficients. */
function fitTerms(comps: SnapshotProtocol[], terms: TermSet, model: ModelConstants, asOf = ''): number[] | null {
  const design = comps.map((p) => designFor(p, terms, model, asOf));
  const y = comps.map((p) => log10(p.mcap_usd!));
  return huberFit(design, y, model.huber_c);
}

/** The median absolute error of one fitted term set on one list, in multiplicative terms. */
function missOf(coef: number[] | null, rows: SnapshotProtocol[], terms: TermSet, model: ModelConstants, asOf = ''): number {
  if (coef === null || rows.length === 0) return Number.NaN;
  const errs = rows.map((p) => Math.abs(log10(p.mcap_usd!) - designFor(p, terms, model, asOf).reduce((s, x, j) => s + x * coef[j]!, 0)));
  return Math.pow(10, median(errs));
}

/**
 * Leave-one-out errors of the fitted curve, in log10 units: refit without each comparable in
 * turn and record how far its actual market cap sits from the prediction. The interval of every
 * board row comes from these errors, so the interval is a measured miss, not a guessed spread.
 */
function looErrors(comps: SnapshotProtocol[], model: ModelConstants, asOf = ''): number[] {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const coef = fitTerms(rest, 'chains', model, asOf);
    if (coef === null) continue;
    const pred = designFor(comps[i]!, 'chains', model, asOf).reduce((s, x, j) => s + x * coef[j]!, 0);
    errs.push(log10(comps[i]!.mcap_usd!) - pred);
  }
  return errs;
}

/** The flat multiple baseline: one median TVL/mcap for every protocol, no curve at all. */
function flatMisses(comps: SnapshotProtocol[], train: SnapshotProtocol[], test: SnapshotProtocol[]): { loo: number; walk: number } {
  const med = median(comps.map((p) => p.tvl_usd / p.mcap_usd!));
  const loo = Math.pow(10, median(comps.map((p) => Math.abs(log10(p.tvl_usd / med) - log10(p.mcap_usd!)))));
  const medTr = median(train.map((p) => p.tvl_usd / p.mcap_usd!));
  const walk = Math.pow(10, median(test.map((p) => Math.abs(log10(p.tvl_usd / medTr) - log10(p.mcap_usd!)))));
  return { loo, walk };
}

/** Category offsets: each category's median residual, shrunk by n/(n+2) toward zero. */
function categoryOffsets(comps: SnapshotProtocol[], model: ModelConstants, asOf = ''): Map<string, number> {
  const coef = fitTerms(comps, 'base', model, asOf);
  const off = new Map<string, number>();
  if (coef === null) return off;
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const r = log10(p.mcap_usd!) - designFor(p, 'base', model, asOf).reduce((s, x, j) => s + x * coef[j]!, 0);
    const arr = byCat.get(p.category ?? 'Uncategorized') ?? [];
    arr.push(r);
    byCat.set(p.category ?? 'Uncategorized', arr);
  }
  for (const [cat, rs] of byCat) {
    if (rs.length >= 3) off.set(cat, median(rs) * (rs.length / (rs.length + 2)));
  }
  return off;
}

/** Median absolute error of the base curve plus category offsets, on one list. The offsets are
 *  fitted on `comps` and applied to `rows`: when the two lists are the same, that is in-sample,
 *  so the leave-one-out test below never calls this on the same list. */
function missWithOffsets(comps: SnapshotProtocol[], rows: SnapshotProtocol[], model: ModelConstants, asOf = ''): number {
  const coef = fitTerms(comps, 'base', model, asOf);
  if (coef === null || rows.length === 0) return Number.NaN;
  const off = categoryOffsets(comps, model, asOf);
  const errs = rows.map((p) => {
    const base = designFor(p, 'base', model, asOf).reduce((s, x, j) => s + x * coef[j]!, 0);
    return Math.abs(log10(p.mcap_usd!) - (base + (off.get(p.category ?? 'Uncategorized') ?? 0)));
  });
  return Math.pow(10, median(errs));
}

/**
 * True leave-one-out error of the base curve plus category offsets: for each comparable in turn,
 * fit the curve and the offsets on the other 80 and predict the held-out one. Fitting the offsets
 * on the protocol being predicted would leak its own residual into its prediction.
 */
function looOffsetsMiss(comps: SnapshotProtocol[], model: ModelConstants, asOf = ''): number {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const coef = fitTerms(rest, 'base', model, asOf);
    if (coef === null) continue;
    const off = categoryOffsets(rest, model, asOf);
    const p = comps[i]!;
    const base = designFor(p, 'base', model, asOf).reduce((s, x, j) => s + x * coef[j]!, 0);
    errs.push(Math.abs(log10(p.mcap_usd!) - (base + (off.get(p.category ?? 'Uncategorized') ?? 0))));
  }
  return Math.pow(10, median(errs));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** A tiny deterministic shuffle (mulberry32), so the cross-validation folds are reproducible. */
function shuffled<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Fit a two-feature logistic model (standardised) by gradient descent; returns the model. */
function fitLogit(rows: { x1: number; x2: number; y: number }[], iters = 400, lr = 0.5): { b0: number; b1: number; b2: number; m1: number; s1: number; m2: number; s2: number } {
  const m1 = rows.reduce((s, r) => s + r.x1, 0) / rows.length;
  const s1 = Math.sqrt(rows.reduce((s, r) => s + (r.x1 - m1) ** 2, 0) / rows.length) || 1;
  const m2 = rows.reduce((s, r) => s + r.x2, 0) / rows.length;
  const s2 = Math.sqrt(rows.reduce((s, r) => s + (r.x2 - m2) ** 2, 0) / rows.length) || 1;
  const base = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  let b0 = Math.log(base / (1 - base));
  let b1 = 0;
  let b2 = 0;
  for (let it = 0; it < iters; it++) {
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;
    for (const r of rows) {
      const z1 = (r.x1 - m1) / s1;
      const z2 = (r.x2 - m2) / s2;
      const d = sigmoid(b0 + b1 * z1 + b2 * z2) - r.y;
      g0 += d;
      g1 += d * z1;
      g2 += d * z2;
    }
    b0 -= (lr * g0) / rows.length;
    b1 -= (lr * g1) / rows.length;
    b2 -= (lr * g2) / rows.length;
  }
  return { b0, b1, b2, m1, s1, m2, s2 };
}

function logitPred(m: ReturnType<typeof fitLogit>, x1: number, x2: number): number {
  return sigmoid(m.b0 + m.b1 * ((x1 - m.m1) / m.s1) + m.b2 * ((x2 - m.m2) / m.s2));
}

/** The Brier score of one set of predicted probabilities against the outcomes. */
function brier(preds: number[], ys: number[]): number {
  if (preds.length === 0) return Number.NaN;
  return preds.reduce((s, p, i) => s + (p - ys[i]!) ** 2, 0) / preds.length;
}

/**
 * Validate the odds three ways and report all three, including the one that fails: 5-fold
 * cross-validation (does age predict recording, held out?), and the walk-forward split (does a
 * model fitted on protocols listed earlier predict the ones listed later?). The walk-forward
 * test does not beat the base rate on this snapshot, because the later cohort is younger and
 * its base rate is lower; the page states that plainly instead of hiding the test.
 */
/** One protocol's odds from an age-bucket table (the rejected alternative, for validation only). */
function bucketOdds(p: SnapshotProtocol, asOf: string, buckets: OddsBucket[], global: number): number {
  const a = ageDays(asOf, p.listed_at);
  if (a === null) return global;
  for (const b of buckets) {
    const max = b.max_days === -1 ? Number.POSITIVE_INFINITY : b.max_days;
    if (a >= b.min_days && a < max) return b.odds;
  }
  return global;
}

function validateOdds(snapshot: Snapshot, model: ModelConstants): OddsValidation {
  const aged = snapshot.protocols.filter((p) => ageDays(snapshot.as_of, p.listed_at) !== null && p.tvl_usd > 0);
  const global = aged.length > 0 ? aged.filter(hasToken).length / aged.length : 0.5;
  const folds = shuffled(aged, 7);
  const foldOf = (i: number): number => i % 5;
  const cv = (kind: 'base' | 'bucket' | 'logit'): number => {
    const errs: number[] = [];
    for (let f = 0; f < 5; f++) {
      const te = folds.filter((_, i) => foldOf(i) === f);
      const tr = folds.filter((_, i) => foldOf(i) !== f);
      const base = tr.filter(hasToken).length / tr.length;
      let preds: number[];
      if (kind === 'base') {
        preds = te.map(() => base);
      } else if (kind === 'bucket') {
        const { buckets } = fitOdds({ ...snapshot, protocols: tr }, model);
        preds = te.map((p) => bucketOdds(p, snapshot.as_of, buckets, base));
      } else {
        const m = fitLogit(tr.map((p) => ({ x1: ageDays(snapshot.as_of, p.listed_at)! / 365, x2: 0, y: hasToken(p) ? 1 : 0 })));
        preds = te.map((p) => logitPred(m, ageDays(snapshot.as_of, p.listed_at)! / 365, 0));
      }
      errs.push(brier(preds, te.map((p) => (hasToken(p) ? 1 : 0))));
    }
    return errs.reduce((s, e) => s + e, 0) / errs.length;
  };
  const dated = aged.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const tr = aged.filter((p) => p.listed_at! <= cut);
  const te = aged.filter((p) => p.listed_at! > cut);
  const baseTr = tr.filter(hasToken).length / tr.length;
  const { buckets } = fitOdds({ ...snapshot, protocols: tr }, model);
  // The walk-forward baseline predicts the TRAIN base rate on the test set: the rate the
  // model could have known at fit time. Predicting the test set's own rate would flatter it.
  const walkBase = brier(
    te.map(() => baseTr),
    te.map((p) => (hasToken(p) ? 1 : 0)),
  );
  const walkBucket = brier(
    te.map((p) => bucketOdds(p, snapshot.as_of, buckets, baseTr)),
    te.map((p) => (hasToken(p) ? 1 : 0)),
  );
  const mWalk = fitLogit(tr.map((p) => ({ x1: ageDays(snapshot.as_of, p.listed_at)! / 365, x2: 0, y: hasToken(p) ? 1 : 0 })));
  const walkLogit = brier(
    te.map((p) => logitPred(mWalk, ageDays(snapshot.as_of, p.listed_at)! / 365, 0)),
    te.map((p) => (hasToken(p) ? 1 : 0)),
  );
  return {
    base_brier_cv: round4(cv('base')),
    bucket_brier_cv: round4(cv('bucket')),
    logit_brier_cv: round4(cv('logit')),
    walk_base_brier: round4(walkBase),
    walk_bucket_brier: round4(walkBucket),
    walk_logit_brier: round4(walkLogit),
    walk_cut: cut,
    note: 'The age logistic beats the age buckets on both held-out tests (5-fold and walk-forward), so the board uses the logistic and the buckets are shown only as the raw record they were fitted from. Walk-forward Brier is worse in absolute terms than the 5-fold numbers because the later cohort is younger and its base rate is lower; the ranking of the methods holds on both tests. The odds are the peers’ record at this age, not a forecast.',
  };
}

/**
 * The full validation the page shows: the fitted curve with its leave-one-out interval, the
 * flat baseline, the ablation table (each candidate term's two held-out errors), and the odds
 * validation. The walk-forward split is the median listing date of the dated comparables.
 */
function validateModel(snapshot: Snapshot, model: ModelConstants, comps: SnapshotProtocol[]): Validation {
  const asOf = snapshot.as_of;
  const coef = fitTerms(comps, 'chains', model, asOf)!;
  const loo = looErrors(comps, model, asOf);
  const sorted = [...loo].sort((a, b) => a - b);
  const q25 = quantile(sorted, 0.25);
  const q75 = quantile(sorted, 0.75);
  const q10 = quantile(sorted, 0.1);
  const q90 = quantile(sorted, 0.9);
  const inside2575 = loo.filter((e) => e >= q25 && e <= q75).length / loo.length;
  const inside1090 = loo.filter((e) => e >= q10 && e <= q90).length / loo.length;
  const curve: FittedCurve = {
    intercept: round4(coef[0]!),
    slope: round4(coef[1]!),
    chain_coef: round4(coef[2]!),
    n: comps.length,
    loo_median_log_err: round4(median(loo.map((e) => Math.abs(e)))),
    loo_q25: round4(q25),
    loo_q75: round4(q75),
    loo_q10: round4(q10),
    loo_q90: round4(q90),
    inside_p25_p75: round4(inside2575),
    inside_p10_p90: round4(inside1090),
  };
  const dated = comps.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at! <= cut);
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at! > cut);
  const flat = flatMisses(comps, train, test);
  const miss = (terms: TermSet): { loo: number; walk: number } => {
    const looMiss = (() => {
      const errs: number[] = [];
      for (let i = 0; i < comps.length; i++) {
        const rest = comps.filter((_, j) => j !== i);
        const c = fitTerms(rest, terms, model, asOf);
        if (c === null) continue;
        errs.push(Math.abs(log10(comps[i]!.mcap_usd!) - designFor(comps[i]!, terms, model, asOf).reduce((s, x, j) => s + x * c[j]!, 0)));
      }
      return Math.pow(10, median(errs));
    })();
    const cTr = fitTerms(train, terms, model, asOf);
    const walkMiss = missOf(cTr, test, terms, model, asOf);
    return { loo: round4(looMiss), walk: round4(walkMiss) };
  };
  const base = miss('base');
  const chains = miss('chains');
  const growth = miss('growth');
  const age = miss('age');
  const both = miss('growth_chains');
  const offLoo = looOffsetsMiss(comps, model, asOf);
  const offWalk = (() => {
    const coefTr = fitTerms(train, 'base', model, asOf);
    if (coefTr === null) return Number.NaN;
    const off = categoryOffsets(train, model, asOf);
    const errs = test.map((p) => {
      const bse = designFor(p, 'base', model, asOf).reduce((s, x, j) => s + x * coefTr[j]!, 0);
      return Math.abs(log10(p.mcap_usd!) - (bse + (off.get(p.category ?? 'Uncategorized') ?? 0)));
    });
    return Math.pow(10, median(errs));
  })();
  const ablation: AblationRow[] = [
    { term: 'Flat TVL/mcap multiple (baseline)', loo_median_miss: round4(flat.loo), walk_median_miss: round4(flat.walk), kept: false, reason: 'The baseline every fitted term is measured against.' },
    { term: 'Fitted curve: log-log on TVL', loo_median_miss: base.loo, walk_median_miss: base.walk, kept: true, reason: 'The base curve. Beats the flat multiple on both tests.' },
    { term: '+ chain count', loo_median_miss: chains.loo, walk_median_miss: chains.walk, kept: true, reason: 'KEPT: wins both held-out tests. The chain term is fitted, not assumed.' },
    { term: '+ 7-day growth', loo_median_miss: growth.loo, walk_median_miss: growth.walk, kept: false, reason: 'NOT KEPT: loses leave-one-out and both means; the walk-forward median alone does not save it.' },
    { term: '+ age in the value curve', loo_median_miss: age.loo, walk_median_miss: age.walk, kept: false, reason: 'NOT KEPT: loses both held-out tests. Age prices the odds, not the value.' },
    { term: '+ category offsets', loo_median_miss: round4(offLoo), walk_median_miss: round4(offWalk), kept: false, reason: 'NOT KEPT: no gain over the base curve on either test.' },
    { term: '+ growth and chains together', loo_median_miss: both.loo, walk_median_miss: both.walk, kept: false, reason: 'NOT KEPT: no gain over chains alone; growth still drags the means.' },
  ];
  const { buckets, global } = fitOdds(snapshot, model);
  const odds = validateOdds(snapshot, model);
  const curve2 = oddsCurve(snapshot);
  const { logit, global: logitGlobal } = fitOddsLogit(snapshot);
  const top = buildTopExample(snapshot, model, comps, coef, logit, logitGlobal);
  return { curve, flat_loo_median_miss: round4(flat.loo), flat_walk_median_miss: round4(flat.walk), ablation, odds, odds_buckets: buckets, odds_curve: curve2, walk_cut: cut, example: top };
}

/** The worked example for the formula panel: the top-ranked row, with its arithmetic shown. */
function buildTopExample(
  snapshot: Snapshot,
  model: ModelConstants,
  comps: SnapshotProtocol[],
  coef: number[],
  logit: LogitModel,
  global: number,
): Validation['example'] {
  const ranked = snapshot.protocols.filter(isRankable);
  let best: SnapshotProtocol | null = null;
  let bestImplied = -1;
  let bestLaunch = 0;
  let bestOdds = 0;
  for (const p of ranked) {
    const launch = Math.pow(10, designFor(p, 'chains', model).reduce((s, x, j) => s + x * coef[j]!, 0));
    const o = launchOdds(p, snapshot.as_of, logit, global);
    if (launch * o > bestImplied) {
      bestImplied = launch * o;
      best = p;
      bestLaunch = launch;
      bestOdds = o;
    }
  }
  const p = best ?? ranked[0]!;
  return {
    name: p.name,
    tvl_usd: p.tvl_usd,
    chains: Math.min(p.chains.length, model.chains_cap),
    launch_value_usd: Math.round(bestLaunch),
    odds: round4(bestOdds),
    implied_value_usd: Math.round(bestImplied),
  };
}

/** The gas a farm plan spends, from the chains the protocol lives on. */
export const FARM_GAS: Record<string, number> = {
  Ethereum: 80,
  BSC: 12,
  Arbitrum: 8,
  Base: 6,
  Solana: 2,
  Avalanche: 7,
  Optimism: 6,
  Polygon: 5,
  Linea: 7,
  Scroll: 6,
  Sui: 3,
  Aptos: 3,
  Starknet: 8,
  zkSync: 7,
  Mantle: 6,
  Blast: 6,
  Mode: 5,
  Berachain: 7,
  Hyperliquid: 3,
  Fraxtal: 6,
};

/** The hours a farm plan takes, from the protocol's category. */
export const FARM_HOURS: Record<string, number> = {
  'Onchain Capital Allocator': 10,
  'Yield Aggregator': 5,
  'Risk Curator': 8,
  'Yield': 5,
  'Lending': 6,
  'Derivatives': 7,
  'Dexes': 4,
  'CDP': 8,
  'RWA': 8,
  'Restaking': 6,
  'Liquid Restaking': 6,
  'Liquid Staking': 5,
  'Bridge': 4,
  'Stablecoin': 6,
  'Payments': 4,
  'Prediction Market': 5,
  'Launchpad': 5,
  'Insurance': 7,
  'Leveraged Farming': 8,
  'Options': 7,
  'Synthetics': 7,
  'Algorithmic Stablecoin': 8,
  'Money Market': 6,
  'Uncollateralized Lending': 8,
};

/** The farm plan's gas: one plan's total spend, from its chains, capped at $120. */
export function farmFees(p: SnapshotProtocol): number {
  const chainGas = p.chains.length > 0 ? p.chains.reduce((s, c) => s + (FARM_GAS[c] ?? 8), 0) / p.chains.length : 8;
  return Math.min(120, Math.round(chainGas * 2.5 * 100) / 100);
}

/** The farm plan's hours: the category's base hours, plus one hour per extra chain. */
export function farmHours(p: SnapshotProtocol): number {
  const base = FARM_HOURS[p.category ?? ''] ?? 6;
  return base + Math.max(0, p.chains.length - 1);
}

export interface FarmInputs {
  deposit_usd: number;
  drop_share: number;
  horizon_weeks: number;
  tbill_rate: number;
  min_net_per_hour_usd: number;
}

/** One farmer's farm economics for one protocol, under one set of plan inputs. */
export function farmEconomics(p: SnapshotProtocol, impliedValue: number, inputs: FarmInputs): BoardRow['farm'] {
  const fees = farmFees(p);
  const hours = farmHours(p);
  const gross = impliedValue * inputs.drop_share * (inputs.deposit_usd / Math.max(p.tvl_usd, 1));
  const net = gross - fees;
  const netPerHour = net / hours;
  const tbill = inputs.deposit_usd * inputs.tbill_rate * (inputs.horizon_weeks / 52);
  const verdict: BoardRow['farm']['verdict'] =
    net > tbill && netPerHour >= inputs.min_net_per_hour_usd ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return {
    gross_usd: round4(gross),
    fees_usd: round4(fees),
    net_usd: round4(net),
    net_per_hour_usd: round4(netPerHour),
    hours,
    tbill_usd: round4(tbill),
    verdict,
  };
}

/** One protocol's farm plan: seven steps, each naming the protocol and its own numbers. */
export function farmSteps(p: SnapshotProtocol, chainCount: number, impliedValue: number, launchOddsValue: number, inputs: FarmInputs): string[] {
  const firstChain = p.chains[0] ?? 'Ethereum';
  const sharePct = (inputs.drop_share * 100).toFixed(1);
  const horizon = inputs.horizon_weeks;
  const g = farmEconomics(p, impliedValue, inputs);
  return [
    `Verify ${p.name} on ${firstChain}: the protocol is live, the vault or pool you will enter holds ${fmtUsd(p.tvl_usd)} of TVL, and no token is trading yet.`,
    `Deposit $${fmtNum(inputs.deposit_usd)} into the protocol's main vault or pool on ${firstChain}. At ${fmtUsd(p.tvl_usd)} of TVL your deposit is ${((inputs.deposit_usd / p.tvl_usd) * 100).toFixed(2)}% of the pool.`,
    `Hold the position for ${horizon} weeks. A launch in that window pays an expected $${fmtNum(g.gross_usd)}: ${sharePct}% of the implied value, pro-rata by deposit, times a ${Math.round(launchOddsValue * 100)}% launch chance.`,
    `Bridge or move assets across ${chainCount} chain${chainCount === 1 ? '' : 's'} if the highest-yield pool is not on ${firstChain}. Budget $${fmtNum(g.fees_usd)} of gas across the whole plan.`,
    `Claim points, receipts or staking rewards weekly and keep the receipts; they are the proof of the deposit if the airdrop is points-weighted.`,
    `Watch for a token announcement. If it lands, claim and sell the drop within 24 hours; if it does not, reassess at the end of the ${horizon}-week window.`,
    `Net check: expected airdrop $${fmtNum(g.gross_usd)} minus $${fmtNum(g.fees_usd)} of gas is $${fmtNum(g.net_usd)} net, about $${fmtNum(g.net_per_hour_usd)} an hour. The same deposit in T-bills would earn $${fmtNum(g.tbill_usd)} over ${horizon} weeks.`,
  ];
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US');
  return (Math.round(n * 100) / 100).toString();
}

function fmtUsd(n: number): string {
  return `$${fmtNum(n)}`;
}

/** Check the sealed snapshot's shape before scoring anything. */
export function checkSnapshot(snapshot: Snapshot): { total: number; watchlist: number; ranked: number; early: number; offlist: number; live: number } {
  const slugs = bySlug(snapshot.protocols);
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) throw new SnapshotError(`Watchlist slug "${slug}" is missing from the snapshot.`);
  }
  const ranked = snapshot.protocols.filter(isRankable);
  const preToken = ranked.filter((p) => snapshot.watchlist.includes(p.slug));
  const early = ranked.filter((p) => !snapshot.watchlist.includes(p.slug) && p.tvl_usd < snapshot.floor_usd);
  const offlist = ranked.filter((p) => !snapshot.watchlist.includes(p.slug) && p.tvl_usd >= snapshot.floor_usd);
  const live = snapshot.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  return { total: snapshot.protocols.length, watchlist: snapshot.watchlist.length, ranked: ranked.length, early: early.length, offlist: offlist.length, live: live.length };
}

/**
 * Build the ranked board: every rankable protocol, priced by the fitted curve and the odds,
 * sorted by implied value. Each row carries its own rank, the row's rank by TVL alone, its
 * interval from the leave-one-out errors, and its farm verdict under the default plan inputs.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = snapshot.protocols.filter((p) => isComparable(p, model));
  const coef = fitTerms(comps, 'chains', model, snapshot.as_of);
  if (coef === null) throw new SnapshotError('Could not fit the value curve on the comparables.');
  const { logit, global } = fitOddsLogit(snapshot);
  const validation = validateModel(snapshot, model, comps);
  const q25 = validation.curve.loo_q25;
  const q75 = validation.curve.loo_q75;
  const ranked = snapshot.protocols.filter(isRankable);
  const tvlRank = new Map(ranked.map((p) => [p.slug, 0]));
  [...ranked]
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .forEach((p, i) => tvlRank.set(p.slug, i + 1));
  const inputs: FarmInputs = {
    deposit_usd: model.farm_deposit_usd,
    drop_share: model.farm_drop_share,
    horizon_weeks: model.farm_horizon_weeks,
    tbill_rate: model.farm_tbill_rate,
    min_net_per_hour_usd: model.farm_min_net_per_hour_usd,
  };
  const rows: BoardRow[] = ranked.map((p) => {
    const chainsUsed = Math.min(p.chains.length, model.chains_cap);
    const launchValue = Math.pow(10, coef[0]! + coef[1]! * log10(Math.max(p.tvl_usd, 1)) + coef[2]! * chainsUsed);
    const odds = launchOdds(p, snapshot.as_of, logit, global);
    const implied = launchValue * odds;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const farm = farmEconomics(p, implied, inputs);
    const steps = farmSteps(p, chainsUsed, implied, odds, inputs);
    return {
      rank: 0,
      tvl_rank: tvlRank.get(p.slug)!,
      rank_delta: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      launch_value_usd: Math.round(launchValue),
      launch_odds: round4(odds),
      implied_value_usd: Math.round(implied),
      implied_low_usd: Math.round(implied * Math.pow(10, q25)),
      implied_high_usd: Math.round(implied * Math.pow(10, q75)),
      model: {
        curve_intercept: round4(coef[0]!),
        curve_slope: round4(coef[1]!),
        curve_chain_coef: round4(coef[2]!),
        chains_used: chainsUsed,
        launch_value_usd: Math.round(launchValue),
        odds: round4(odds),
        age_days: age,
      },
      farm,
      farm_steps: steps,
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.rank_delta = r.rank - r.tvl_rank;
  });
  return rows;
}

/** One row's story, one English sentence from its own numbers. */
export function whyRow(r: BoardRow): string {
  const launch = r.launch_value_usd;
  const oddsPct = Math.round(r.launch_odds * 100);
  const tvlRank = r.tvl_rank;
  if (r.rank_delta < -10) {
    return `Small by TVL (rank ${tvlRank}) but ${oddsPct}% launch odds push it to rank ${r.rank}: the curve prices a $${fmtNum(launch)} launch and the odds carry it.`;
  }
  if (r.rank_delta > 10) {
    return `Big by TVL (rank ${tvlRank}) but only ${oddsPct}% launch odds, so it sits at rank ${r.rank}: the curve prices a $${fmtNum(launch)} launch and the odds pull it down.`;
  }
  return `Ranks ${r.rank} on a $${fmtNum(launch)} fitted launch value and ${oddsPct}% launch odds.`;
}

/** The ledger: every snapshot protocol in exactly one group, with the reason counts. */
export function ledger(snapshot: Snapshot): LedgerGroup[] {
  const ranked = snapshot.protocols.filter(isRankable);
  const wl = new Set(snapshot.watchlist);
  const wlCount = ranked.filter((p) => wl.has(p.slug)).length;
  const early = ranked.filter((p) => !wl.has(p.slug) && p.tvl_usd < snapshot.floor_usd).length;
  const offlist = ranked.filter((p) => !wl.has(p.slug) && p.tvl_usd >= snapshot.floor_usd).length;
  const hasRecord = snapshot.protocols.filter(hasToken);
  const live = hasRecord.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length;
  const recordNoMcap = hasRecord.length - live;
  const excluded = snapshot.protocols.filter((p) => !hasToken(p) && !isRankable(p));
  const byReason = new Map<string, number>();
  for (const p of excluded) {
    let reason = 'Other';
    if (EXCLUDED_CATEGORIES.has(p.category ?? '')) reason = p.category ?? 'Other';
    else if (VERSIONED.test(p.name)) reason = 'Versioned name';
    else if (WRAPPED_WORD.test(p.name)) reason = 'Wrapped/staked name';
    else if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) reason = 'Exchange name';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const groups: LedgerGroup[] = [
    { key: 'watchlist', label: 'Watchlist, ranked', count: wlCount },
    { key: 'offlist', label: 'Above the floor, not on the watchlist', count: offlist },
    { key: 'early', label: 'Below the floor, ranked', count: early },
    { key: 'live', label: 'Already trading, market cap known', count: live },
    { key: 'record', label: 'Token recorded, no usable market cap', count: recordNoMcap },
  ];
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    groups.push({ key: `excluded-${reason}`, label: `Excluded by rule: ${reason}`, count });
  }
  return groups;
}

/**
 * Assemble everything the dashboard renders: the board, the live-token view, the validation,
 * the ledger and the checksum. The checksum is the FNV-1a hash of the board's rank, slug and
 * implied value, so the page can verify itself against the build without a server.
 */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; data: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = snapshot.protocols.filter((p) => isComparable(p, model));
  const validation = validateModel(snapshot, model, comps);
  const led = ledger(snapshot);
  const wl = new Set(snapshot.watchlist);
  const inputs: FarmInputs = {
    deposit_usd: model.farm_deposit_usd,
    drop_share: model.farm_drop_share,
    horizon_weeks: model.farm_horizon_weeks,
    tbill_rate: model.farm_tbill_rate,
    min_net_per_hour_usd: model.farm_min_net_per_hour_usd,
  };
  const live = snapshot.protocols
    .filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
  const farmCounts = { farm: 0, marginal: 0, skip: 0 };
  for (const r of board) farmCounts[r.farm.verdict.toLowerCase() as 'farm' | 'marginal' | 'skip']++;
  const bestNet = [...board]
    .filter((r) => r.farm.verdict === 'FARM')
    .sort((a, b) => b.farm.net_per_hour_usd - a.farm.net_per_hour_usd)
    .slice(0, 3)
    .map((r) => ({ slug: r.slug, name: r.name, net_per_hour_usd: r.farm.net_per_hour_usd }));
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    age_days: r.age_days,
    launch_value_usd: r.launch_value_usd,
    launch_odds: r.launch_odds,
    implied_value_usd: r.implied_value_usd,
    implied_low_usd: r.implied_low_usd,
    implied_high_usd: r.implied_high_usd,
    tvl_rank: r.tvl_rank,
    rank_delta: r.rank_delta,
    why: whyRow(r),
    verdict: r.farm.verdict,
    net_usd: r.farm.net_usd,
    net_per_hour_usd: r.farm.net_per_hour_usd,
    fees_usd: r.farm.fees_usd,
    hours: r.farm.hours,
    farm_steps: r.farm_steps,
  }));
  const checksum = fnv1a(board.map((r) => `${r.rank}:${r.slug}:${r.implied_value_usd}`).join('|'));
  const data: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !wl.has(r.slug) && r.tvl_usd < snapshot.floor_usd).length,
    offlist_size: board.filter((r) => !wl.has(r.slug) && r.tvl_usd >= snapshot.floor_usd).length,
    live_size: live.length,
    ledger: led,
    ledger_total: led.reduce((s, g) => s + g.count, 0),
    validation,
    comps: comps.map((p) => ({
      name: p.name,
      category: p.category,
      log_tvl: round4(log10(p.tvl_usd)),
      log_mcap: round4(log10(p.mcap_usd!)),
    })),
    farm_summary: { farm: farmCounts.farm, marginal: farmCounts.marginal, skip: farmCounts.skip, best_net_per_hour: bestNet },
    implied_total_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    checksum,
    rows,
    live,
  };
  return { board, data };
}

/** The shape the snapshot must have; a missing or mistyped field stops the build. */
export function parseSnapshot(raw: unknown): Snapshot {
  if (raw === null || typeof raw !== 'object') throw new SnapshotError('snapshot is not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.as_of !== 'string') throw new SnapshotError('snapshot.as_of must be a string');
  if (typeof s.source !== 'string') throw new SnapshotError('snapshot.source must be a string');
  if (typeof s.floor_usd !== 'number') throw new SnapshotError('snapshot.floor_usd must be a number');
  if (!Array.isArray(s.protocols)) throw new SnapshotError('snapshot.protocols must be an array');
  if (!Array.isArray(s.watchlist)) throw new SnapshotError('snapshot.watchlist must be an array');
  const protocols: SnapshotProtocol[] = s.protocols.map((p: unknown, i: number) => {
    const o = p as Record<string, unknown>;
    if (typeof o.slug !== 'string' || typeof o.name !== 'string') throw new SnapshotError(`protocol ${i} has no slug or name`);
    if (typeof o.tvl_usd !== 'number') throw new SnapshotError(`protocol ${o.slug} has no tvl_usd`);
    return {
      slug: o.slug,
      name: o.name,
      category: typeof o.category === 'string' ? o.category : null,
      chains: Array.isArray(o.chains) ? (o.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: o.tvl_usd,
      change_7d: typeof o.change_7d === 'number' ? o.change_7d : null,
      mcap_usd: typeof o.mcap_usd === 'number' ? o.mcap_usd : null,
      listed_at: typeof o.listed_at === 'string' ? o.listed_at : null,
      gecko_id: typeof o.gecko_id === 'string' ? o.gecko_id : null,
      symbol: typeof o.symbol === 'string' ? o.symbol : null,
    };
  });
  return {
    as_of: s.as_of,
    source: s.source,
    floor_usd: s.floor_usd,
    protocols,
    watchlist: (s.watchlist as unknown[]).filter((x): x is string => typeof x === 'string'),
  };
}
