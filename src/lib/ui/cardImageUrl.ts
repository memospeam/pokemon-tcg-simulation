import type { CardDefinition } from "@/lib/models/definition";

/**
 * Derive the pokemontcg.io image URL from a card's apiId.
 * apiId format: "{setCode}-{number}" e.g. "sv5-128", "sv6pt5-1", "me1-84"
 * Corpus-built cards have images.small/large = "" so we fall back to this.
 */
function deriveImageBase(apiId: string): string {
  const lastDash = apiId.lastIndexOf("-");
  if (lastDash === -1) return "";
  const setCode = apiId.substring(0, lastDash);
  const number = apiId.substring(lastDash + 1);
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
