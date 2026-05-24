import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "./tournamentPresets";
import { buildPlaytestDeckFromCorpusText, validateDeckTextAgainstCorpus } from "./corpusDeckBuilder";

describe("corpus deck builder", () => {
  it("resolves all cards in Lopunny, Dragapult, and Hydrapple meta decks", () => {
    const deckIds = [
      "utrecht-1-miloslav-posledni",
      "utrecht-2-hasan-kunukcu",
      "utrecht-16-fabian-kern",
    ];

    for (const id of deckIds) {
      const deck = getTournamentDeckById(id);
      expect(deck, id).toBeDefined();
      const result = validateDeckTextAgainstCorpus(deck!.text);
      expect(result.pokemonMissing, `${deck!.label}: ${result.pokemonMissing.join("; ")}`).toEqual([]);
      expect(result.pokemonResolved).toBeGreaterThan(0);
    }
  });

  it("builds playable 60-card decks for all Utrecht Top 16 lists", () => {
    const deckIds = [
      "utrecht-1-miloslav-posledni",
      "utrecht-2-hasan-kunukcu",
      "utrecht-4-joshua-vanoverschelde",
      "utrecht-16-fabian-kern",
    ];
    for (const id of deckIds) {
      const preset = getTournamentDeckById(id)!;
      const built = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
      expect(built.resolveErrors, preset.label).toEqual([]);
      expect(built.cards, preset.label).toHaveLength(60);
      expect(built.validation.valid, preset.label).toBe(true);
    }
  });

  it("preserves MEGA ex subtypes from corpus for CRI evolution lines", () => {
    const greninjaText = `Pokémon : 3
1 Froakie CRI 20
1 Frogadier CRI 21
1 Mega Greninja ex CRI 22

Trainer : 0

Energy : 0`;
    const built = buildPlaytestDeckFromCorpusText("Mega Greninja line", greninjaText);
    const greninja = [...built.definitions.values()].find((entry) => entry.name === "Mega Greninja ex");
    expect(greninja?.subtypes).toEqual(["Stage 2", "MEGA", "ex"]);
    expect(greninja?.evolvesFrom).toBe("Frogadier");

    const galladeText = `Pokémon : 3
1 Ralts MEG 58
1 Kirlia MEG 59
1 Mega Gallade ex CRI 48

Trainer : 0

Energy : 0`;
    const galladeBuilt = buildPlaytestDeckFromCorpusText("Mega Gallade line", galladeText);
    const gallade = [...galladeBuilt.definitions.values()].find((entry) => entry.name === "Mega Gallade ex");
    expect(gallade?.subtypes).toEqual(["Stage 2", "MEGA", "ex"]);
    expect(gallade?.evolvesFrom).toBe("Kirlia");
  });
});
