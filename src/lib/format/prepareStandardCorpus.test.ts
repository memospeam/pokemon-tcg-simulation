import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { buildCorpus } from "./prepareStandardCorpus";

function mockCard(overrides: Partial<CardDefinition>): CardDefinition {
  return {
    apiId: "test-1",
    name: "Test Card",
    supertype: "Pokémon",
    subtypes: ["Basic"],
    set: { id: "me4", name: "Chaos Rising", ptcgoCode: "CRI" },
    number: "1",
    images: { small: "", large: "" },
    ...overrides,
  };
}

describe("buildCorpus — Energy supertype", () => {
  const bubbly = mockCard({
    apiId: "me4-84",
    name: "Bubbly Water Energy",
    supertype: "Energy",
    subtypes: ["Special"],
    number: "84",
    regulationMark: "J",
    rules: [
      "As long as this card is attached to a Pokémon, it provides Water Energy.\n\nThe Water Pokémon this card is attached to recovers from all Special Conditions and can't be affected by any Special Conditions.",
    ],
  });
  const pokemon = mockCard({
    apiId: "me4-1",
    name: "Some Mon",
    hp: "70",
    regulationMark: "J",
    attacks: [{ name: "Tackle", cost: ["Colorless"], convertedEnergyCost: 1, damage: "10", text: "" }],
  });

  it("indexes Special Energy cards with their rules text", () => {
    const corpus = buildCorpus([pokemon], [], [bubbly]);
    const entry = corpus.cards.find((card) => card.apiId === "me4-84");
    expect(entry).toBeDefined();
    expect(entry!.supertype).toBe("Energy");
    expect(entry!.subtypes).toEqual(["Special"]);
    expect(entry!.regulationMark).toBe("J");
    expect(entry!.set).toBe("CRI");
    expect(entry!.trainerRules?.text).toContain("provides Water Energy");
    expect(entry!.trainerRules?.textId).toMatch(/^energy-/);
    expect(corpus.manifest.totalEnergyCards).toBe(1);
  });

  it("keeps energy rules text out of the parsed effect-text records", () => {
    const corpus = buildCorpus([pokemon], [], [bubbly]);
    // Special Energy effects are implemented by name in the engine, not via
    // text parsing — their rules must not appear as trainer effect records.
    expect(corpus.effectTexts.some((record) => record.text.includes("provides Water Energy"))).toBe(false);
    expect(corpus.manifest.uniqueTrainerTexts).toBe(0);
  });

  it("still builds when no energy cards are passed (backwards compatible)", () => {
    const corpus = buildCorpus([pokemon], []);
    expect(corpus.cards).toHaveLength(1);
    expect(corpus.manifest.totalEnergyCards).toBe(0);
  });
});
