import { describe, expect, it } from "vitest";
import { dedupeDecksByName } from "./tournamentPresets";
import type { TournamentDeckPreset } from "./tournamentPresets";

const sample: TournamentDeckPreset[] = [
  {
    id: "a",
    label: "#1 A",
    placement: 1,
    player: "P1",
    deckName: "Dragapult",
    text: "",
  },
  {
    id: "b",
    label: "#3 B",
    placement: 3,
    player: "P2",
    deckName: "Dragapult",
    text: "",
  },
  {
    id: "c",
    label: "#2 C",
    placement: 2,
    player: "P3",
    deckName: "Alakazam",
    text: "",
  },
];

describe("dedupeDecksByName", () => {
  it("keeps the best placement per deck name", () => {
    const result = dedupeDecksByName(sample);
    expect(result.map((deck) => deck.id)).toEqual(["a", "c"]);
  });
});
