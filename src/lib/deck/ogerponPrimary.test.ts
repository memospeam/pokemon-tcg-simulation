import { describe, expect, it } from "vitest";
import { getArchetypeEnergyPriority } from "./deckStrategy";

/**
 * Ogerpon Box is a toolbox with many attackers, but the heuristic AI plays best
 * when it funnels energy onto ONE attacker rather than spreading it (which left
 * it chip-attacking with Wellspring's Sob for 20). Mega Kangaskhan ex is the
 * designated primary: Rapid-Fire Combo costs 3 Colorless (any energy works) for
 * 200+, on a 300 HP body. This test locks in that energy-priority ordering.
 */
describe("Ogerpon Box — energy focuses on Mega Kangaskhan ex", () => {
  const prio = (name: string) => getArchetypeEnergyPriority("ogerpon-box", name);

  it("Mega Kangaskhan ex is the clear top energy priority", () => {
    const kang = prio("mega kangaskhan ex");
    expect(kang).toBeGreaterThanOrEqual(90); // primary-attacker protection tier (≥85)
    // It must outrank every other attacker so energy concentrates on it.
    for (const other of [
      "wellspring mask ogerpon ex",
      "teal mask ogerpon ex",
      "lillie's clefairy ex",
      "latias ex",
      "iron leaves ex",
    ]) {
      expect(kang, `kangaskhan vs ${other}`).toBeGreaterThan(prio(other));
    }
  });

  it("Teal Mask Ogerpon ex (setup accelerator) is low priority — not an energy sink", () => {
    expect(prio("teal mask ogerpon ex")).toBeLessThan(50);
  });
});
