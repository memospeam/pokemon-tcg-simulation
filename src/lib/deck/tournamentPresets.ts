import tournament535 from "../../../data/tournaments/535-top16.json";

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

export const UTRECHT_535_TOP16 = tournament535 as TournamentPresetBundle;

export function getTournamentDeckById(id: string): TournamentDeckPreset | undefined {
  return UTRECHT_535_TOP16.decks.find((deck) => deck.id === id);
}
