import type { CardAttack, CardDefinition } from "../models/definition";
import { isBasicEnergy, isBasicPokemon } from "../models/definition";
import type { CardInstance } from "../models/instance";
import type { EngineState, PlayerState } from "./types";
import { getDefinition, moveToDiscard } from "./types";
import type { PlayerId } from "../models/enums";
import { getEffectiveAttackCost } from "./effects/passiveRules";
import { getExtraRetreatCost, hasFreeRetreat } from "./effects/abilityHooks";
import { getToolRetreatReduction } from "./effects/toolEffects";
import {
  getSpecialEnergyContribution,
  isEnrichingEnergy,
  isIgnitionEnergy,
  isLegacyEnergy,
  isRockyFightingEnergy,
  isTeamRocketsEnergy,
  isTelepathicPsychicEnergy,
} from "./effects/specialEnergyEffects";
import { allOwnedPokemon } from "./effects/modifiers";
import { parseAbilityText } from "./effects/parseText";

export interface EnergyPool {
  colors: Record<string, number>;
  rainbow: number;
  flexPsychicDark: number;
}

export function isPrismEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("prism energy") ?? false;
}

export function isMistEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("mist energy") ?? false;
}

export function hasMistEnergyAttached(state: EngineState, pokemon: CardInstance): boolean {
  return pokemon.attachedEnergy.some((energy) => {
    const def = getDefinition(state, energy.definitionId);
    return def && isMistEnergy(def);
  });
}

export function isProtectedFromAttackEffectsByMistEnergy(
  state: EngineState,
  defender: CardInstance | null | undefined,
  damageApplied: number,
): boolean {
  if (!defender || damageApplied <= 0) return false;
  return hasMistEnergyAttached(state, defender);
}

function playerHasGrassEnergyProvidesDouble(state: EngineState, playerId: PlayerId): boolean {
  for (const pokemon of allOwnedPokemon(state, playerId)) {
    const def = getDefinition(state, pokemon.definitionId);
    if (!def) continue;
    for (const ability of def.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        if (effect.kind === "grass_energy_provides_double") return true;
      }
    }
  }
  return false;
}

function getEnergyContribution(
  state: EngineState,
  pokemon: CardInstance,
  energy: CardInstance,
): { colors: Record<string, number>; rainbow: number; flexPsychicDark: number } {
  const def = getDefinition(state, energy.definitionId);
  if (!def) return { colors: {}, rainbow: 0, flexPsychicDark: 0 };

  if (
    isEnrichingEnergy(def) ||
    isIgnitionEnergy(def) ||
    isTelepathicPsychicEnergy(def) ||
    isRockyFightingEnergy(def) ||
    isTeamRocketsEnergy(def) ||
    isLegacyEnergy(def)
  ) {
    return getSpecialEnergyContribution(state, pokemon, energy);
  }

  if (isPrismEnergy(def)) {
    const pokemonDef = getDefinition(state, pokemon.definitionId);
    if (pokemonDef && isBasicPokemon(pokemonDef)) {
      return { colors: {}, rainbow: 1, flexPsychicDark: 0 };
    }
    return { colors: { Colorless: 1 }, rainbow: 0, flexPsychicDark: 0 };
  }

  const type =
    def.types?.[0] ??
    (def.name.includes("Energy") ? def.name.replace(/ Energy.*/, "") : "Colorless");
  let amount = 1;
  if (
    type === "Grass" &&
    isBasicEnergy(def) &&
    playerHasGrassEnergyProvidesDouble(state, pokemon.ownerId)
  ) {
    amount = 2;
  }
  return { colors: { [type]: amount }, rainbow: 0, flexPsychicDark: 0 };
}

export function getAttachedEnergyPool(
  state: EngineState,
  pokemon: CardInstance,
): EnergyPool {
  const pool: EnergyPool = { colors: {}, rainbow: 0, flexPsychicDark: 0 };
  for (const energy of pokemon.attachedEnergy) {
    const contribution = getEnergyContribution(state, pokemon, energy);
    pool.rainbow += contribution.rainbow;
    pool.flexPsychicDark += contribution.flexPsychicDark;
    for (const [type, count] of Object.entries(contribution.colors)) {
      pool.colors[type] = (pool.colors[type] ?? 0) + count;
    }
  }
  return pool;
}

function canPayCost(pool: EnergyPool, cost: string[]): boolean {
  const working = { ...pool.colors };
  let rainbow = pool.rainbow;
  let flexPsychicDark = pool.flexPsychicDark;
  let colorlessNeeded = 0;

  for (const requirement of cost) {
    if (requirement === "Colorless") {
      colorlessNeeded += 1;
      continue;
    }
    if ((working[requirement] ?? 0) > 0) {
      working[requirement] -= 1;
    } else if (
      (requirement === "Psychic" || requirement === "Darkness") &&
      flexPsychicDark > 0
    ) {
      flexPsychicDark -= 1;
    } else if (rainbow > 0) {
      rainbow -= 1;
    } else {
      // Typed requirement that can't be matched by exact type, by a
      // Psychic/Darkness flex slot, or by Rainbow energy. Mismatched
      // typed energy (e.g. Water for a Fire cost) MUST NOT count.
      return false;
    }
  }

  let availableColorless = rainbow + flexPsychicDark;
  for (const count of Object.values(working)) {
    availableColorless += count;
  }
  return availableColorless >= colorlessNeeded;
}

export function canAffordAttack(
  state: EngineState,
  pokemon: CardInstance,
  attack: CardAttack,
): boolean {
  const pool = getAttachedEnergyPool(state, pokemon);
  return canPayCost(pool, getEffectiveAttackCost(state, pokemon, attack));
}

export function canAffordRetreat(state: EngineState, pokemon: CardInstance): boolean {
  if (hasFreeRetreat(state, pokemon)) return true;
  const def = getDefinition(state, pokemon.definitionId);
  if (!def) return false;
  const cost = [...(def.retreatCost ?? [])];
  const extra = getExtraRetreatCost(state, pokemon);
  for (let i = 0; i < extra; i += 1) cost.push("Colorless");
  const reduction = getToolRetreatReduction(state, pokemon);
  for (let i = 0; i < reduction && cost.length > 0; i += 1) {
    const colorlessIndex = cost.lastIndexOf("Colorless");
    if (colorlessIndex >= 0) cost.splice(colorlessIndex, 1);
    else cost.pop();
  }
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
  let cost = [...(def.retreatCost ?? [])];
  const extra = getExtraRetreatCost(state, pokemon);
  for (let i = 0; i < extra; i += 1) cost.push("Colorless");
  const reduction = getToolRetreatReduction(state, pokemon);
  for (let i = 0; i < reduction && cost.length > 0; i += 1) {
    const colorlessIndex = cost.lastIndexOf("Colorless");
    if (colorlessIndex >= 0) cost.splice(colorlessIndex, 1);
    else cost.pop();
  }
  if (cost.length === 0) return true;
  if (!canAffordRetreat(state, pokemon)) return false;

  const working = pokemon.attachedEnergy.map((energy) => ({
    energy,
    ...getEnergyContribution(state, pokemon, energy),
  }));
  const discarded: CardInstance[] = [];

  for (const requirement of cost) {
    if (requirement === "Colorless") {
      const rainbowIndex = working.findIndex((entry) => entry.rainbow > 0);
      if (rainbowIndex >= 0) {
        working[rainbowIndex]!.rainbow -= 1;
        if (working[rainbowIndex]!.rainbow === 0 && Object.keys(working[rainbowIndex]!.colors).length === 0 && working[rainbowIndex]!.flexPsychicDark === 0) {
          discarded.push(working.splice(rainbowIndex, 1)[0]!.energy);
        }
        continue;
      }
      const colorlessIndex = working.findIndex(
        (entry) => (entry.colors.Colorless ?? 0) > 0 || Object.keys(entry.colors).some((type) => type !== "Colorless" && (entry.colors[type] ?? 0) > 0),
      );
      if (colorlessIndex >= 0) {
        const entry = working[colorlessIndex]!;
        const typed = Object.keys(entry.colors).find((type) => (entry.colors[type] ?? 0) > 0);
        if (typed) entry.colors[typed]! -= 1;
        if (Object.values(entry.colors).every((count) => count === 0) && entry.rainbow === 0 && entry.flexPsychicDark === 0) {
          discarded.push(working.splice(colorlessIndex, 1)[0]!.energy);
        }
        continue;
      }
      return false;
    }

    const exactIndex = working.findIndex((entry) => (entry.colors[requirement] ?? 0) > 0);
    if (exactIndex >= 0) {
      working[exactIndex]!.colors[requirement]! -= 1;
      const entry = working[exactIndex]!;
      if (Object.values(entry.colors).every((count) => count === 0) && entry.rainbow === 0 && entry.flexPsychicDark === 0) {
        discarded.push(working.splice(exactIndex, 1)[0]!.energy);
      }
      continue;
    }

    if (requirement === "Psychic" || requirement === "Darkness") {
      const flexIndex = working.findIndex((entry) => entry.flexPsychicDark > 0);
      if (flexIndex >= 0) {
        working[flexIndex]!.flexPsychicDark -= 1;
        if (working[flexIndex]!.flexPsychicDark === 0 && Object.keys(working[flexIndex]!.colors).length === 0 && working[flexIndex]!.rainbow === 0) {
          discarded.push(working.splice(flexIndex, 1)[0]!.energy);
        }
        continue;
      }
    }

    const rainbowIndex = working.findIndex((entry) => entry.rainbow > 0);
    if (rainbowIndex >= 0) {
      working[rainbowIndex]!.rainbow -= 1;
      if (working[rainbowIndex]!.rainbow === 0 && Object.keys(working[rainbowIndex]!.colors).length === 0 && working[rainbowIndex]!.flexPsychicDark === 0) {
        discarded.push(working.splice(rainbowIndex, 1)[0]!.energy);
      }
      continue;
    }

    const anyIndex = working.findIndex((entry) =>
      Object.values(entry.colors).some((count) => count > 0),
    );
    if (anyIndex >= 0) {
      const entry = working[anyIndex]!;
      const typed = Object.keys(entry.colors).find((type) => (entry.colors[type] ?? 0) > 0);
      if (typed) entry.colors[typed]! -= 1;
      if (Object.values(entry.colors).every((count) => count === 0) && entry.rainbow === 0 && entry.flexPsychicDark === 0) {
        discarded.push(working.splice(anyIndex, 1)[0]!.energy);
      }
      continue;
    }

    return false;
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
