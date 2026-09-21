---
name: asuna-debug
description: >-
  Triage a FAILING or flaky Vitest test in pokemon-tcg-simulation — read the
  assertion diff, decide test bug vs engine bug, find the root cause, and
  propose an in-convention fix. Use when a test went red or the user asks
  "ทำไม test fail", "test แดง", "flaky", "หาเหตุที่ fail", pastes a Vitest
  error, or points at a failed run.
---

# Debugging Vitest failures

Goal: a clear verdict — **test wrong vs engine bug vs flake** — plus a concrete
fix. Re-run the single test; do not start from the full suite.

## 1. Reproduce

```bash
npx vitest run <path> -t "<title>" --reporter=verbose
```

Read the assertion diff (expected vs received). For engine tests, that is usually
the whole story — there is no Playwright trace.

## 2. Read top-down

1. Which `it()` and which `expect` failed.
2. Was setup wrong (missing `definitions[id]`, wrong `Zone` tag, no energy attached)?
3. Did the parser emit a different `kind` than the test assumed?
4. Did a recent engine change make the test's expectation stale?

## 3. Flaky vs real

Lean **flaky** when the test depends on RNG/`seed` but didn't pin `seed`, or a
playtest matchup that can draw differently. Fix by pinning seed or asserting a
weaker invariant.

Lean **real engine bug** when the parser/executor disagrees with card text and
the test's expectation matches source comments + official text.

Lean **test bug** when the expectation invents a `kind` or board state the
implementation never promised.

## 4. Output

- **Test + assertion** that failed, raw diff.
- **Verdict**: flake / test bug / engine bug, with evidence.
- **Fix**: smallest in-style change (see `asuna-tests`).
- Re-run the same `-t` filter and report pass/fail honestly.
