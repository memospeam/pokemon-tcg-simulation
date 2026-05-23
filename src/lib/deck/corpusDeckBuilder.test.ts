import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "./tournamentPresets";
import { validateDeckTextAgainstCorpus } from "./corpusDeckBuilder";

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
});
