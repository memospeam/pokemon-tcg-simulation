import { getTournamentDeckById, type TournamentDeckPreset } from "./tournamentPresets";

export interface PublicMatchup {
  id: string;
  title: string;
  detail: string;
  youId: string;
  aiId: string;
  testId?: string;
}

/** One-click Worlds 2026 matches for the public lobby. */
export const PUBLIC_MATCHUPS: PublicMatchup[] = [
  {
    id: "dragapult-mirror",
    title: "Dragapult mirror",
    detail: "Worlds champion vs 3rd",
    youId: "worlds26-1-andrew-hedrick",
    aiId: "worlds26-3-brent-tonisson",
    testId: "quick-dragapult",
  },
  {
    id: "dragapult-crustle",
    title: "Dragapult vs Crustle",
    detail: "Worlds 1st vs 5th",
    youId: "worlds26-1-andrew-hedrick",
    aiId: "worlds26-5-rune-heiremans",
  },
  {
    id: "alakazam-dragapult",
    title: "Alakazam vs Dragapult",
    detail: "Worlds 2nd vs 1st",
    youId: "worlds26-2-diego-cassiraga",
    aiId: "worlds26-1-andrew-hedrick",
  },
  {
    id: "zoroark-ogerpon",
    title: "Zoroark vs Ogerpon",
    detail: "Worlds 9th vs 8th",
    youId: "worlds26-9-ojvind-svinhufvud",
    aiId: "worlds26-8-nathan-spry",
  },
];

function requirePreset(id: string): TournamentDeckPreset {
  const deck = getTournamentDeckById(id);
  if (!deck) throw new Error(`Missing tournament deck ${id}`);
  return deck;
}

export function matchupSides(matchup: PublicMatchup): {
  you: { name: string; text: string };
  ai: { name: string; text: string };
} {
  const you = requirePreset(matchup.youId);
  const ai = requirePreset(matchup.aiId);
  return {
    you: { name: you.deckName, text: you.text },
    ai: { name: ai.deckName, text: ai.text },
  };
}
