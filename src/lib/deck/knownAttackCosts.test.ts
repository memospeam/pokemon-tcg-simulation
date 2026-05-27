import { describe, expect, it } from "vitest";
import { lookupAttackCost } from "./knownAttackCosts";

/**
 * The override table is currently empty — every meta card is covered by the
 * fetched dataset (`data/standard/attack-costs.json`). These tests just lock
 * in the lookup mechanics so the file remains a usable backstop if entries
 * ever need to be added back.
 */
describe("knownAttackCosts — backstop lookup", () => {
  it("returns null when no override exists for a given (Pokémon, attack)", () => {
    expect(lookupAttackCost("Random Unknown Pokémon", "Random Attack")).toBeNull();
    expect(lookupAttackCost("Dragapult ex", "Anything")).toBeNull();
  });

  it("substring matching tolerates name prefixes / qualifiers", () => {
    // Even without entries, the call shouldn't throw on lower-cased substring
    // checks — confirms the matcher is shape-stable.
    expect(() => lookupAttackCost("TWM Dragapult ex", "X")).not.toThrow();
  });
});
