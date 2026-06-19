import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { parseTrainerText } from "./trainerText";

function trainer(name: string, subtype: string, rules: string): CardDefinition {
  return {
    apiId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    supertype: "Trainer",
    subtypes: [subtype],
    rules: [rules],
    set: { id: "cri", name: "CRI" },
    number: "0",
    images: { small: "", large: "" },
  };
}

describe("CRI trainer parse wiring", () => {
  it("Ruffian → trainer_ruffian", () => {
    const r = parseTrainerText(
      trainer("Ruffian", "Supporter", "Discard a Pokémon Tool and a Special Energy from 1 of your opponent's Pokémon."),
    );
    expect(r.effects.map((e) => e.kind)).toContain("trainer_ruffian");
  });

  it("Transformation Tome → trainer_transformation_tome", () => {
    const r = parseTrainerText(
      trainer("Transformation Tome", "Item", "You must play 2 Transformation Tome cards at once. Choose a Basic Pokémon in your discard pile and switch it with 1 of your Basic Pokémon in play."),
    );
    expect(r.effects.map((e) => e.kind)).toContain("trainer_transformation_tome");
  });
});
