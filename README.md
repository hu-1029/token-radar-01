# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hu-1029/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hu-1029/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A static, offline dashboard that ranks pre-token DeFi protocols by implied value, with a farm plan for each. The value model fits the snapshot's own traded tokens, and every validation number on the page is computed from that snapshot at build time — nothing is tuned by hand and no protocol is special-cased.

## The model (radar-4)

- **Launch value**: a Huber robust log-log fit of traded tokens' market cap on TVL and chain count, over 81 comparables (market cap at least $1M, launch categories only). On the 2026-11-14 snapshot: `log10(launch) = 4.8118 + 0.3352 × log10(TVL) − 0.087 × min(chains, 4)`. The slope is sublinear: a protocol ten times larger is worth about 2.2× as much, not ten times as much.
- **Launch odds**: a logistic fit on listing age alone, fitted on every dated protocol. Fitted odds run from 23% at listing to 87% at five years; a protocol with an unknown listing age gets the global rate, 51%.
- **Implied value** = fitted launch value × launch odds. The airdrop drop share (default 7%) prices the farm, not the value.
- **Interval**: every row carries a P25–P75 interval from leave-one-out errors (×0.41–×2.40 on this snapshot).

## Validation (from the snapshot, at build time)

- Out-of-sample miss: **×2.46** leave-one-out, **×1.99** walk-forward. A flat TVL/market-cap multiple misses by ×3.29 and ×3.13.
- Interval honesty: **51%** of leave-one-out predictions land inside their own P25–P75 (stated 50%), **80%** inside P10–P90 (stated 80%).
- Odds: 5-fold Brier **0.217** for the age logistic vs 0.250 for the base rate and 0.219 for age buckets; walk-forward 0.234 vs 0.287 for the buckets and 0.318 for the base rate. The logistic wins both tests, so the board uses it; the buckets are shown on the page as the raw record.
- Ablation: the chain-count term is kept (wins both tests); 7-day growth, age in the value curve and category offsets are dropped, with reasons, on the page.
- Board: **198 rows** — the 40-protocol watchlist, 138 clean protocols below the $50M floor, and 20 clean ones above the floor that the watchlist does not name. The ledger accounts for all **758** snapshot protocols in exactly one group each, and the page recomputes the board in the browser and verifies ranks, totals and the checksum in a green self-check bar.

## Farm verdicts

Each row carries FARM / MARGINAL / SKIP with net-of-fees dollars and net per hour. Expected airdrop = implied value × drop share × (deposit / TVL), net of gas. FARM means the net beats the same deposit in T-bills over the hold **and** clears $25 an hour. Sliders for deposit, drop share, horizon and T-bill rate recompute the whole board live; the top of the page names the best farm next. At the defaults ($5,000, 7%, 12 weeks, 4%): 19 FARM, 112 MARGINAL, 67 SKIP.

## Run it

```sh
node main.ts --input /path/to/snapshot.json --output ./output
```

Node 22.18 or later, standard library only, no network. The program reads the sealed snapshot, writes the ranked board to `output/board.json`, the dashboard data to `output/data.js`, copies `dashboard/` and `screenshots/` to `output/`, and writes `output/dossier.json` with the kit's vendored builder. Running it twice writes the same bytes.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes the outputs.
- `lib/model.ts` — the radar-4 model, the validation and the board builder.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`); it reads `data.js` beside it and works offline.
- `screenshots/` — the four screenshots of the built page: board, detail drawer, filtered view, method and validation.
- `vendor/makefun-board.ts` — the kit's vendored dossier builder, byte for byte.

Built from DefiLlama's sealed 2026-11-14 snapshot of 758 protocols.
