# Engine test helpers

Copy helpers **from the file you are editing**. Do not import helpers from
another test file. Names below are the common local patterns.

## `mockBasic` / filler cards

Minimal `CardDefinition` used everywhere. Keep the same fields the sibling uses
(`apiId`, `name`, `supertype`, `subtypes`, `hp`, `types`, `attacks`, `set`,
`number`, `images`). Extra fields (`abilities`, `rules`) only when that test needs them.

Deck padding is unique Energy/Trainer stubs so the 60-card / 4-copy rules stay
valid (`Fire Energy ${i}`, not 60 copies of one card).

## `setupActiveGame` (full beginGame path)

Use when the test needs a real dealt game (hand, prizes, seed):

1. `beginGame({ player1Cards, player2Cards, seed })`
2. Mulligan loop while `phase === GamePhase.Mulligan`
3. `PLACE_ACTIVE` a Basic from each hand
4. `startActiveGame(state)`
5. Then **overwrite** `active` / `definitions` / attached cards for the scenario

See `src/lib/engine/effects/batch6Effects.test.ts`.

## `battleState` (hand-built EngineState)

Use when you need a precise board and `beginGame` noise would hide the bug.
Build `EngineState` with `emptyTurnFlags()`, two players, one Active each, then
spread `overrides`. See `src/lib/engine/effects/criPhase3Effects.test.ts` and
`src/lib/deck/invariants.test.ts` (`baseState`).

## Driving the engine

```ts
state = gameReducer(state, { type: "PLACE_ACTIVE", playerId, instanceId });
state = executeEffects(state, playerId, effects, { sourceInstanceId });
```

Read `src/lib/engine/types.ts` for `EngineState` and `src/lib/models/enums.ts`
for `GamePhase` / `PlayerId` / `Zone`. After mutating a player's active, keep
`state.definitions[id]` in sync with the `CardDefinition` you attached.
