import type { CardInstance } from "../../models/instance";
import { flipCoin, logMessage } from "../helpers";
import { getDefinitionSafe } from "../rules";
import type { EngineState } from "../types";
import { parseAbilityText } from "./parseText";

export function trySurviveKnockout(
  state: EngineState,
  pokemon: CardInstance,
  hpBeforeDamage: number,
): boolean {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  const maxHp = parseInt(def.hp ?? "0", 10) || 0;
  if (maxHp <= 0 || hpBeforeDamage < maxHp) return false;

  for (const ability of def.abilities ?? []) {
    const parsed = parseAbilityText(ability);
    for (const effect of parsed.effects) {
      if (effect.kind === "survive_ko_full_hp") {
        pokemon.damageCounters = maxHp - 10;
        logMessage(state, `${def.name} was not Knocked Out and has 10 HP remaining.`);
        return true;
      }
      if (effect.kind === "survive_ko_coin" && flipCoin(state)) {
        pokemon.damageCounters = maxHp - 10;
        logMessage(state, `${def.name} survived with 10 HP (coin flip).`);
        return true;
      }
    }
  }
  return false;
}
