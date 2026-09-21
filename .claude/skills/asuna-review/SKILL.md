---
name: asuna-review
description: >-
  Review an EXISTING test change (diff / PR / working tree) in
  pokemon-tcg-simulation against colocated Vitest conventions, then verify by
  running the affected files. Use when the user asks to "review this test",
  "ตรวจ PR", "เขียนถูก convention ไหม", or wants a second pair of eyes on
  new/edited `*.test.ts` files.
---

# Reviewing test changes

## 1. Get the diff

```bash
git diff
git diff main...HEAD -- "*.test.ts"
```

Read changed test files in full when the diff is large.

## 2. Checklist

- [ ] File is `*.test.ts` next to the source it covers.
- [ ] Imports `describe, expect, it` from `vitest`.
- [ ] Helpers are file-local and match sibling style (`mockBasic`, `battleState`, …).
- [ ] No invented effect `kind` — matches parser/executor source.
- [ ] Parse tests use `toEqual` on effect arrays unless siblings use `toMatchObject`.
- [ ] Runtime tests pin `seed` when they deal a deck.
- [ ] No leftover `it.only` / `describe.only` / debug `console.log`.
- [ ] No Playwright / Testing Library / new framework.
- [ ] Diff is focused (no unrelated reformat).
- [ ] English titles, specific enough to `-t` filter.

## 3. Verify

```bash
npx vitest run <changed-test-files>
npx vitest run <changed-test-files> --reporter=verbose   # if titles matter
npm run lint   # if production types moved
```

For a refactor that must preserve behaviour, diff `it()` titles before/after.

## 4. Output

- **Must fix** — convention breaks, leftover `.only`, wrong kinds, red tests.
- **Should fix** — vague titles, duplicated 40-line setup that a sibling already has.
- **Nits** — style.
- Verdict: ready / changes needed. State what you actually ran.
