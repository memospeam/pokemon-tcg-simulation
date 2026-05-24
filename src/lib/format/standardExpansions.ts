/** Play! Pokémon Standard expansions we track for deck import and effect prioritization. */
export interface StandardExpansion {
  /** pokemontcg.io set id (lowercase). */
  id: string;
  /** Limitless / PTCGO set code used in decklists. */
  ptcgoCode: string;
  name: string;
  series: string;
  releaseDate: string;
}

/**
 * Current Standard-legal expansions (regulation H/I/J, 2026 rotation).
 * Ordered newest first — use the head of this list for implementation priority.
 */
export const STANDARD_EXPANSIONS: StandardExpansion[] = [
  { id: "me4", ptcgoCode: "CRI", name: "Chaos Rising", series: "Mega Evolution", releaseDate: "2026-05-22" },
  { id: "me3", ptcgoCode: "POR", name: "Perfect Order", series: "Mega Evolution", releaseDate: "2026-03-27" },
  { id: "me2pt5", ptcgoCode: "ASC", name: "Ascended Heroes", series: "Mega Evolution", releaseDate: "2026-01-30" },
  { id: "me2", ptcgoCode: "PFL", name: "Phantasmal Flames", series: "Mega Evolution", releaseDate: "2025-11-14" },
  { id: "me1", ptcgoCode: "MEG", name: "Mega Evolution", series: "Mega Evolution", releaseDate: "2025-09-26" },
  { id: "rsv10pt5", ptcgoCode: "WHT", name: "White Flare", series: "Scarlet & Violet", releaseDate: "2025-07-18" },
  { id: "zsv10pt5", ptcgoCode: "BLK", name: "Black Bolt", series: "Scarlet & Violet", releaseDate: "2025-07-18" },
  { id: "sv10", ptcgoCode: "DRI", name: "Destined Rivals", series: "Scarlet & Violet", releaseDate: "2025-05-30" },
  { id: "sv9", ptcgoCode: "JTG", name: "Journey Together", series: "Scarlet & Violet", releaseDate: "2025-03-28" },
  { id: "sv8pt5", ptcgoCode: "PRE", name: "Prismatic Evolutions", series: "Scarlet & Violet", releaseDate: "2025-01-17" },
  { id: "sv8", ptcgoCode: "SSP", name: "Surging Sparks", series: "Scarlet & Violet", releaseDate: "2024-11-08" },
  { id: "sv7", ptcgoCode: "SCR", name: "Stellar Crown", series: "Scarlet & Violet", releaseDate: "2024-09-13" },
  { id: "sv6pt5", ptcgoCode: "SFA", name: "Shrouded Fable", series: "Scarlet & Violet", releaseDate: "2024-08-02" },
  { id: "sv6", ptcgoCode: "TWM", name: "Twilight Masquerade", series: "Scarlet & Violet", releaseDate: "2024-05-24" },
  { id: "sv5", ptcgoCode: "TEF", name: "Temporal Forces", series: "Scarlet & Violet", releaseDate: "2024-03-22" },
];

/** Latest Standard expansion — primary target for new engine/parser work. */
export const FOCUS_EXPANSION = STANDARD_EXPANSIONS[0]!;

export function getStandardExpansionByPtcgoCode(code: string): StandardExpansion | undefined {
  const upper = code.toUpperCase();
  return STANDARD_EXPANSIONS.find((entry) => entry.ptcgoCode === upper);
}

export function isFocusExpansionPtcgoCode(code: string): boolean {
  return code.toUpperCase() === FOCUS_EXPANSION.ptcgoCode;
}
