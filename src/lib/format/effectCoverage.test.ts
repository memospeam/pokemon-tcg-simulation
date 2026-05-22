import { describe, expect, it } from "vitest";
import { analyzeParsedEffects } from "./effectCoverage";
import type { ParsedEffect } from "../engine/effects/types";

describe("analyzeParsedEffects", () => {
  it("marks typed effects as implemented", () => {
    const effects: ParsedEffect[] = [{ kind: "draw", count: 1, target: "self" }];
    expect(analyzeParsedEffects(effects).implementationCoverage).toBe("implemented");
  });

  it("marks generic stubs as stub", () => {
    const effects: ParsedEffect[] = [{ kind: "generic_effect_stub", text: "some clause" }];
    expect(analyzeParsedEffects(effects).implementationCoverage).toBe("stub");
  });

  it("marks mixed typed and stub as partial_stub", () => {
    const effects: ParsedEffect[] = [
      { kind: "damage", amount: 20, target: "opponent_active", applyWeaknessRes: true },
      { kind: "generic_effect_stub", text: "leftover clause" },
    ];
    expect(analyzeParsedEffects(effects).implementationCoverage).toBe("partial_stub");
  });
});
