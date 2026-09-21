# Effects: parse vs runtime vs playtest

Pick the cheapest test that would go red if the bug came back.

## 1. Parse-only

When the question is "does this card text become the right `ParsedEffect`?"

```ts
expect(parseAttackText("Draw a card.")).toEqual([{ kind: "draw", count: 1, target: "self" }]);
expect(parseAbilityText({ name: "ACE Nullifier", type: "Ability", text: "…" }).effects).toEqual([
  { kind: "block_opponent_ace_spec_when_tool_attached" },
]);
```

Stadium / trainer parsers: `parseStadiumFullText`, trainer text helpers already
imported by the sibling file. **Use the `kind` strings source already emits** —
read `parseText.ts` (and bulk/trainer/tool siblings) first.

## 2. Runtime engine

When the question is "does the board actually change?"

- Attach Pokémon / Tool / Energy onto a `setupActiveGame` or `battleState`.
- Call `executeEffects`, `gameReducer`, `canPlayItemFromHand`, `onKnockOut`, etc.
- Assert zones, HP, attached cards, flags, or legal actions.

`batch6Effects.test.ts` (ACE Nullifier + Prime Catcher) is the template:
parse test + a follow-up `it()` that mutates the board.

## 3. Playtest / meta

When the question is "does this deck still build / this signature stay implemented?"

Use existing presets (`CRI_PLAYTEST_DECKS`, tournament JSON) and helpers like
`runMatchFromBuiltDecks`, `analyzeCriDeck`. Do not invent a new preset JSON
for a single unit assertion — add a focused engine `it()` instead.

## Unknown corpus text

`data/standard/unknown-patterns.json` is a backlog, not a test fixture.
To cover a pattern: implement/parse it in source, then add parse + runtime
tests, then regenerate corpus only if the user asked (`npm run prepare:standard`).
