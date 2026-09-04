import { getTournamentDeckById, type TournamentDeckPreset } from "./tournamentPresets";

/** One representative per unique archetype from Utrecht Regional 2026-05-16. */
export const META_ARCHETYPE_DECK_IDS = [
  "utrecht-1-miloslav-posledni",
  "utrecht-2-hasan-kunukcu",
  "utrecht-4-joshua-vanoverschelde",
  "utrecht-7-luke-burke",
  "utrecht-8-fabio-battistella",
  "utrecht-11-hermanni-hietalahti",
  "utrecht-12-joris-van-dijk",
  "utrecht-13-constantin-geisb-sch",
  "utrecht-14-niklas-leitz",
  "utrecht-15-oscar-madsen",
  "utrecht-16-fabian-kern",
] as const;

export function getMetaArchetypeDecks(): TournamentDeckPreset[] {
  return META_ARCHETYPE_DECK_IDS.map((id) => {
    const deck = getTournamentDeckById(id);
    if (!deck) throw new Error(`Meta archetype deck not found: ${id}`);
    return deck;
  });
}
