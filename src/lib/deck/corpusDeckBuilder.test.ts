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

  it("builds playable 60-card decks for all Tournament Top 16 lists", () => {
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

  it("classifies Pokémon Tools as tools — not Items — even for reprinted printings", () => {
    // Regression: every Trainer was stubbed as ["Item"], so Air Balloon (a
    // Pokémon Tool) was treated as a resolve-and-discard Item and never attached
    // — its −2 retreat never applied. Tools must be classified by their corpus
    // subtype, with a name fallback for printings outside the Standard corpus
    // (Air Balloon's SVI 156 reprint isn't in the corpus; only BLK/MEG/ASC are).
    const text = `Pokémon : 1
1 Dreepy TWM 128

Trainer : 4
1 Air Balloon SVI 156
1 Rescue Board TEF 159
1 Ultra Ball SVI 196
1 Boss's Orders PAL 172

Energy : 1
1 Psychic Energy MEE 5`;
    const built = buildPlaytestDeckFromCorpusText("Tool classification", text);
    const byName = (name: string) =>
      [...built.definitions.values()].find((d) => d.name === name)!;

    // Tools — subtype must mark them as a Pokémon Tool, never "Item".
    for (const toolName of ["Air Balloon", "Rescue Board"]) {
      const def = byName(toolName);
      expect(def.subtypes, toolName).toContain("Pokémon Tool");
      expect(def.subtypes, toolName).not.toContain("Item");
    }
    // Genuine Items / Supporters keep their classification.
    expect(byName("Ultra Ball").subtypes).toEqual(["Item"]);
    expect(byName("Boss's Orders").subtypes).toEqual(["Supporter"]);
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
