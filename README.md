# Token Radar — make.fun token-radar-01 entry

A token launch radar for @gaga-kushina. It reads the sealed DefiLlama
snapshot, prices every pre-token protocol by what its launch would be
worth, and hands in a dashboard with the ranked board, a detail view per
protocol and the steps to farm each one.

## The model (radar-2, "category comps")

A protocol that records no token has no market price, so it is priced the
way a buyer prices a private company: by what the market already pays for
the same kind of business.

    implied = TVL × category multiple × growth mult × age mult × chain mult

- **Category multiple** — median market-cap / TVL of the live-token
  protocols in the same category (3+ comps), else the global median. The
  market sets the price; the model only reads it.
- **Growth mult** — 1 + clamp(7-day change, −50%, +100%) / 100 × 0.6.
- **Age mult** — 0.70 + 0.30 × min(age in days, 730) / 730; unknown age
  scores 0.85.
- **Chain mult** — 1 + 0.02 × min(chains − 1, 5).

The board ranks all 198 rankable pre-token protocols: the 40 on the
watchlist plus every other pre-token protocol below the floor that is not
a CEX, a bridge, a liquid-staking product or a versioned pool. Protocols
whose token already trades are kept apart in the Live view at the market's
own value. Farm plans (6 steps each, with cost and time) are derived from
each protocol's own category, chains, TVL and age.

## Run it

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

Two runs write byte-identical outputs. Node 22.18+ required.

## Files

- `main.ts` — the entry program: reads the snapshot, writes
  `board.json`, `data.js`, copies `dashboard/` and `screenshots/`, and
  writes `dossier.json` via the vendored library.
- `lib/model.ts` — the value model and farm-plan generator.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — the static page (no network): board, detail drawer,
  filters, live-token view, model page.
- `screenshots/` — board, detail and filtered views, rendered in a real
  browser at 1440×900.
