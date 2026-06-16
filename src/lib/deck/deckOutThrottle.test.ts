import { describe, expect, it } from "vitest";
import { applyDeckOutAbilityPenalty } from "./deckOutAwareness";

describe("applyDeckOutAbilityPenalty tiers", () => {
  const RUN_ERRAND = "run errand"; // a pure-draw (deck-draining) ability

  it("does not touch non-draining abilities at any deck size", () => {
    expect(applyDeckOutAbilityPenalty(90, "subjugating chains", 2)).toBe(90);
    expect(applyDeckOutAbilityPenalty(90, "phantom dive", 5)).toBe(90);
  });

  it("leaves a healthy deck unpenalised", () => {
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 20)).toBe(90);
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 14)).toBe(90);
  });

  it("applies the medium penalty in the 8-13 window (mill prevention)", () => {
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 13)).toBe(72);
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 8)).toBe(72);
  });

  it("applies the hard penalty at 4-7 and shuts off at <=3", () => {
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 7)).toBe(55);
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 4)).toBe(55);
    expect(applyDeckOutAbilityPenalty(90, RUN_ERRAND, 3)).toBe(-1);
  });

  it("never drives the medium/hard tiers below zero", () => {
    expect(applyDeckOutAbilityPenalty(10, RUN_ERRAND, 13)).toBe(0);
    expect(applyDeckOutAbilityPenalty(10, RUN_ERRAND, 7)).toBe(0);
  });
});
