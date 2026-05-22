import { describe, expect, it } from "vitest";
import { hasRuleBox, isPokemonWithoutRuleBox } from "../models/definition";

describe("hasRuleBox", () => {
  it("detects ex Pokémon", () => {
    expect(
      hasRuleBox({
        apiId: "1",
        name: "Dragapult ex",
        supertype: "Pokémon",
        subtypes: ["Stage 2", "ex", "Tera"],
        set: { id: "t", name: "T" },
        number: "1",
        images: { small: "", large: "" },
      }),
    ).toBe(true);
  });

  it("allows non-ex Pokémon for Poké Pad", () => {
    const dreepy = {
      apiId: "2",
      name: "Dreepy",
      supertype: "Pokémon" as const,
      subtypes: ["Basic"],
      set: { id: "t", name: "T" },
      number: "2",
      images: { small: "", large: "" },
    };
    expect(hasRuleBox(dreepy)).toBe(false);
    expect(isPokemonWithoutRuleBox(dreepy)).toBe(true);
  });
});
