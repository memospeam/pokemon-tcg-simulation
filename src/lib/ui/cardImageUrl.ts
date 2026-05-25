import type { CardDefinition } from "@/lib/models/definition";

/**
 * Maps PTCGO/Limitless set codes (lowercase) to pokemontcg.io set IDs.
 * Stub trainer/energy cards use Limitless codes (e.g. "tef-144") as their apiId
 * since they aren't resolved from the API. We map those to real pokemontcg.io IDs.
 */
const PTCGO_TO_TCG_ID: Record<string, string> = {
  svi: "sv1",    // Scarlet & Violet Base Set
  pal: "sv2",    // Paldea Evolved
  obf: "sv3",    // Obsidian Flames
  mew: "sv3pt5", // 151
  par: "sv4",    // Paradox Rift
  paf: "sv4pt5", // Paldean Fates
  tef: "sv5",    // Temporal Forces
  twm: "sv6",    // Twilight Masquerade
  sfa: "sv6pt5", // Shrouded Fable
  scr: "sv7",    // Stellar Crown
  ssp: "sv8",    // Surging Sparks
  pre: "sv8pt5", // Prismatic Evolutions
  jtg: "sv9",    // Journey Together
  sve: "sve",    // Scarlet & Violet Energies
  svp: "svp",    // Scarlet & Violet Promos
};

/**
 * Derive the pokemontcg.io image URL from a card's apiId.
 * apiId format: "{setCode}-{number}" e.g. "sv5-128", "tef-144", "me1-84"
 * Corpus-built cards have images.small/large = "" so we fall back to this.
 * Custom/future sets (me1, meg, mee, por, etc.) have no CDN equivalent → returns "".
 */
function deriveImageBase(apiId: string): string {
  const lastDash = apiId.lastIndexOf("-");
  if (lastDash === -1) return "";
  const rawSetCode = apiId.substring(0, lastDash);
  const number = apiId.substring(lastDash + 1);
  // Map PTCGO codes to pokemontcg.io IDs; unknown codes fall through as-is.
  const setCode = PTCGO_TO_TCG_ID[rawSetCode] ?? rawSetCode;
  // pokemontcg.io only hosts sv* era sets; skip custom/future set codes.
  if (!setCode.startsWith("sv")) return "";
  return `https://images.pokemontcg.io/${setCode}/${number}`;
}

export function cardImageSmall(def: CardDefinition): string {
  if (def.images.small) return def.images.small;
  const base = deriveImageBase(def.apiId);
  return base ? `${base}.png` : "";
}

export function cardImageLarge(def: CardDefinition): string {
  if (def.images.large) return def.images.large;
  const base = deriveImageBase(def.apiId);
  return base ? `${base}_hires.png` : "";
}
