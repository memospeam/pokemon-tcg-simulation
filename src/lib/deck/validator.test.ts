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

  it("enforces max 4 copies", () => {
    const cards = [
      ...Array.from({ length: 4 }, () => mockCard("Pikachu")),
      ...Array.from({ length: 56 }, (_, i) => mockCard(`Other ${i}`)),
    ];
    cards.push(mockCard("Pikachu"));
    const result = validateDeck(cards);
    expect(result.valid).toBe(false);
  });

  it("passes a valid 60-card deck", () => {
    const cards = Array.from({ length: 60 }, (_, i) => mockCard(`Mon ${i}`));
    const result = validateDeck(cards);
    expect(result.valid).toBe(true);
  });
});
