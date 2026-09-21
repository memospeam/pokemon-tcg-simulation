---
name: asuna-plan
description: >-
  Turn a card list, unknown-pattern backlog, or informal test note into a
  structured automation plan for pokemon-tcg-simulation before any code is
  written. Use when the user shares a list of cards/effects, points at
  data/standard/unknown-patterns.json, or says "plan coverage", "วิเคราะห์ TC",
  "มีเคสใหม่", "cover ใบนี้".
---

# Coverage plan (no code yet)

Read the input, map each item to an existing test file, and hand the plan to
the user. Asuna writes tests only after they approve.

## Step 1 — Read the input

Accept a file path, pasted table, card names, or `unknown-patterns.json` entries.
For each item extract: id/name, mechanic (attack / ability / trainer / rule),
expected behaviour, and any example cards.

## Step 2 — Classify

| Keyword | Likely file |
|---------|-------------|
| parse / card text / effect kind | `src/lib/engine/effects/parseText.test.ts` or the batch file that already covers that family |
| runtime board / HP / KO / attach | sibling `*Effects.test.ts` or a new `it()` next to the executor |
| CRI / Chaos Rising deck | `src/lib/deck/criPlaytest.test.ts`, `cri*Scenarios.test.ts` |
| tournament / matrix / Worlds | `src/lib/deck/top16Playtest.test.ts`, `worlds*.test.ts` |
| invariant / duplicate zone | `src/lib/deck/invariants.test.ts` |
| decklist / 60 cards / copies | `src/lib/deck/validator.test.ts` |
| UI route / Battle / Analysis | say so — almost no DOM tests today; confirm before adding |

If no sibling file exists, the plan should say **new `*.test.ts` next to source**.

## Step 3 — Action per item

| Action | When |
|--------|------|
| **Add `it()` to existing file** | Mechanic already has a describe |
| **New test file** | Source file has no `*.test.ts` |
| **Parse + runtime pair** | New effect kind (parse first, then one board assertion) |
| **Manual / skip** | Needs live API, visual VFX, or human judgement |

## Step 4 — Output

```
## Automation Plan

| ID / card | Behaviour | File | Action | Complexity | Notes |
|-----------|-----------|------|--------|------------|-------|

### Questions before coding
- [ ] Parse-only vs runtime vs playtest for each item
- [ ] Priority order if not all items land in one pass
```

Complexity: **Low** = one `it()`; **Medium** = new file reusing helpers;
**High** = new helper + implementation gap in engine (test cannot pass yet).

## Step 5 — Handoff

After approval, one item (or a small batch) at a time:

> เขียน: เพิ่ม `it()` ใน `<file>` — scenario: …, assert: …

Do not dump the raw backlog at asuna — distil it first.
