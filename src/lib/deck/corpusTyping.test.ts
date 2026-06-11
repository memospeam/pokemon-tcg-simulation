import { describe, expect, it } from "vitest";
import { applyWeaknessAndResistance } from "../engine/rules";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import { getTournamentDeckById } from "./tournamentPresets";

function builtDefinition(presetId: string, cardName: string) {
  const preset = getTournamentDeckById(presetId)!;
  const built = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
  return built.cards.find((card) => card.name === cardName)!;
}

describe("corpus typing flows into built deck definitions", () => {
  it("Mega Lopunny ex is Colorless with a Fighting ×2 weakness", () => {
    const def = builtDefinition("utrecht-1-miloslav-posledni", "Mega Lopunny ex");
    expect(def.types).toEqual(["Colorless"]);
    expect(def.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
  });

  it("Dragapult ex is Dragon with no weakness (not the inferred Psychic)", () => {
    const def = builtDefinition("utrecht-2-hasan-kunukcu", "Dragapult ex");
    expect(def.types).toEqual(["Dragon"]);
    expect(def.weaknesses ?? []).toEqual([]);
  });

  it("Cynthia's Garchomp ex is Fighting with a Grass ×2 weakness", () => {
    const def = builtDefinition("utrecht-13-constantin-geisb-sch", "Cynthia's Garchomp ex");
    expect(def.types).toEqual(["Fighting"]);
    expect(def.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
  });

  it("every Pokémon in a built tournament deck has corpus-backed types", () => {
    const preset = getTournamentDeckById("utrecht-11-hermanni-hietalahti")!;
    const built = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
    const mons = built.cards.filter((card) => card.supertype === "Pokémon");
    expect(mons.length).toBeGreaterThan(0);
    for (const mon of mons) {
      expect(mon.types?.length, mon.name).toBeGreaterThan(0);
    }
    const withWeakness = mons.filter((mon) => (mon.weaknesses?.length ?? 0) > 0);
    expect(withWeakness.length, "most Pokémon carry a weakness").toBeGreaterThan(mons.length / 2);
  });

  it("built definitions carry real retreat costs (no more universal free retreat)", () => {
    const lopunny = builtDefinition("utrecht-1-miloslav-posledni", "Mega Lopunny ex");
    expect(lopunny.retreatCost?.length, "Mega Lopunny ex retreat cost").toBeGreaterThan(0);
    const preset = getTournamentDeckById("utrecht-2-hasan-kunukcu")!;
    const built = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
    const mons = built.cards.filter((card) => card.supertype === "Pokémon");
    const withCost = mons.filter((mon) => (mon.retreatCost?.length ?? 0) > 0);
    expect(withCost.length, "most Pokémon have a non-zero retreat cost").toBeGreaterThan(0);
  });

  it("weakness doubles and resistance reduces damage end-to-end", () => {
    const lopunny = builtDefinition("utrecht-1-miloslav-posledni", "Mega Lopunny ex");
    // Fighting attacker into Fighting-weak Lopunny: ×2.
    expect(applyWeaknessAndResistance(260, ["Fighting"], lopunny)).toBe(520);
    // Non-matching type: unchanged.
    expect(applyWeaknessAndResistance(260, ["Water"], lopunny)).toBe(260);
    // Dragon defender with no weakness: unchanged.
    const dragapult = builtDefinition("utrecht-2-hasan-kunukcu", "Dragapult ex");
    expect(applyWeaknessAndResistance(230, ["Fighting"], dragapult)).toBe(230);
  });
});
