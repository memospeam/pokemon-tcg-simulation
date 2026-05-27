import { describe, expect, it } from "vitest";
import { lookupAttackCost } from "./knownAttackCosts";

describe("knownAttackCosts — authoritative attack-cost overrides", () => {
  it("Team Rocket's Articuno · Dark Frost requires 1 Water energy (the original bug)", () => {
    const result = lookupAttackCost("Team Rocket's Articuno", "Dark Frost");
    expect(result).not.toBeNull();
    expect(result!.cost).toEqual(["Water"]);
    expect(result!.convertedEnergyCost ?? result!.cost.length).toBe(1);
  });

  it("Dragapult ex · Phantom Dive requires 2 Psychic + 1 Colorless (not the buggy 1-energy default)", () => {
    const result = lookupAttackCost("Dragapult ex", "Phantom Dive");
    expect(result).not.toBeNull();
    expect(result!.cost.sort()).toEqual(["Colorless", "Psychic", "Psychic"]);
    expect(result!.cost.length).toBe(3);
  });

  it("Greninja ex · Big Wave Splash requires 2 Water + 1 Colorless", () => {
    const result = lookupAttackCost("Greninja ex", "Big Wave Splash");
    expect(result).not.toBeNull();
    expect(result!.cost.length).toBe(3);
    expect(result!.cost.filter((c) => c === "Water").length).toBe(2);
    expect(result!.cost.filter((c) => c === "Colorless").length).toBe(1);
  });

  it("matches by substring so set-prefixed names still resolve", () => {
    // The corpus name may include extra qualifiers; substring matching keeps
    // the lookup robust without an exact equality check.
    expect(lookupAttackCost("team rocket's articuno", "Dark Frost")).not.toBeNull();
    expect(lookupAttackCost("DRI 51 Team Rocket's Articuno", "Dark Frost")).not.toBeNull();
  });

  it("returns null for cards / attacks not in the table — caller falls back", () => {
    expect(lookupAttackCost("Random Unknown Pokémon", "Random Attack")).toBeNull();
    expect(lookupAttackCost("Dragapult ex", "Not An Attack")).toBeNull();
  });
});
