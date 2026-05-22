import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { shouldBlockBenchEffectDamage } from "./stadiumEffects";
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

export function canReceiveBenchAttackDamage(
  state: EngineState,
  pokemon: CardInstance,
  sourcePlayerId?: PlayerId,
): boolean {
  if (pokemon.zone !== Zone.Bench) return true;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  if (hasTeraBenchProtection(def)) return false;
  if (sourcePlayerId !== undefined && shouldBlockBenchEffectDamage(state, pokemon, sourcePlayerId)) {
    return false;
  }
  return true;
}
