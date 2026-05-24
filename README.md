# Pokémon TCG Simulation

Web-based simulation for the [Pokémon Trading Card Game](https://www.pokemon.com/us/pokemon-tcg/) built with TypeScript, React, and Vite. Import Limitless decklists, resolve real cards via [pokemontcg.io](https://docs.pokemontcg.io/), and play both sides solo like [tcgmasters.net](https://tcgmasters.net/).

## Features

- Import Limitless/PTCGL decklists from clipboard
- Resolve real card data and images via pokemontcg.io API
- Deck validation (60 cards, copy limits, Basic Pokémon requirement)
- Save decks locally ("My Decks")
- Solo match simulation with board, turns, energy, trainers, attacks, KO, and prizes
- Switch sides to control both players
- Save/load in-progress games in localStorage
- Booster pack opener (sample pool)

## Requirements

- Node.js 20+
- Internet access for card resolution and images

## Setup

```bash
npm install
cp .env.example .env.local
```

Add your API key from [dev.pokemontcg.io](https://dev.pokemontcg.io/) to `.env.local`:

```
VITE_POKEMONTCG_API_KEY=your-key-here
```

## Development

```bash
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## Usage

1. Open **Deck Builder** or **Lobby**
2. Paste a Limitless decklist (or click **Import from clipboard**)
3. Click **Resolve deck** to fetch card data
4. Save decks and select one deck for each player in **Lobby**
5. Click **Play** to start the match
6. Place Active Pokémon, optionally bench, then **Start game**
7. Use **Switch side** to control both players solo

### Deck import format

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

Prepared attack/ability texts for all **Standard-legal Pokémon** (regulation marks **H, I, J** — 2026 rotation) live in `data/standard/`:

| File | Contents |
| --- | --- |
| `manifest.json` | Card counts and parser coverage stats |
| `effect-texts.json` | Unique attack/ability texts with parsed effects |
| `cards-index.json` | Per-card index linking to effect text IDs |
| `unknown-patterns.json` | Texts not fully automated yet (priority list) |

**Development focus:** current Standard, with **Chaos Rising** (`CRI` / `ME4`, regulation **J**, released 2026-05-22) as the primary expansion for new parser/engine work. See `STANDARD_FORMAT.focusExpansion` and `summarizeFocusExpansion()` in `@/lib/format`.

Regenerate after parser updates or rotation changes:

```bash
npm run prepare:standard
```

Load in code via `loadStandardCorpus()` from `@/lib/format`.

Current coverage (auto-generated): ~830 attack texts, ~239 abilities, ~228 trainer texts; Pokémon parse is full for all non-empty clauses. CRI indexes **119** Pokémon (set total **122** — slots 84–86 are Special Energy excluded from the Pokémon corpus). See `unknown-patterns.json` and `summarizeFocusExpansion()` for remaining engine gaps.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm test` | Run Vitest unit tests |
| `npm run prepare:standard` | Fetch all Standard (H/I/J) Pokémon from API and regenerate `data/standard/` |
| `npm run lint` | Type-check the project |

## Project structure

```
src/
  components/
    DeckBuilder/   # paste/import decklists
    Lobby/         # pick 2 decks and play
    GameBoard/     # solo match UI
  lib/
    catalog/       # pokemontcg.io client + resolver + cache
    deck/          # Limitless parser, validator, storage
    engine/        # game rules and reducer
    format/      # Standard format definition + effect corpus loader
    models/        # card definitions and instances
  stores/          # Zustand state for decks and game
```

## License

MIT
