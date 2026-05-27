import { describe, expect, it } from "vitest";
import { lookupAttackCost } from "./knownAttackCosts";

describe("knownAttackCosts — verified entries", () => {
  it("Team Rocket's Articuno · Dark Frost requires 1 Water energy", () => {
    const result = lookupAttackCost("Team Rocket's Articuno", "Dark Frost");
    expect(result).not.toBeNull();
    expect(result!.cost).toEqual(["Water"]);
    expect(result!.unverified).toBeUndefined();
  });

  it("Dragapult ex · Phantom Dive requires 1 Psychic + 1 Fire (user-corrected)", () => {
    const result = lookupAttackCost("Dragapult ex", "Phantom Dive");
    expect(result).not.toBeNull();
    // Real cost on TWM 130 is P + R (1 Psychic, 1 Fire) — total 2 energy.
    expect(result!.cost.sort()).toEqual(["Fire", "Psychic"]);
    expect(result!.cost.length).toBe(2);
    expect(result!.unverified).toBeUndefined();
  });

  it("Alakazam · Powerful Hand requires just 1 Psychic (user-corrected)", () => {
    const result = lookupAttackCost("Alakazam", "Powerful Hand");
    expect(result).not.toBeNull();
    expect(result!.cost).toEqual(["Psychic"]);
    expect(result!.cost.length).toBe(1);
    expect(result!.unverified).toBeUndefined();
  });
});

describe("knownAttackCosts — unverified entries are tagged", () => {
  it("Jet Headbutt is flagged unverified (best-effort estimate)", () => {
    const result = lookupAttackCost("Dragapult ex", "Jet Headbutt");
    expect(result).not.toBeNull();
    expect(result!.unverified).toBe(true);
  });
});

describe("knownAttackCosts — lookup mechanics", () => {
  it("matches by substring so set-prefixed names still resolve", () => {
    expect(lookupAttackCost("team rocket's articuno", "Dark Frost")).not.toBeNull();
    expect(lookupAttackCost("DRI 51 Team Rocket's Articuno", "Dark Frost")).not.toBeNull();
  });

  it("returns null for cards / attacks not in the tables — caller falls back", () => {
    expect(lookupAttackCost("Random Unknown Pokémon", "Random Attack")).toBeNull();
    expect(lookupAttackCost("Dragapult ex", "Not An Attack")).toBeNull();
  });
});
