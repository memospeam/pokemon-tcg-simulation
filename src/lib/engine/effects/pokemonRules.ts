import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { Zone } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import type { EngineState } from "../types";

export function hasTeraBenchProtection(def: CardDefinition): boolean {
  if (!def.subtypes.includes("Tera")) return false;
  return (
    def.rules?.some((rule) => {
      const lower = rule.toLowerCase();
      return lower.includes("as long as this pokémon is on your bench") && lower.includes("prevent all damage");
    }) ?? false
  );
}

export function canReceiveBenchAttackDamage(state: EngineState, pokemon: CardInstance): boolean {
  if (pokemon.zone !== Zone.Bench) return true;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return !hasTeraBenchProtection(def);
}
