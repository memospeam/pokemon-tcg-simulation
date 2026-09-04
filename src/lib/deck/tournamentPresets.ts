import tournamentNAIC from "../../../data/tournaments/518-top8.json";
import tournament535 from "../../../data/tournaments/535-top16.json";
import tournamentLA from "../../../data/tournaments/la-regionals-2026.json";
import tournamentWorlds25 from "../../../data/tournaments/worlds-2025.json";
import tournamentWorlds26 from "../../../data/tournaments/worlds-2026.json";

export interface TournamentDeckPreset {
  id: string;
  label: string;
  placement: number;
  player: string;
  deckName: string;
  text: string;
}

export interface TournamentPresetBundle {
  tournamentId: number;
  name: string;
  date: string;
  sourceUrl: string;
  decks: TournamentDeckPreset[];
}

export const NAIC_2026 = tournamentNAIC as TournamentPresetBundle;
export const TOURNAMENT_535_TOP16 = tournament535 as TournamentPresetBundle;
export const LA_REGIONALS_2026 = tournamentLA as TournamentPresetBundle;
export const WORLDS_2025 = tournamentWorlds25 as TournamentPresetBundle;
export const WORLDS_2026 = tournamentWorlds26 as TournamentPresetBundle;

/** All available tournaments, newest first. */
export const ALL_TOURNAMENTS: TournamentPresetBundle[] = [
  WORLDS_2026,
  NAIC_2026,
  TOURNAMENT_535_TOP16,
  LA_REGIONALS_2026,
  WORLDS_2025,
];

export function getTournamentDeckById(id: string): TournamentDeckPreset | undefined {
  for (const tournament of ALL_TOURNAMENTS) {
    const deck = tournament.decks.find((d) => d.id === id);
    if (deck) return deck;
  }
  return undefined;
}

export function getAllDecks(): TournamentDeckPreset[] {
  return ALL_TOURNAMENTS.flatMap((t) => t.decks);
}

/** All Top 8 decks from World Championships 2026 (Limitless #515). */
export function getWorlds2026Decks(): TournamentDeckPreset[] {
  return WORLDS_2026.decks;
}
