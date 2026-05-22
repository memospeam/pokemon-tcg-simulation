# Pokémon TCG Simulation

Web-based simulation for the [Pokémon Trading Card Game](https://www.pokemon.com/us/pokemon-tcg/) built with TypeScript, React, and Vite.

## Features

- Core domain models: cards, decks, players, and game state
- Booster pack opening simulation with optional seed
- Two-player match setup (shuffle, prize cards, opening hands)
- React UI for interactive experiments

## Requirements

- Node.js 20+

## Setup

```bash
npm install
```

## Development

Start the dev server:

```bash
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm test` | Run Vitest unit tests |
| `npm run lint` | Type-check the project |

## Project structure

```
src/
  components/     # React UI (pack opener, game setup)
  lib/
    models/       # Card, Deck, Player, GameState
    simulation/   # Booster pack logic
```

## License

MIT
