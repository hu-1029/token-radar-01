// Token radar, round 4: the implied value of every pre-token protocol, fitted at
// runtime from the sealed snapshot and tested held-out twice. Nothing in this
// file names a protocol: every score is the same function of the snapshot's own
// figures (TVL, chains, age, 7-day change), and every claimed number is computed
// here, from the data, not typed in.
//
// The curve: a Huber fit (c = 1.345) of log10(market cap) on log10(TVL) and the
// chain count, over the launched protocols that carry a listing date. The odds:
// a logistic fit of "the protocol records a token" on age, log10(TVL), 7-day
// growth and chain count, over the dated protocols the watchlist rules do not
// exclude. Implied value = launch x odds. Both fits are re-run on 200 seeded
// bootstrap resamples for the rank ranges and the top-20 stability count.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

// ------------------------------------------------------------------ numbers

const DAY_MS = 86_400_000;
const LOG10 = Math.log10;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A quantile by linear interpolation on the sorted values, like a statistics package. */
function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Solve A x = b by Gaussian elimination with partial pivoting. A is n x n, b is n. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (piv !== col) {
      const t = M[col]!;
      M[col] = M[piv]!;
      M[piv] = t;
    }
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) throw new Error('singular system');
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** Least squares through the normal equations: (X' W X) b = X' W y, with a hair of ridge so a column that goes constant in one fold cannot singe the solve. */
function weightedLstsq(X: number[][], y: number[], w: number[]): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i]!;
    const wi = w[i]!;
    for (let a = 0; a < k; a++) {
      b[a]! += wi * xi[a]! * y[i]!;
      for (let c = 0; c < k; c++) A[a]![c]! += wi * xi[a]! * xi[c]!;
    }
  }
  for (let a = 0; a < k; a++) A[a]![a]! += 1e-9;
  return solve(A, b);
}

/** A seeded generator, so the bootstrap and the cross-validation folds are identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded shuffle, Fisher-Yates. */
function shuffled<T>(items: T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** Resample with replacement, seeded. */
function resampled<T>(items: T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) out.push(items[Math.floor(rnd() * items.length)]!);
  return out;
}

// ------------------------------------------------------------------ dates

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function ageYears(p: SnapshotProtocol, asOf: string): number | null {
  const d = ageDays(asOf, p.listed_at);
  return d === null ? null : d / 365;
}

// ------------------------------------------------------------------ eligibility

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token in the index (a CoinGecko id or a ticker). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The watchlist's own exclusion rule, as a reason, or null when the protocol passes it. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return p.category;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked word';
  for (const e of EXCHANGE_PREFIXES) if (p.name.startsWith(e)) return 'exchange prefix';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and passing the watchlist's eligibility rules. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

// ------------------------------------------------------------------ Huber curve

/** Huber IRLS (c = 1.345), starting from ordinary least squares. */
export function huberFit(X: number[][], y: number[], c = 1.345, iters = 60): number[] {
  let beta = weightedLstsq(X, y, new Array<number>(X.length).fill(1));
  for (let it = 0; it < iters; it++) {
    const r = y.map((v, i) => v - dot(X[i]!, beta));
    const med = median(r);
    const mad = median(r.map((v) => Math.abs(v - med))) * 1.4826;
    const scale = mad > 1e-9 ? mad : Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length) + 1e-9;
    const w = r.map((v) => {
      const u = Math.abs(v) / (c * scale);
      return u <= 1 ? 1 : 1 / u;
    });
    const next = weightedLstsq(X, y, w);
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (shift < 1e-10) break;
  }
  return beta;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Logistic IRLS. */
export function logitFit(X: number[][], y: number[], iters = 100): number[] {
  let beta = new Array<number>(X[0]!.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const z = X.map((row) => dot(row, beta));
    const p = z.map((v) => 1 / (1 + Math.exp(-clamp(v, -30, 30))));
    const w = p.map((v) => v * (1 - v) + 1e-9);
    const adj = z.map((v, i) => v + (y[i]! - p[i]!) / w[i]!);
    const next = weightedLstsq(X, adj, w);
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (shift < 1e-10) break;
  }
  return beta;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

function brier(y: number[], p: number[]): number {
  return y.reduce((s, v, i) => s + (v - p[i]!) * (v - p[i]!), 0) / y.length;
}

// ------------------------------------------------------------------ the curve

/** The launched protocols the curve learns from: a market cap and a listing date, both present. */
function curveSample(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.listed_at !== null);
}

const GROWTH_LO = -60;
const GROWTH_HI = 120;

function growthClamped(p: SnapshotProtocol): number {
  return clamp(typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0, GROWTH_LO, GROWTH_HI);
}

function chainCount(p: SnapshotProtocol): number {
  return Math.min(p.chains.length, 4);
}

/** One curve specification: a name and the columns it fits, in order. */
interface CurveSpec {
  name: string;
  columns: (p: SnapshotProtocol, asOf: string, cats: string[]) => number[];
}

function curveSpecs(cats: string[]): CurveSpec[] {
  return [
    { name: 'log TVL + chains', columns: (p) => [1, LOG10(p.tvl_usd), chainCount(p)] },
    { name: 'log TVL only', columns: (p) => [1, LOG10(p.tvl_usd)] },
    { name: 'log TVL + chains + age', columns: (p, asOf) => [1, LOG10(p.tvl_usd), chainCount(p), ageYears(p, asOf) ?? 0] },
    { name: 'log TVL + chains + growth', columns: (p) => [1, LOG10(p.tvl_usd), chainCount(p), growthClamped(p)] },
    { name: 'log TVL + chains + age + growth', columns: (p, asOf) => [1, LOG10(p.tvl_usd), chainCount(p), ageYears(p, asOf) ?? 0, growthClamped(p)] },
    { name: 'log TVL + chains + growth x chains', columns: (p) => [1, LOG10(p.tvl_usd), chainCount(p), growthClamped(p), growthClamped(p) * chainCount(p)] },
    {
      name: 'log TVL + chains + category',
      columns: (p) => [1, LOG10(p.tvl_usd), chainCount(p), ...cats.map((c) => (p.category === c ? 1 : 0))],
    },
  ];
}

interface CurveValidation {
  looMedianMiss: number;
  forwardMedianMiss: number;
  flatLooMedianMiss: number;
  flatForwardMedianMiss: number;
  q25: number;
  q75: number;
  q10: number;
  q90: number;
  inP25P75: number;
  inP10P90: number;
  forwardCut: string;
}

/** Leave-one-out and forward (train before the median listing date, test after) misses for one spec. */
function validateCurve(sample: SnapshotProtocol[], asOf: string, spec: CurveSpec, cats: string[]): CurveValidation {
  const X = sample.map((p) => spec.columns(p, asOf, cats));
  const y = sample.map((p) => LOG10(p.mcap_usd!));
  const dates = sample.map((p) => p.listed_at!);
  const sorted = [...dates].sort();
  const cut = sorted[sorted.length >> 1]!;
  // Leave-one-out residuals.
  const looResid: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    const Xi = X.filter((_, j) => j !== i);
    const yi = y.filter((_, j) => j !== i);
    const beta = huberFit(Xi, yi);
    looResid.push(y[i]! - dot(X[i]!, beta));
  }
  const looMiss = looResid.map((r) => Math.pow(10, Math.abs(r)));
  // Forward: fit before the cut, test on and after it.
  const tr = sample.map((_, i) => dates[i]! < cut);
  const te = sample.map((_, i) => !tr[i]!);
  const betaTr = huberFit(X.filter((_, i) => tr[i]!), y.filter((_, i) => tr[i]!));
  const wfMiss = sample
    .map((_, i) => i)
    .filter((i) => te[i]!)
    .map((i) => Math.pow(10, Math.abs(y[i]! - dot(X[i]!, betaTr))));
  // The flat baseline: the median log(market cap / TVL) ratio, same splits.
  const logMult = sample.map((p) => LOG10(p.mcap_usd!) - LOG10(p.tvl_usd));
  const flatLoo = sample.map((_, i) => {
    const others = logMult.filter((_, j) => j !== i);
    return Math.pow(10, Math.abs(logMult[i]! - median(others)));
  });
  const flatTr = median(logMult.filter((_, i) => tr[i]!));
  const flatWf = sample.filter((_, i) => te[i]!).map((_, i) => Math.pow(10, Math.abs(logMult[i]! - flatTr)));
  const q25 = quantile(looResid, 0.25);
  const q75 = quantile(looResid, 0.75);
  const q10 = quantile(looResid, 0.1);
  const q90 = quantile(looResid, 0.9);
  return {
    looMedianMiss: median(looMiss),
    forwardMedianMiss: median(wfMiss),
    flatLooMedianMiss: median(flatLoo),
    flatForwardMedianMiss: median(flatWf),
    q25,
    q75,
    q10,
    q90,
    inP25P75: looResid.filter((r) => r >= q25 && r <= q75).length / looResid.length,
    inP10P90: looResid.filter((r) => r >= q10 && r <= q90).length / looResid.length,
    forwardCut: cut,
  };
}

// ------------------------------------------------------------------ the odds

/** The dated protocols the odds model learns from: a listing date, and not excluded by the watchlist rules. */
function oddsPopulation(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.listed_at !== null && exclusionReason(p) === null);
}

interface OddsFeatures {
  age: number;
  logtvl: number;
  growth: number;
  chains: number;
}

function oddsRaw(p: SnapshotProtocol, asOf: string, meanAge: number): OddsFeatures {
  return {
    age: ageYears(p, asOf) ?? meanAge,
    logtvl: LOG10(p.tvl_usd),
    growth: growthClamped(p),
    chains: chainCount(p),
  };
}

const ODDS_TERMS: Array<Array<keyof OddsFeatures>> = [
  ['age'],
  ['age', 'logtvl'],
  ['age', 'logtvl', 'growth'],
  ['age', 'logtvl', 'chains'],
  ['age', 'logtvl', 'growth', 'chains'],
];

interface OddsSpecResult {
  terms: string;
  brier5: number;
  brierForward: number;
  benchForward: number;
}

function designOdds(pop: SnapshotProtocol[], terms: Array<keyof OddsFeatures>, asOf: string, meanAge: number, stats?: Record<keyof OddsFeatures, { mean: number; sd: number }>): { X: number[][]; stats: Record<keyof OddsFeatures, { mean: number; sd: number }> } {
  const raw = pop.map((p) => oddsRaw(p, asOf, meanAge));
  const st: Record<keyof OddsFeatures, { mean: number; sd: number }> =
    stats ??
    (Object.fromEntries(
      (['age', 'logtvl', 'growth', 'chains'] as Array<keyof OddsFeatures>).map((k) => {
        const vals = raw.map((r) => r[k]);
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length) || 1;
        return [k, { mean, sd }];
      }),
    ) as Record<keyof OddsFeatures, { mean: number; sd: number }>);
  const X = raw.map((r) => [1, ...terms.map((t) => (r[t] - st[t].mean) / st[t].sd)]);
  return { X, stats: st };
}

/** Repeated 5-fold cross-validation (5 repeats, seeds 7..11): the fold assignment moves the single-split number by ~0.002, so the repeated mean is the stable headline for the kept specification. */
function repeatedBrier5(pop: SnapshotProtocol[], terms: Array<keyof OddsFeatures>, asOf: string, meanAge: number, repeats = 5): number {
  const y = pop.map((p) => (recordsToken(p) ? 1 : 0));
  const scores: number[] = [];
  for (let r = 0; r < repeats; r++) {
    const order = shuffled(pop.map((_, i) => i), 7 + r);
    const folds: number[][] = [[], [], [], [], []];
    order.forEach((idx, k) => folds[k % 5]!.push(idx));
    const pred = new Array<number>(pop.length).fill(0);
    for (let k = 0; k < 5; k++) {
      const te = folds[k]!;
      const tr = folds.flatMap((f, j) => (j === k ? [] : f));
      const { X: Xtr, stats } = designOdds(tr.map((i) => pop[i]!), terms, asOf, meanAge);
      const { X: Xte } = designOdds(te.map((i) => pop[i]!), terms, asOf, meanAge, stats);
      const beta = logitFit(Xtr, tr.map((i) => y[i]!));
      te.forEach((idx, j) => {
        pred[idx] = sigmoid(dot(Xte[j]!, beta));
      });
    }
    scores.push(brier(y, pred));
  }
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/** 5-fold cross-validation and the forward split for one odds specification. */
function validateOdds(pop: SnapshotProtocol[], asOf: string, meanAge: number, forwardCut: string): OddsSpecResult[] {
  const y = pop.map((p) => (recordsToken(p) ? 1 : 0));
  const order = shuffled(pop.map((_, i) => i), 7);
  const folds: number[][] = [[], [], [], [], []];
  order.forEach((idx, k) => folds[k % 5]!.push(idx));
  return ODDS_TERMS.map((terms) => {
    const pred = new Array<number>(pop.length).fill(0);
    for (let k = 0; k < 5; k++) {
      const te = folds[k]!;
      const tr = folds.flatMap((f, j) => (j === k ? [] : f));
      const { X: Xtr, stats } = designOdds(tr.map((i) => pop[i]!), terms, asOf, meanAge);
      const { X: Xte } = designOdds(te.map((i) => pop[i]!), terms, asOf, meanAge, stats);
      const beta = logitFit(Xtr, tr.map((i) => y[i]!));
      te.forEach((idx, j) => {
        pred[idx] = sigmoid(dot(Xte[j]!, beta));
      });
    }
    const trIdx = pop.map((p, i) => (p.listed_at! < forwardCut ? i : -1)).filter((i) => i >= 0);
    const teIdx = pop.map((p, i) => (p.listed_at! >= forwardCut ? i : -1)).filter((i) => i >= 0);
    const { X: Xtr, stats } = designOdds(trIdx.map((i) => pop[i]!), terms, asOf, meanAge);
    const { X: Xte } = designOdds(teIdx.map((i) => pop[i]!), terms, asOf, meanAge, stats);
    const beta = logitFit(Xtr, trIdx.map((i) => y[i]!));
    const wfPred = Xte.map((row) => sigmoid(dot(row, beta)));
    const base = trIdx.reduce((s, i) => s + y[i]!, 0) / trIdx.length;
    return {
      terms: terms.join(' + '),
      brier5: brier(y, pred),
      brierForward: brier(teIdx.map((i) => y[i]!), wfPred),
      benchForward: brier(
        teIdx.map((i) => y[i]!),
        teIdx.map(() => base),
      ),
    };
  });
}

// ------------------------------------------------------------------ farm economics

export interface FarmParams {
  deposit: number;
  dropShare: number;
  horizonWeeks: number;
  tbill: number;
}

export const FARM_DEFAULTS: FarmParams = { deposit: 10_000, dropShare: 0.07, horizonWeeks: 12, tbill: 0.04 };

export type FarmVerdict = 'FARM' | 'MARGINAL' | 'SKIP';

export interface FarmEconomics {
  airdrop: number;
  gas: number;
  oppCost: number;
  hours: number;
  net: number;
  netHour: number;
  verdict: FarmVerdict;
  /** The odds at which the cash net is zero, as a fraction; above 1 the plan never pays in cash. */
  breakEvenOdds: number;
  /** The ticket at which the cash net is zero; null when it never pays at any ticket. */
  paysFrom: number | null;
}

/**
 * One farm plan's economics. The farmer's share of the drop equals their
 * deposit's share of the protocol's TVL: the simplest stated rule, and the
 * sliders let the reader stress it. Cash net is the drop minus gas; the
 * T-bill line is the hurdle a FARM verdict must also clear, not a cost.
 */
export function farmEconomics(launch: number, odds: number, tvl: number, params: FarmParams): FarmEconomics {
  const implied = launch * odds;
  const airdrop = implied * params.dropShare * (params.deposit / tvl);
  const gas = 8 + 4 * params.horizonWeeks;
  const oppCost = params.deposit * params.tbill * (params.horizonWeeks / 52);
  const hours = 0.5 + params.horizonWeeks / 6;
  const net = airdrop - gas;
  const netHour = net / hours;
  const verdict: FarmVerdict = netHour >= 25 && net >= oppCost ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  const breakEvenOdds = airdrop > 0 ? (odds * gas) / airdrop : Number.POSITIVE_INFINITY;
  const perDollar = (implied * params.dropShare) / tvl;
  const paysFrom = perDollar > 0 ? gas / perDollar : null;
  return { airdrop, gas, oppCost, hours, net, netHour, verdict, breakEvenOdds, paysFrom };
}

// ------------------------------------------------------------------ farm plan

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  when: string;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC through ${name} on ${chain} and leave the loan open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and leave the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost, a time and
 * a when. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    { text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes', when: 'Day 0' },
    { text: action, cost: `$${capital} of capital and about $${capital >= 250 ? 8 : 4} of gas`, time: '15 minutes to set up', when: 'Day 0' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $4 of gas a week', time: '10 minutes a week', when: 'Weeks 1 to 12, once a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days`, when: `Day 0 to day ${hold}` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes', when: 'When the drop is announced' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes', when: 'After every action' },
    { text: `Unwind in stages: withdraw a small test amount first, check the receipt, then close the rest.`, cost: 'about $4 of gas to exit', time: '15 minutes', when: 'When you exit' },
  ];
}

/** A step as one string: its action, then its cost, time and when, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}. When: ${step.when}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ------------------------------------------------------------------ the board

export const MODEL_VERSION = 'radar-5';
const BOOTSTRAP_REFITS = 200;
const BOOTSTRAP_SEED = 20261123;

export interface BoardRow {
  rank: number;
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
  implied_value_usd: number;
  model: {
    launch_usd: number;
    odds: number;
    growth_pct: number;
    age_days: number | null;
    rank_lo: number;
    rank_hi: number;
  };
  farm_steps: string[];
}

export interface PeerRow {
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  blind_usd: number;
  miss: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  launch_usd: number;
  odds: number;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  rank_lo: number;
  rank_hi: number;
  tvl_rank: number;
  verdict: FarmVerdict;
  net_usd: number;
  net_hour: number;
  break_even_odds: number;
  pays_from: number | null;
  peers: PeerRow[];
  steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface CurveReport {
  intercept: number;
  slope: number;
  chains_coef: number;
  n: number;
  loo_median_miss: number;
  forward_median_miss: number;
  flat_loo_median_miss: number;
  flat_forward_median_miss: number;
  q25: number;
  q75: number;
  q10: number;
  q90: number;
  in_p25_p75: number;
  in_p10_p90: number;
  forward_cut: string;
  ablation: Array<{ name: string; loo: number; wf: number; kept: boolean }>;
}

export interface OddsReport {
  intercept: number;
  coef_age: number;
  coef_logtvl: number;
  coef_growth: number;
  coef_chains: number;
  mean_age: number;
  sd_age: number;
  mean_logtvl: number;
  sd_logtvl: number;
  mean_growth: number;
  sd_growth: number;
  mean_chains: number;
  sd_chains: number;
  n: number;
  base_rate: number;
  brier_5fold: number;
  brier_5fold_repeated: number;
  brier_forward: number;
  bench_forward: number;
  brier_in_sample: number;
  forward_cut: string;
  ladder: OddsSpecResult[];
}

export interface WorstMiss {
  name: string;
  miss: number;
  actual_usd: number;
  fitted_usd: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  early_above_floor: number;
  early_below_floor: number;
  live_size: number;
  total_implied_usd: number;
  curve: CurveReport;
  odds: OddsReport;
  worst_misses: WorstMiss[];
  top20: { kept: number; of: number; refits: number; threshold: number; fractions: number[] };
  not_tvl_alone: { count: number; of: number };
  ledger: Array<{ label: string; count: number }>;
  excluded_breakdown: Array<{ reason: string; count: number }>;
  farm: { deposit: number; drop_share: number; horizon_weeks: number; tbill: number; counts: Record<FarmVerdict, number> };
  rows: RadarRow[];
  live: LiveRow[];
}

function predictLaunch(p: SnapshotProtocol, beta: number[]): number {
  return Math.pow(10, beta[0]! + beta[1]! * LOG10(p.tvl_usd) + beta[2]! * chainCount(p));
}

function predictOdds(p: SnapshotProtocol, asOf: string, meanAge: number, stats: Record<keyof OddsFeatures, { mean: number; sd: number }>, beta: number[]): number {
  const raw = oddsRaw(p, asOf, meanAge);
  const z =
    beta[0]! +
    beta[1]! * ((raw.age - stats.age.mean) / stats.age.sd) +
    beta[2]! * ((raw.logtvl - stats.logtvl.mean) / stats.logtvl.sd) +
    beta[3]! * ((raw.growth - stats.growth.mean) / stats.growth.sd) +
    beta[4]! * ((raw.chains - stats.chains.mean) / stats.chains.sd);
  return sigmoid(z);
}

/** The board's protocols, scored, with the bootstrap rank ranges and the top-20 stability count. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const asOf = snapshot.as_of;

  // --- the curve, fitted on the launched protocols with a listing date.
  const sample = curveSample(snapshot);
  const catCounts = new Map<string, number>();
  for (const p of sample) if (p.category !== null) catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1);
  const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6).map(([c]) => c);
  const specs = curveSpecs(topCats);
  const baseSpec = specs[0]!;
  const Xb = sample.map((p) => baseSpec.columns(p, asOf, topCats));
  const yb = sample.map((p) => LOG10(p.mcap_usd!));
  const curveBeta = huberFit(Xb, yb);
  const validation = validateCurve(sample, asOf, baseSpec, topCats);
  const ablation = specs.map((spec) => {
    const v = validateCurve(sample, asOf, spec, topCats);
    return { name: spec.name, loo: round4(v.looMedianMiss), wf: round4(v.forwardMedianMiss), kept: spec === baseSpec };
  });
  // Leave-one-out fitted launches, for the peers' blind prices and the worst misses.
  const looFitted = new Map<string, number>();
  const looResid: Array<{ p: SnapshotProtocol; resid: number }> = [];
  for (let i = 0; i < sample.length; i++) {
    const Xi = Xb.filter((_, j) => j !== i);
    const yi = yb.filter((_, j) => j !== i);
    const beta = huberFit(Xi, yi);
    const fitted = dot(Xb[i]!, beta);
    looFitted.set(sample[i]!.slug, Math.pow(10, fitted));
    looResid.push({ p: sample[i]!, resid: yb[i]! - fitted });
  }
  const worstMisses: WorstMiss[] = [...looResid]
    .sort((a, b) => Math.abs(b.resid) - Math.abs(a.resid))
    .slice(0, 6)
    .map(({ p, resid }) => ({
      name: p.name,
      miss: round4(Math.pow(10, Math.abs(resid))),
      actual_usd: p.mcap_usd!,
      fitted_usd: Math.round(looFitted.get(p.slug)!),
    }));

  // --- the odds, fitted on the dated protocols the watchlist rules do not exclude.
  const pop = oddsPopulation(snapshot);
  const meanAge = pop.reduce((s, p) => s + (ageYears(p, asOf) ?? 0), 0) / pop.length;
  const datedAll = snapshot.protocols.filter((p) => p.listed_at !== null).map((p) => p.listed_at!);
  const oddsCut = [...datedAll].sort()[datedAll.length >> 1]!;
  const ladder = validateOdds(pop, asOf, meanAge, oddsCut);
  const fullTerms = ODDS_TERMS[ODDS_TERMS.length - 1]!;
  const brier5Repeated = repeatedBrier5(pop, fullTerms, asOf, meanAge);
  const { X: Xo, stats: oddsStats } = designOdds(pop, fullTerms, asOf, meanAge);
  const yo = pop.map((p) => (recordsToken(p) ? 1 : 0));
  const oddsBeta = logitFit(Xo, yo);
  const oddsPred = Xo.map((row) => sigmoid(dot(row, oddsBeta)));
  const finalOdds = ladder[ladder.length - 1]!;
  const baseRate = yo.reduce((s, v) => s + v, 0) / yo.length;

  // --- the board: the watchlist, plus every rankable pre-token protocol.
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) {
      chosen.set(p.slug, p);
      early.push(p);
    }
  }
  const scored = [...chosen.values()].map((p) => {
    const launch = predictLaunch(p, curveBeta);
    const odds = predictOdds(p, asOf, meanAge, oddsStats, oddsBeta);
    return { p, launch, odds, implied: Math.max(1, Math.round(launch * odds)), age: ageDays(asOf, p.listed_at) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // --- 200 seeded bootstrap refits: the rank range of every row, and top-20 stability.
  const ranksBySlug = new Map<string, number[]>();
  const top20Hits = new Map<string, number>();
  for (let it = 0; it < BOOTSTRAP_REFITS; it++) {
    const curveResample = resampled(sample, BOOTSTRAP_SEED + it * 2);
    const oddsResample = resampled(pop, BOOTSTRAP_SEED + it * 2 + 1);
    const Xb2 = curveResample.map((p) => baseSpec.columns(p, asOf, topCats));
    const yb2 = curveResample.map((p) => LOG10(p.mcap_usd!));
    const beta2 = huberFit(Xb2, yb2);
    const meanAge2 = oddsResample.reduce((s, p) => s + (ageYears(p, asOf) ?? 0), 0) / oddsResample.length;
    const { X: Xo2, stats: stats2 } = designOdds(oddsResample, fullTerms, asOf, meanAge2);
    const yo2 = oddsResample.map((p) => (recordsToken(p) ? 1 : 0));
    const oddsBeta2 = logitFit(Xo2, yo2);
    const rescored = scored.map((s) => ({ slug: s.p.slug, implied: predictLaunch(s.p, beta2) * predictOdds(s.p, asOf, meanAge2, stats2, oddsBeta2) }));
    rescored.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    rescored.forEach((r, i) => {
      const arr = ranksBySlug.get(r.slug) ?? [];
      arr.push(i + 1);
      ranksBySlug.set(r.slug, arr);
      if (i < 20) top20Hits.set(r.slug, (top20Hits.get(r.slug) ?? 0) + 1);
    });
  }
  const rangeOf = (slug: string): { lo: number; hi: number } => {
    const arr = ranksBySlug.get(slug) ?? [1];
    return { lo: Math.max(1, Math.round(quantile(arr, 0.1))), hi: Math.round(quantile(arr, 0.9)) };
  };
  const top20Fractions = scored.slice(0, 20).map((s) => (top20Hits.get(s.p.slug) ?? 0) / BOOTSTRAP_REFITS);
  const top20Kept = top20Fractions.filter((f) => f >= 0.8).length;

  // --- the ledger: every one of the 758 protocols, accounted for.
  const watchlistCount = snapshot.watchlist.length;
  const earlyAbove = early.filter((p) => p.tvl_usd >= snapshot.floor_usd).length;
  const earlyBelow = early.length - earlyAbove;
  const launched = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length;
  const recordedNoCap = snapshot.protocols.filter((p) => (p.gecko_id !== null || p.symbol !== null) && !(p.mcap_usd !== null && p.mcap_usd > 0)).length;
  const excluded = snapshot.protocols.filter((p) => isPreToken(p) && !snapshot.watchlist.includes(p.slug) && exclusionReason(p) !== null);
  const excludedByReason = new Map<string, number>();
  for (const p of excluded) {
    const r = exclusionReason(p)!;
    excludedByReason.set(r, (excludedByReason.get(r) ?? 0) + 1);
  }
  const boardSize = scored.length;
  const ledgerTotal = boardSize + launched + recordedNoCap + excluded.length;
  if (ledgerTotal !== snapshot.protocols.length) throw new Error(`ledger does not sum: ${ledgerTotal} of ${snapshot.protocols.length}`);
  if (boardSize !== watchlistCount + early.length) throw new Error('board is not watchlist plus early rows');

  // --- TVL ranks, for the "not TVL alone" count.
  const byTvl = [...scored].sort((a, b) => b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const tvlRank = new Map<string, number>();
  byTvl.forEach((s, i) => tvlRank.set(s.p.slug, i + 1));
  const notTvlAlone = scored.filter((s, i) => Math.abs(i + 1 - tvlRank.get(s.p.slug)!) >= 5).length;

  // --- the launched peers of every row, with blind prices and misses. The peer
  // pool is the launched protocols the watchlist rules do not exclude: a
  // centralised exchange is no peer for a lending market, whatever its size.
  const launchedSet = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.listed_at !== null && exclusionReason(p) === null);
  const peersOf = (row: SnapshotProtocol): PeerRow[] => {
    const withDist = launchedSet.map((p) => ({ p, dist: Math.abs(LOG10(p.tvl_usd) - LOG10(row.tvl_usd)) }));
    const sameCat = withDist.filter((w) => w.p.category === row.category).sort((a, b) => a.dist - b.dist || (a.p.slug < b.p.slug ? -1 : 1));
    const rest = withDist.filter((w) => w.p.category !== row.category).sort((a, b) => a.dist - b.dist || (a.p.slug < b.p.slug ? -1 : 1));
    const picked = [...sameCat, ...rest].slice(0, 5);
    return picked.map(({ p }) => {
      const blind = looFitted.get(p.slug) ?? predictLaunch(p, curveBeta);
      return { name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, blind_usd: Math.round(blind), miss: round4(p.mcap_usd! / blind) };
    });
  };

  // --- farm economics at the default sliders, and the verdict counts.
  const farmCounts: Record<FarmVerdict, number> = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  const rows: RadarRow[] = scored.map((s, i) => {
    const range = rangeOf(s.p.slug);
    const econ = farmEconomics(s.launch, s.odds, s.p.tvl_usd, FARM_DEFAULTS);
    farmCounts[econ.verdict]++;
    const lo = validation.q25;
    const hi = validation.q75;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      launch_usd: Math.round(s.launch),
      odds: round4(s.odds),
      implied_value_usd: s.implied,
      p25_usd: Math.max(1, Math.round(s.launch * Math.pow(10, lo) * s.odds)),
      p75_usd: Math.round(s.launch * Math.pow(10, hi) * s.odds),
      rank_lo: range.lo,
      rank_hi: range.hi,
      tvl_rank: tvlRank.get(s.p.slug)!,
      verdict: econ.verdict,
      net_usd: Math.round(econ.net),
      net_hour: round4(econ.netHour),
      break_even_odds: econ.breakEvenOdds === Number.POSITIVE_INFINITY ? -1 : round4(econ.breakEvenOdds),
      pays_from: econ.paysFrom === null ? null : Math.round(econ.paysFrom),
      peers: peersOf(s.p),
      steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
  const totalImplied = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);

  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const board: BoardRow[] = scored.map((s, i) => {
    const range = rangeOf(s.p.slug);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        launch_usd: Math.round(s.launch),
        odds: round4(s.odds),
        growth_pct: growthClamped(s.p),
        age_days: s.age,
        rank_lo: range.lo,
        rank_hi: range.hi,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: watchlistCount,
    board_size: boardSize,
    early_size: early.length,
    early_above_floor: earlyAbove,
    early_below_floor: earlyBelow,
    live_size: live.length,
    total_implied_usd: totalImplied,
    curve: {
      intercept: round4(curveBeta[0]!),
      slope: round4(curveBeta[1]!),
      chains_coef: round4(curveBeta[2]!),
      n: sample.length,
      loo_median_miss: round4(validation.looMedianMiss),
      forward_median_miss: round4(validation.forwardMedianMiss),
      flat_loo_median_miss: round4(validation.flatLooMedianMiss),
      flat_forward_median_miss: round4(validation.flatForwardMedianMiss),
      q25: round4(validation.q25),
      q75: round4(validation.q75),
      q10: round4(validation.q10),
      q90: round4(validation.q90),
      in_p25_p75: round4(validation.inP25P75),
      in_p10_p90: round4(validation.inP10P90),
      forward_cut: validation.forwardCut,
      ablation,
    },
    odds: {
      intercept: round4(oddsBeta[0]!),
      coef_age: round4(oddsBeta[1]!),
      coef_logtvl: round4(oddsBeta[2]!),
      coef_growth: round4(oddsBeta[3]!),
      coef_chains: round4(oddsBeta[4]!),
      mean_age: round4(oddsStats.age.mean),
      sd_age: round4(oddsStats.age.sd),
      mean_logtvl: round4(oddsStats.logtvl.mean),
      sd_logtvl: round4(oddsStats.logtvl.sd),
      mean_growth: round4(oddsStats.growth.mean),
      sd_growth: round4(oddsStats.growth.sd),
      mean_chains: round4(oddsStats.chains.mean),
      sd_chains: round4(oddsStats.chains.sd),
      n: pop.length,
      base_rate: round4(baseRate),
      brier_5fold: round4(finalOdds.brier5),
      brier_5fold_repeated: round4(brier5Repeated),
      brier_forward: round4(finalOdds.brierForward),
      bench_forward: round4(finalOdds.benchForward),
      brier_in_sample: round4(brier(yo, oddsPred)),
      forward_cut: oddsCut,
      ladder,
    },
    worst_misses: worstMisses,
    top20: { kept: top20Kept, of: 20, refits: BOOTSTRAP_REFITS, threshold: 0.8, fractions: top20Fractions.map((f) => round4(f)) },
    not_tvl_alone: { count: notTvlAlone, of: boardSize },
    ledger: [
      { label: 'On the board (watchlist + early)', count: boardSize },
      { label: 'Launched, with a market cap', count: launched },
      { label: 'Token recorded, no usable market cap', count: recordedNoCap },
      { label: 'Excluded by the watchlist rules', count: excluded.length },
    ],
    excluded_breakdown: [...excludedByReason.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([reason, count]) => ({ reason, count })),
    farm: { deposit: FARM_DEFAULTS.deposit, drop_share: FARM_DEFAULTS.dropShare, horizon_weeks: FARM_DEFAULTS.horizonWeeks, tbill: FARM_DEFAULTS.tbill, counts: farmCounts },
    rows,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
