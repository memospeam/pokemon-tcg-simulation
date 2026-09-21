---
name: asuna-run
description: >-
  Execute the pokemon-tcg-simulation Vitest suite — default npm test, one file,
  one -t filter, or an explicit slow corpus/report script. Use when the user
  wants to RUN tests (not diagnose): "run the tests", "รัน test", "รันไฟล์นี้",
  "รันทั้ง suite". (To WRITE tests use asuna-tests; to DIAGNOSE use asuna-debug.)
---

# Running tests

You **can** run Vitest locally. Run it. Do not claim pass/fail you didn't execute.

## Default

```bash
npm test
npx vitest run src/lib/engine/effects/batch6Effects.test.ts
npx vitest run src/lib/engine/effects/batch6Effects.test.ts -t "ACE Nullifier"
```

`vitest.config.ts` uses `environment: "node"` and excludes slow scripts.

## Named npm scripts (opt-in, often slow)

| Script | When |
|--------|------|
| `npm run test:cri-playtest` | CRI playtest files only |
| `npm run report:coverage` | coverage report test |
| `npm run report:cri-meta` | CRI meta readiness |
| `npm run prepare:standard` | refresh `data/standard/` (network + long timeout) |
| `npm run report:invariants` | deep invariant sweep (corpus config) |
| `npm run report:selfplay` | selfplay report (corpus config) |

Do not run prepare/report scripts unless asked — they are excluded from `npm test`
for a reason.

## After a background run

Read the reporter output. If you used `it.only`, remove it. Kill leftover vitest
watch processes if you accidentally started `vitest` without `run`.
