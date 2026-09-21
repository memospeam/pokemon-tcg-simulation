# Test file conventions (`*.test.ts` next to source)

## Skeleton

```ts
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { validateDeck } from "./validator";

function mockCard(name: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
    ...overrides,
  };
}

describe("validateDeck", () => {
  it("requires exactly 60 cards", () => {
    const result = validateDeck(Array.from({ length: 59 }, (_, i) => mockCard(`Mon ${i}`)));
    expect(result.valid).toBe(false);
  });
});
```

## Rules

- Colocate: `src/lib/deck/validator.ts` → `src/lib/deck/validator.test.ts`.
- One `describe` per unit (function, card, batch). Split with a second
  `describe` in the same file when the file already does (`toolEffects.test.ts`).
- Titles are English, specific, and stable (`-t` filters depend on them).
- No `it.only` / `describe.only` in committed code (see `asuna-iterate`).
- No assertion libraries other than Vitest's `expect`.
- Relative imports to the unit under test; `@/` only if siblings already use it.

## What not to add

- `__tests__/` folders, Jest, Testing Library, Playwright (unless asked).
- Shared `src/test-utils/` modules for a helper used once.
- Snapshots unless the neighbouring file already snapshots.
- Comments that restate the `it()` title.
