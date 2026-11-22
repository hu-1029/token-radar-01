// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores
// every pre-token protocol with the radar-4 model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/ to /output. Last,
// it writes /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. Radar-4
// prices each protocol with a fitted log-log curve (Huber robust) on the traded peers, times the
// peers' launch odds at the protocol's age, with a P25-P75 interval from leave-one-out errors and
// a farm verdict per row. Every number on the page comes from this program's run, never from a
// hand-edited file.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, buildRadar, checkSnapshot, parseSnapshot, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DASHBOARD_FILES = ['index.html', 'app.css', 'app.js', 'favicon.svg'];
/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

function printUsage(): void {
  console.log(
    'Usage: main.ts [--input <snapshot file or dir>] [--output <dir>]\n' +
      'The snapshot defaults to /input/snapshot.json; output defaults to $MAKEFUN_OUTPUT_DIR or /output.',
  );
}

function parseArgs(argv: string[]): { input: string; output: string } {
  const args = { input: '/input/snapshot.json', output: process.env.MAKEFUN_OUTPUT_DIR ?? '/output' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--input' && i + 1 < argv.length) {
      args.input = argv[++i]!;
      continue;
    }
    if (a === '--output' && i + 1 < argv.length) {
      args.output = argv[++i]!;
      continue;
    }
    if (a.startsWith('--input=')) {
      args.input = a.slice('--input='.length);
      continue;
    }
    if (a.startsWith('--output=')) {
      args.output = a.slice('--output='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Read the sealed snapshot from a file, or from snapshot.json inside a directory. */
function readSnapshot(input: string): Snapshot {
  const path = statSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
  if (!existsSync(path)) throw new Error(`Snapshot not found: ${path}`);
  return parseSnapshot(JSON.parse(readFileSync(path, 'utf8')));
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/** Copy a directory's files (not subdirectories) into a target directory. */
function copyDirFiles(sourceDir: string, targetDir: string, allowed: string[]): string[] {
  ensureDir(targetDir);
  const copied: string[] = [];
  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name);
    if (!statSync(source).isFile()) continue;
    if (!allowed.includes(name)) continue;
    copyFileSync(source, join(targetDir, name));
    copied.push(name);
  }
  return copied;
}

/** A short, human-readable rendering of a US dollar amount for the run log. */
function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const pctStr = (n: number): string => `${(n * 100).toFixed(0)}%`;

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = readSnapshot(input);
  const counts = checkSnapshot(snapshot);
  const { board, data } = buildRadar(snapshot, MODEL);
  if (board.length === 0) throw new Error('No rankable protocols in the snapshot; the board is empty.');
  if (data.ledger_total !== counts.total) {
    throw new Error(`Ledger covers ${data.ledger_total} protocols but the snapshot holds ${counts.total}.`);
  }
  const wlCovered = board.filter((r) => snapshot.watchlist.includes(r.slug)).length;
  if (wlCovered !== counts.watchlist) {
    throw new Error(`Watchlist coverage is ${wlCovered}/${counts.watchlist}.`);
  }

  ensureDir(output);
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(output, 'data.js'), `window.RADAR = ${JSON.stringify(data, null, 2)};\n`);

  const dashboardDir = join(__dirname, 'dashboard');
  const copied = copyDirFiles(dashboardDir, join(output, 'dashboard'), DASHBOARD_FILES);
  for (const name of DASHBOARD_FILES) {
    if (!copied.includes(name) && name !== 'favicon.svg') {
      throw new Error(`Missing dashboard file: dashboard/${name}`);
    }
  }
  const screenshotsDir = join(__dirname, 'screenshots');
  const screenshots = existsSync(screenshotsDir)
    ? copyDirFiles(screenshotsDir, join(output, 'screenshots'), readdirSync(screenshotsDir).filter((n) => n.endsWith('.png')))
    : [];
  const dashboardTextBytes = ['index.html', 'app.css', 'app.js']
    .map((n) => Buffer.byteLength(readFileSync(join(output, 'dashboard', n), 'utf8'), 'utf8'))
    .reduce((s, n) => s + n, 0);

  // The dossier is the dashboard's own source plus the screenshots, built by the kit's vendored
  // builder: its text is the dashboard files, capped at 65,536 bytes, so the page's copy has to
  // fit inside that budget. buildDossier throws when a cap cannot be kept.
  const dossierBytes = buildDossier(output, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(output, 'dossier.json'), dossierBytes);

  const v = data.validation;
  console.log(`snapshot: ${counts.total} protocols, as_of ${data.as_of}, floor ${usd(data.floor_usd)}`);
  console.log(`board: ${board.length} rows (watchlist ${counts.watchlist}, early ${counts.early}, off-list ${counts.offlist}); live ${counts.live} with market cap`);
  console.log(`curve: log10(launch) = ${v.curve.intercept} + ${v.curve.slope} x log10(TVL) + ${v.curve.chain_coef} x chains, n=${v.curve.n}, LOO median miss x${Math.pow(10, v.curve.loo_median_log_err).toFixed(2)}`);
  console.log(`odds: age logistic b0=${v.odds_curve.b0} b1=${v.odds_curve.b1}, fitted odds at 1y ${pctStr(v.odds_curve.points[3]!.odds)} / 2y ${pctStr(v.odds_curve.points[4]!.odds)} / 3y ${pctStr(v.odds_curve.points[5]!.odds)} / 5y ${pctStr(v.odds_curve.points[7]!.odds)}, global ${(v.odds_curve.global_rate * 100).toFixed(1)}%`);
  console.log(`interval: P25-P75 x${Math.pow(10, v.curve.loo_q25).toFixed(2)}-x${Math.pow(10, v.curve.loo_q75).toFixed(2)}, inside ${Math.round(v.curve.inside_p25_p75 * 100)}% (stated 50%), P10-P90 inside ${Math.round(v.curve.inside_p10_p90 * 100)}% (stated 80%)`);
  console.log(`odds validation: 5-fold Brier logit ${v.odds.logit_brier_cv} vs buckets ${v.odds.bucket_brier_cv} vs base ${v.odds.base_brier_cv}; walk-forward logit ${v.odds.walk_logit_brier} vs buckets ${v.odds.walk_bucket_brier} vs base ${v.odds.walk_base_brier}`);
  console.log(`farm: ${data.farm_summary.farm} FARM, ${data.farm_summary.marginal} MARGINAL, ${data.farm_summary.skip} SKIP`);
  console.log(`top 5: ${board.slice(0, 5).map((r) => `${r.rank}. ${r.name} ${usd(r.implied_value_usd)}`).join(', ')}`);
  console.log(`ledger total: ${data.ledger_total}/${counts.total}; checksum ${data.checksum}`);
  console.log(`dossier: ${dossierBytes.length} bytes (text cap ${TEXT_MAX_BYTES}); dashboard text: ${dashboardTextBytes} bytes`);
  console.log(`screenshots copied: ${screenshots.length}`);
  console.log(`wrote ${output}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
