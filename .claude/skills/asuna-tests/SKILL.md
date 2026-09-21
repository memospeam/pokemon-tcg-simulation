---
name: asuna-tests
description: >-
  Write or extend Vitest tests in the pokemon-tcg-simulation project. Tests are
  colocated `*.test.ts` next to source (engine effects, deck/AI, format corpus,
  occasional UI). Use whenever the user asks to add, write, or refactor a test
  — even phrased as "เพิ่ม test", "เขียนเคสใหม่", "cover effect", "playtest",
  or just a card / mechanic / screen name.
---

# Vitest tests for pokemon-tcg-simulation

This skill encodes the test conventions of **this repo**. Ported from asuna on
setlink-playwright (workflow, ห้ามคาดเดา, verify before done) but **not** the
Playwright Page Object Model — that stack does not exist here.

## The core idea

Tests sit next to the code they prove. A reader should see the behaviour in the
`it()` title and the setup in a small local helper already used by that file.

| Kind | Lives in | Typical shape |
|------|----------|----------------|
| Engine / rules | `src/lib/engine/**/*.test.ts` | `beginGame` / `gameReducer` / `getLegalActions` |
| Effects (parse) | `src/lib/engine/effects/*.test.ts` | `parseAttackText` / `parseAbilityText` → `toEqual` kinds |
| Effects (runtime) | same folder | `setupActiveGame` or `battleState` + attach cards + `executeEffects` / reducer |
| Deck / AI / playtest | `src/lib/deck/**/*.test.ts` | presets + `runMatchFromBuiltDecks` / policy helpers |
| Format / corpus | `src/lib/format/**/*.test.ts` | coverage helpers, not live API |
| UI (rare) | `src/components/**/*.test.ts` | pure functions extracted from components |
| Reports | `scripts/*.test.ts` | slow; many excluded from `npm test` |

## Workflow: adding a test

Do these in order.

1. **Read the implementation** of the mechanic (parser, executor, reducer branch,
   AI policy). Do not invent an effect `kind` that source does not emit.
2. **Open the sibling test file.** Reuse its helpers (`mockBasic`, `fillerDeck`,
   `setupActiveGame`, `battleState`, `mon`, …). Copy an existing `it()` as the
   skeleton.
3. **Choose parse vs runtime vs playtest** — see `references/effects.md`.
   Prefer the cheapest test that actually fails if the bug returns.
4. **Write one focused `it()`.** Title names the card/mechanic and the expected
   behaviour (`"parses ACE Nullifier ability"`, `"flags a bench overflow (>5)"`).
5. **Run it:** `npx vitest run <path> -t "<title>"`. Fix until green.
   If types changed, `npm run lint`.

## Core principle: ห้ามคาดเดา

- **Effect kind / damage / target** → read `parseText*.ts` and the executor.
- **Legal action / phase** → read `reducer.ts`, `getLegalActions`, enums.
- **Card text** → prefer corpus (`data/standard/effect-texts.json`) or the
  definition already used in neighbouring tests. Do not invent card text.
- **UI copy / selector** → read the component. This repo has almost no DOM tests;
  do not add React Testing Library unless the user asks.

If source still doesn't answer → ask the user.

## Conventions at a glance

- File name: `<source>.test.ts` next to `<source>.ts` (not `__tests__/`, not `.spec.ts`).
- Imports: `import { describe, expect, it } from "vitest";`
- Alias `@/` is fine when neighbouring tests use it (`@/lib/...`).
- Helpers stay **file-local** (`function mockBasic`, `function setupActiveGame`).
- `describe("unit under test")` + `it("behaviour")` in English.
- Prefer `toEqual` for parsed effect arrays; `toMatchObject` / `toContain` when
  the sibling file already does.
- Seed RNG when the test needs a deterministically dealt hand (`seed: 42`).
- Do not add Playwright, `test.only` left behind, or new test frameworks.

## Reference files

- `references/test-file.md` — file skeleton, naming, what not to add.
- `references/engine-helpers.md` — mock cards and game-state setup.
- `references/effects.md` — parse vs runtime vs playtest.
- `references/vitest-config.md` — commands and excluded jobs.

## Playwright E2E (`e2e/`)

2-layer POM (asuna / setlink shape) adapted to this Vite SPA — no `userKey`, no test/train API.

```
e2e/pages/base.fixture.ts
e2e/pages/common/common.page.ts
e2e/pages/<route>/<route>.page.ts
e2e/tests/<feature>/<feature>-01.spec.ts
playwright.config.ts          # webServer = npm run dev, BASE_URL default http://localhost:5173
```

- Selectors: `data-testid` (this React app has no `#id`s).
- Specs import `test` from `e2e/pages/base.fixture`, not `@playwright/test`.
- Run: `npm run test:e2e`.
- Deck resolve (Quick Dragapult / Resolve deck) stubs `api.pokemontcg.io` via `e2e/utils/mock-pokemon-api.ts` — do not hit the live API.

