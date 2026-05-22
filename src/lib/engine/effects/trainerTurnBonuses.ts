import { isPokemonEx } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { getDefinitionSafe } from "../rules";
import type { EngineState } from "../types";

export function getTrainerTurnAttackBonus(
  state: EngineState,
  attacker: CardInstance,
  opponentActive: CardInstance,
): number {
  let bonus = 0;
  const attackerDef = getDefinitionSafe(state, attacker.definitionId);
  const defenderDef = getDefinitionSafe(state, opponentActive.definitionId);

  if (state.turnFlags.fightingActiveDamageBonus) {
    if (attackerDef.types?.includes("Fighting")) {
      bonus += state.turnFlags.fightingActiveDamageBonus;
    }
  }
  if (state.turnFlags.activeExDamageBonus && isPokemonEx(defenderDef)) {
    bonus += state.turnFlags.activeExDamageBonus;
  }
  return bonus;
}
