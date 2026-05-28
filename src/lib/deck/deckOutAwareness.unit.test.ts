import { describe, expect, it } from "vitest";
import {
  applyDeckOutAbilityPenalty,
  applyDeckOutTrainerPenalty,
  isDeckDrainingTrainerName,
} from "./deckOutAwareness";

/**
 * Unit tests for the extracted deck-out awareness module. The integration
 * scenario (end-to-end via pickAutoTrainerAction) is covered by
 * deckOutAwareness.test.ts; these tests pin down the pure-function contract.
 */

describe("isDeckDrainingTrainerName", () => {
  it.each([
    "professor's research",
    "professor sada",
    "professor turo",
    "hilda",
    "ultra ball",
    "nest ball",
    "buddy-buddy poffin",
    "poffin",
    "pokégear",
    "crispin",
    "dawn",
    "colress",
  ])("flags %s as deck-draining", (name) => {
    expect(isDeckDrainingTrainerName(name)).toBe(true);
  });

  it.each([
    "iono",
    "lillie's determination",
    "boss's orders",
    "night stretcher",
    "crushing hammer",
    "rare candy",
    "switch",
  ])("does NOT flag %s as deck-draining", (name) => {
    expect(isDeckDrainingTrainerName(name)).toBe(false);
  });
});

describe("applyDeckOutTrainerPenalty", () => {
  it("critical deck (≤4) zeroes out drain trainers", () => {
    expect(applyDeckOutTrainerPenalty(88, "professor's research", 3)).toBe(-1);
    expect(applyDeckOutTrainerPenalty(72, "ultra ball", 4)).toBe(-1);
  });

  it("low deck (≤10) applies a -35 penalty to drain trainers", () => {
    expect(applyDeckOutTrainerPenalty(88, "professor's research", 8)).toBe(88 - 35);
  });

  it("healthy deck leaves drain trainers untouched", () => {
    expect(applyDeckOutTrainerPenalty(88, "professor's research", 25)).toBe(88);
  });

  it("critical deck boosts Iono / Lillie's to at least 90", () => {
    expect(applyDeckOutTrainerPenalty(45, "iono", 2)).toBeGreaterThanOrEqual(90);
    expect(applyDeckOutTrainerPenalty(60, "lillie's determination", 4)).toBeGreaterThanOrEqual(90);
  });

  it("low deck nudges Iono / Lillie's by +10", () => {
    expect(applyDeckOutTrainerPenalty(55, "iono", 9)).toBe(55 + 10);
    expect(applyDeckOutTrainerPenalty(70, "lillie's determination", 10)).toBe(70 + 10);
  });

  it("healthy deck leaves Iono / Lillie's untouched", () => {
    expect(applyDeckOutTrainerPenalty(55, "iono", 30)).toBe(55);
  });

  it("ignores non-deck-impacting trainers entirely", () => {
    expect(applyDeckOutTrainerPenalty(45, "boss's orders", 2)).toBe(45);
    expect(applyDeckOutTrainerPenalty(45, "boss's orders", 30)).toBe(45);
  });
});

describe("applyDeckOutAbilityPenalty", () => {
  it.each(["trade", "recon directive", "run errand", "run away draw", "psychic draw"])(
    "blocks %s when deck ≤ 3",
    (ability) => {
      expect(applyDeckOutAbilityPenalty(80, ability, 2)).toBe(-1);
      expect(applyDeckOutAbilityPenalty(80, ability, 3)).toBe(-1);
    },
  );

  it("clamps draw abilities by -35 when deck is 4-7", () => {
    expect(applyDeckOutAbilityPenalty(80, "recon directive", 7)).toBe(80 - 35);
    expect(applyDeckOutAbilityPenalty(50, "trade", 5)).toBe(50 - 35);
  });

  it("Math.max(0, …) guards against negative scores in the 4-7 window", () => {
    expect(applyDeckOutAbilityPenalty(10, "trade", 5)).toBe(0);
  });

  it("does not modify drain abilities when deck is healthy", () => {
    expect(applyDeckOutAbilityPenalty(80, "recon directive", 20)).toBe(80);
  });

  it("does not touch non-drain abilities at any deck size", () => {
    expect(applyDeckOutAbilityPenalty(80, "cursed blast", 2)).toBe(80);
    expect(applyDeckOutAbilityPenalty(80, "adrena-brain", 5)).toBe(80);
  });
});
