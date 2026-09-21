# Vitest config and commands

`vitest.config.ts`: `environment: "node"`, alias `@` → `src/`, timeout 30s.

## Default suite (`npm test` = `vitest run`)

Excluded (do not run unless the user asks):

- `scripts/prepare-standard-effects.test.ts`
- `scripts/fetchAttackCosts.test.ts`
- `scripts/report-invariants.test.ts`
- `scripts/report-llm-invariants.test.ts`
- `scripts/report-selfplay.test.ts`

Those need the corpus config and/or a long timeout (`vitest.corpus.config.ts`).

## Commands

```bash
npm test
npx vitest run src/lib/engine/effects/batch6Effects.test.ts
npx vitest run src/lib/engine/effects/batch6Effects.test.ts -t "ACE Nullifier"
npx vitest run --reporter=verbose src/lib/deck/validator.test.ts
npm run test:cri-playtest
npm run lint
```

Playwright is not installed. There is no `TEST_ENV`, no HTML report, no
`trace.zip`. Failure output is the Vitest reporter in the terminal.

## Environment

Default tests are offline (mocks + local corpus). Do not call pokemontcg.io
from a unit test. API key lives in `.env.local` and is only for app/dev and
the excluded prepare scripts.
