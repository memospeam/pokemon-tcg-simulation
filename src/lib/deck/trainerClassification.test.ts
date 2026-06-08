import { describe, expect, it } from "vitest";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import { isSupporter, isItemTrainer, isStadium, isTool } from "../models/definition";

/**
 * Trainer cards must be classified by their real corpus subtype, not a hand-
 * curated name list. A Supporter mislabelled as an Item never sets
 * turnFlags.supporterPlayed, letting a player play it AND a real Supporter in
 * the same turn (two Supporters/turn). A Stadium mislabelled as an Item never
 * enters the Stadium zone or applies its effect.
 */

function build(name: string, setNum: string) {
  const deck = buildPlaytestDeckFromCorpusText(
    "classification test",
    `Pokémon : 1
1 Dreepy TWM 128

Trainer : 1
1 ${name} ${setNum}

Energy : 1
1 Psychic Energy MEE 5`,
  );
  return [...deck.definitions.values()].find((d) => d.name === name)!;
}

describe("trainer classification from corpus", () => {
  it("Supporters mislabelled as Items are now Supporters (the two-Supporters bug)", () => {
    const cases: [string, string][] = [
      ["Cyrano", "SSP 170"],
      ["Wally's Compassion", "SVI 197"],
      ["Black Belt's Training", "JTG 143"],
      ["Brock's Scouting", "JTG 146"],
      ["Ciphermaniac's Codebreaking", "TEF 145"],
    ];
    for (const [name, sn] of cases) {
      const def = build(name, sn);
      expect(isSupporter(def), name).toBe(true);
      expect(isItemTrainer(def), name).toBe(false);
    }
  });

  it("Stadiums mislabelled as Items are now Stadiums", () => {
    for (const [name, sn] of [["Lumiose City", "POR 77"], ["N's Castle", "JTG 152"]] as [string, string][]) {
      const def = build(name, sn);
      expect(isStadium(def), name).toBe(true);
      expect(isItemTrainer(def), name).toBe(false);
    }
  });

  it("genuine Items stay Items (Ultra Ball, Team Rocket's Transceiver)", () => {
    for (const [name, sn] of [["Ultra Ball", "SVI 196"], ["Team Rocket's Transceiver", "DRI 178"]] as [string, string][]) {
      const def = build(name, sn);
      expect(isItemTrainer(def), name).toBe(true);
      expect(isSupporter(def), name).toBe(false);
    }
  });

  it("Air Balloon stays a Tool", () => {
    expect(isTool(build("Air Balloon", "SVI 156"))).toBe(true);
  });
});
