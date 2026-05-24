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
});
