# token-radar-01, round 4 (radar-5)

A fitted token radar: every pre-token protocol ranked by implied value =
fitted launch value × fitted odds of ever recording a token. Both fits run
at build time from the sealed snapshot; nothing in `lib/model.ts` names a
protocol, and every claimed number is computed, not typed in.

## The model

- **Curve** — Huber fit (c = 1.345) of log10(market cap) on log10(TVL) and
  min(chains, 4), over the 95 launched protocols with a listing date:
  `log10(launch) = 3.1051 + 0.5276·log10(TVL) − 0.0450·min(chains,4)`.
  Leave-one-out median miss ×2.77, forward ×3.15 (flat multiple ×4.89 / ×5.29).
  Age, growth, age+growth, growth × chains and category dummies were tried
  and dropped: none won on both splits.
- **Odds** — logistic fit of "the protocol records a token" on age,
  log10(TVL), 7-day growth and chain count, over the 383 dated protocols the
  watchlist rules do not exclude (base rate 50.1%). Each term earned its
  place in a forward ladder (age → +log TVL → +growth → +chains, every step
  winning both splits). 5-fold Brier 0.201, forward 0.219 (base-rate bench
  0.364).
- **Board** — the 40 watchlist protocols plus every rankable pre-token
  protocol (158), 198 rows. Rank ranges are P10–P90 over 200 seeded
  bootstrap refits; 16 of the top 20 hold in ≥80% of refits. 161 of 198 rows
  sit 5+ ranks away from their TVL rank. Ledger: 198 + 128 launched with a
  market cap + 288 token recorded, no usable market cap + 144 excluded by
  the watchlist rules = 758.
- **Farm** — a farmer's share of the drop equals their deposit's share of
  TVL; cash net is the drop minus gas ($8 setup + $4/week). FARM needs
  $25/hour or more and a net that beats T-bills; MARGINAL is any positive
  net. Defaults $10,000 / 7% / 12 weeks / 4%: 29 FARM / 113 MARGINAL / 56 SKIP.

## Build

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Input defaults to `/input/snapshot.json`; output defaults to
`$MAKEFUN_OUTPUT_DIR` or `/output`. Two runs are byte-identical
(board.json, data.js, dossier.json). The dashboard is a static page
(`dashboard/index.html` + `app.css` + `app.js`, 30,207 bytes total, under
the 65,536-byte dossier text cap) reading `data.js`; it re-renders the
farm verdicts in the page when the sliders move.

## Screenshots

Four views at 1440×900, taken on the VPS with Playwright
(`/home/opc/radar4-shoot-v4.py`, venv python, file:// load of the built
output): `1-board.png` (page top), `2-detail.png` (detail drawer for the
#1 row), `3-filtered.png` (verdict FARM), `4-method.png` (method page).
Each is ≤ 512 KiB. The detail drawer, the FARM filter and the method
section are all reachable by hash: `#p=<slug>`, `#verdict=FARM`,
`#method`.

## Check

```sh
node cli/makefun.mjs check --repo <this directory> --api-key <key from ~/.makefun/credentials>
```

## Status

Built 2026-11-23, not submitted. Do not upload to GitHub or submit to
make.fun until Leo has seen the four screenshots and approved.
