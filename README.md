# Pokémon TCG Simulation

Play in the browser: [memospeam.github.io/pokemon-tcg-simulation](https://memospeam.github.io/pokemon-tcg-simulation/)

Pick a Worlds matchup and battle the AI. No account and no install. Featured decks are bundled, so a match starts without an API key. Card images still load from [pokemontcg.io](https://docs.pokemontcg.io/) when that service is up.

Web-based simulation for the [Pokémon Trading Card Game](https://www.pokemon.com/us/pokemon-tcg/) built with TypeScript, React, and Vite. Import Limitless decklists, play vs AI, or run batch meta simulations.

## Features

- **Deck Builder** — paste Limitless/PTCGL lists, resolve card data + images, validate 60-card decks
- **Battle** — PTCGL-style match table vs heuristic AI (energy/evolve drag-drop, VFX, coin flips)
- **Analysis Lab** — watch AI vs AI replays, run N×N matchup matrices (Utrecht meta 11, Worlds 2026 Top 8), export CSV
- **Standard corpus** — parsed attack/ability/trainer effects for regulation marks H/I/J
- Tournament presets (Worlds 2026, NAIC, regionals, …) from Limitless imports
- Save decks and in-progress games in localStorage

## Requirements

- Node.js 20+
- Internet for card resolution, images, and corpus refresh

An API key is optional. The public site and `npm run dev` both call pokemontcg.io from the browser without one. A key from [dev.pokemontcg.io](https://dev.pokemontcg.io/) only raises the rate limit. Put it in `.env.local` if you want it locally:

```
VITE_POKEMONTCG_API_KEY=your-key-here
```

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173` — routes:

| Route | Purpose |
| --- | --- |
| `/battle` | Play lobby → VS screen → match |
| `/decks` | Deck Builder |
| `/analysis` | Sim Playback + batch matrix |

Production build (Vite only; full `npm run lint` type-checks app sources):

```bash
npx vite build
npm run lint
```

## Quick start — play a match

1. Open the site, or go to **Play** (`/battle`) locally
2. Tap a matchup (Dragapult mirror is the fastest start)
3. On the VS screen, click **Start battle**
4. Place Active (and optional Bench), **Start game**
5. Your turn: click cards or drag Energy/Evolution onto Pokémon; **End turn** when done

## Quick start — meta matrix

1. Go to **Analysis** → **Batch matrix**
2. Choose **Standard meta (11)** or **Worlds 2026 Top 8**
3. Pick seed set (CI / Quick / Extended) → **Run matrix**
4. View heatmap + tier list → **Export CSV**

## Deck import format

```
Pokémon: 18
4 Dreepy TWM 128
4 Drakloak TWM 129

Trainer: 32
4 Ultra Ball MEG 131

Energy: 10
4 Psychic Energy MEE 5
```

## Standard format effect corpus

Prepared texts for **Standard-legal Pokémon** (regulation **H, I, J**) live in `data/standard/`:

| File | Contents |
| --- | --- |
| `manifest.json` | Card counts and parser coverage |
| `effect-texts.json` | Unique attack/ability texts + parsed effects |
| `cards-index.json` | Per-card index |
| `unknown-patterns.json` | Unparsed texts (priority backlog) |

Regenerate after API/parser updates:

```bash
npm run prepare:standard
```

Load in code: `loadStandardCorpus()` from `@/lib/format`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` + production bundle |
| `npm run preview` | Preview production build |
| `npm test` | Vitest unit tests |
| `npm run lint` | Type-check app (`tsconfig.app.json`) |
| `npm run prepare:standard` | Refresh `data/standard/` from pokemontcg.io |
| `npm run generate:worlds-2026` | Regenerate Worlds 2026 Top 8 JSON |
| `npm run report:cri-meta` | CRI meta readiness report (slow) |
| `npm run report:invariants` | Deep invariant sweep (slow) |

## Project structure

```
src/
  AppRouter.tsx          # /battle, /decks, /analysis
  components/
    Battle/              # setup, VS screen, turn phase bar
    Match/               # MatchTable, VFX, drag-drop
    GameBoard/           # human match UI + controller
    Analysis/            # AnalysisLab, matrix grid
    DeckBuilder/
    SimPlayback/
  lib/
    catalog/             # pokemontcg.io client
    deck/                # parser, playtest runner, meta AI
    engine/              # rules reducer
    format/              # Standard corpus
  stores/                # Zustand (game, deck, sim)
data/
  standard/              # generated corpus
  tournaments/           # Limitless preset JSON
```

## License

MIT
