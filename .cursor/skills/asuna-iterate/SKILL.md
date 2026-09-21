---
name: asuna-iterate
description: >-
  Run pokemon-tcg-simulation Vitest cases one by one — add it.only or use -t,
  run, verify pass/fail, remove it.only, advance. Use when the user says
  "รันทีละ case", "ใส่ it.only ทีละข้อ", "รันเคสนี้ก่อน", or wants iterative
  one-by-one execution. (To WRITE tests use asuna-tests; to DIAGNOSE failures
  use asuna-debug; to RUN a whole file/suite use asuna-run.)
---

# Iterative case-by-case Vitest runs

## Run-one pattern

1. Identify the next `it("…")`.
2. Prefer **no file edit**: 
   ```bash
   npx vitest run <path> -t "<exact or unique substring>"
   ```
3. If `-t` is too broad, temporarily change `it(` → `it.only(`.
4. **Pass** → remove `.only` immediately, go to the next case.
5. **Fail** → fix (or `asuna-debug`), re-run before advancing.

### Rules

- At most one `it.only` in the repo. Never commit `.only`.
- Default timeout is 30s. Slow playtests may need a longer `it(..., { timeout })`
  only if siblings already do.
- Do not run excluded corpus scripts in this loop unless the user asked.

## Inspect pattern

There is no DOM dump here. To inspect engine state, add a temporary
`console.log` of the relevant slice (`getPlayer(state, PlayerId.P1)`, parsed
effects) inside the `it.only`, run, read stdout, then delete the log.

Do not leave debug `console.log` in committed tests.

## Failure handling

| Failure | Next step |
|---------|-----------|
| `kind` mismatch on parse | Read `parseText*.ts` — expected kind may be wrong, or parser gap |
| board assertion failed | Log zones / attached / hp; check definitions map is populated |
| timeout | Playtest too heavy — narrow to a unit `it()`, don't raise timeout first |
| import / TS error | `npm run lint` then fix types, don't skip the test |
