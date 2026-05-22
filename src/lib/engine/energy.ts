import type { CardAttack, CardDefinition } from "../models/definition";
import type { CardInstance } from "../models/instance";
import type { EngineState, PlayerState } from "./types";
import { getDefinition, moveToDiscard } from "./types";
import { getEffectiveAttackCost } from "./effects/passiveRules";
import { getExtraRetreatCost, hasFreeRetreat } from "./effects/abilityHooks";

export interface EnergyPool {
  [type: string]: number;
}

export function getAttachedEnergyPool(
  state: EngineState,
  pokemon: CardInstance,
): EnergyPool {
  const pool: EnergyPool = {};
  for (const energy of pokemon.attachedEnergy) {
    const def = getDefinition(state, energy.definitionId);
    if (!def) continue;
    const type =
      def.types?.[0] ??
      (def.name.includes("Energy") ? def.name.replace(/ Energy.*/, "") : "Colorless");
    pool[type] = (pool[type] ?? 0) + 1;
  }
  return pool;
}

function canPayCost(pool: EnergyPool, cost: string[]): boolean {
  const working = { ...pool };
  const colorlessNeeded: string[] = [];

  for (const requirement of cost) {
    if (requirement === "Colorless") {
      colorlessNeeded.push(requirement);
      continue;
    }
    if ((working[requirement] ?? 0) > 0) {
      working[requirement] -= 1;
    } else {
      colorlessNeeded.push("Colorless");
    }
  }

  let availableColorless = 0;
  for (const count of Object.values(working)) {
    availableColorless += count;
  }
  return availableColorless >= colorlessNeeded.length;
}

export function canAffordAttack(
  state: EngineState,
  pokemon: CardInstance,
  attack: CardAttack,
): boolean {
  const pool = getAttachedEnergyPool(state, pokemon);
  return canPayCost(pool, getEffectiveAttackCost(state, pokemon, attack));
}

function getEnergyType(state: EngineState, energy: CardInstance): string {
  const def = getDefinition(state, energy.definitionId);
  return (
    def?.types?.[0] ??
    (def?.name.includes("Energy") ? def.name.replace(/ Energy.*/, "") : "Colorless")
  );
}

export function canAffordRetreat(state: EngineState, pokemon: CardInstance): boolean {
  if (hasFreeRetreat(state, pokemon)) return true;
  const def = getDefinition(state, pokemon.definitionId);
  if (!def) return false;
  const cost = [...(def.retreatCost ?? [])];
  const extra = getExtraRetreatCost(state, pokemon);
  for (let i = 0; i < extra; i += 1) cost.push("Colorless");
  if (cost.length === 0) return true;
  return canPayCost(getAttachedEnergyPool(state, pokemon), cost);
}

export function payRetreatCost(
  state: EngineState,
  player: PlayerState,
  pokemon: CardInstance,
): boolean {
  if (hasFreeRetreat(state, pokemon)) return true;
  const def = getDefinition(state, pokemon.definitionId);
  if (!def) return false;
  const cost = [...(def.retreatCost ?? [])];
  const extra = getExtraRetreatCost(state, pokemon);
  for (let i = 0; i < extra; i += 1) cost.push("Colorless");
  if (cost.length === 0) return true;
  if (!canAffordRetreat(state, pokemon)) return false;

  const working = pokemon.attachedEnergy.map((energy) => ({
    energy,
    type: getEnergyType(state, energy),
  }));
  const discarded: CardInstance[] = [];

  for (const requirement of cost) {
    if (requirement === "Colorless") {
      if (working.length === 0) return false;
      discarded.push(working.shift()!.energy);
      continue;
    }

    const exactIndex = working.findIndex((entry) => entry.type === requirement);
    if (exactIndex >= 0) {
      discarded.push(working.splice(exactIndex, 1)[0]!.energy);
      continue;
    }

    if (working.length === 0) return false;
    discarded.push(working.shift()!.energy);
  }

  pokemon.attachedEnergy = working.map((entry) => entry.energy);
  for (const energy of discarded) {
    moveToDiscard(player, energy);
  }
  return true;
}

export function formatAttackCost(cost: string[]): string {
  return cost.length > 0 ? cost.join(", ") : "Free";
}

export function isPokemonDef(def: CardDefinition | undefined): boolean {
  return def?.supertype === "Pokémon";
}

export function isEnergyDef(def: CardDefinition | undefined): boolean {
  return def?.supertype === "Energy";
}

export function isTrainerDef(def: CardDefinition | undefined): boolean {
  return def?.supertype === "Trainer";
}
