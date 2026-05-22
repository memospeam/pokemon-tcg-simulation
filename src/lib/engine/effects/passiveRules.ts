import type { CardAttack } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import type { PlayerId } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { allPokemonInPlay, getOpponentId, getPlayer, type EngineState } from "../types";
import { parseAbilityText } from "./parseText";
import { allOwnedPokemon } from "./modifiers";
import { getStadiumHpModifier } from "./stadiumEffects";
import { getToolHpBonus } from "./toolEffects";

export function countPrizesTakenByPlayer(state: EngineState, playerId: PlayerId): number {
  const player = getPlayer(state, playerId);
  return Math.max(0, 6 - player.prizes.length);
}

export function countMatchingPokemonInPlay(
  state: EngineState,
  playerId: PlayerId,
  nameFilter: string,
): number {
  const filter = nameFilter.toLowerCase();
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).filter((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    return def.name.toLowerCase().includes(filter);
  }).length;
}

export function getEffectiveAttackCost(
  state: EngineState,
  pokemon: CardInstance,
  attack: CardAttack,
): string[] {
  const cost = [...attack.cost];
  const def = getDefinitionSafe(state, pokemon.definitionId);
  if (!def.abilities?.length) return cost;

  const player = getPlayer(state, pokemon.ownerId);
  const opponent = getPlayer(state, getOpponentId(pokemon.ownerId));
  const opponentId = getOpponentId(pokemon.ownerId);
  if (!state.players?.[opponentId]) return cost;
  const prizesTaken = countPrizesTakenByPlayer(state, opponentId);

  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (
        effect.kind === "attack_cost_reduction_per_opponent_prize" &&
        attack.name.toLowerCase() === effect.attackName.toLowerCase()
      ) {
        let toRemove = prizesTaken * effect.perPrize;
        for (let i = cost.length - 1; i >= 0 && toRemove > 0; i -= 1) {
          if (cost[i] === effect.energyType) {
            cost.splice(i, 1);
            toRemove -= 1;
          }
        }
      }
      if (effect.kind === "attack_cost_reduction_per_opponent_bench") {
        const benchCount = opponent.bench.length;
        let toRemove = benchCount;
        for (let i = cost.length - 1; i >= 0 && toRemove > 0; i -= 1) {
          if (cost[i] === effect.energyType) {
            cost.splice(i, 1);
            toRemove -= 1;
          }
        }
      }
      if (
        effect.kind === "ignore_energy_cost_if_hand_equal" &&
        attack.name.toLowerCase() === effect.attackName.toLowerCase() &&
        player.hand.length === opponent.hand.length
      ) {
        return [];
      }
    }
  }
  return cost;
}

export function getDragonWeaknessOverrideType(
  state: EngineState,
  defender: CardInstance,
): string | null {
  const defenderDef = getDefinitionSafe(state, defender.definitionId);
  if (!defenderDef.types?.includes("Dragon")) return null;

  const opponentId = getOpponentId(defender.ownerId);
  for (const pokemon of allOwnedPokemon(state, opponentId)) {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    for (const ability of def.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        if (effect.kind === "override_opponent_dragon_weakness") {
          return effect.weaknessType;
        }
      }
    }
  }
  return null;
}

export function attackerIgnoresOpponentActiveModifiers(
  state: EngineState,
  attacker: CardInstance,
): boolean {
  const def = getDefinitionSafe(state, attacker.definitionId);
  for (const ability of def.abilities ?? []) {
    if (
      parseAbilityText(ability).effects.some(
        (effect) => effect.kind === "ignore_opponent_active_modifiers",
      )
    ) {
      return true;
    }
  }
  return false;
}

export function getFuturePokemonDamageBonus(
  state: EngineState,
  attacker: CardInstance,
  playerId: PlayerId,
): number {
  const def = getDefinitionSafe(state, attacker.definitionId);
  if (!def.subtypes?.includes("Future")) return 0;

  let bonus = 0;
  for (const pokemon of allOwnedPokemon(state, playerId)) {
    const ownerDef = getDefinitionSafe(state, pokemon.definitionId);
    for (const ability of ownerDef.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        if (effect.kind !== "future_pokemon_active_damage_bonus") continue;
        if (
          effect.excludeName &&
          def.name.toLowerCase().includes(effect.excludeName.toLowerCase())
        ) {
          continue;
        }
        bonus = Math.max(bonus, effect.amount);
      }
    }
  }
  return bonus;
}

export function canPokemonAttackWithPassives(
  state: EngineState,
  pokemon: CardInstance,
  baseCanAttack: boolean,
): boolean {
  if (!baseCanAttack) return false;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "cant_attack_unless_name_count_in_play") {
        const count = countMatchingPokemonInPlay(state, pokemon.ownerId, effect.nameFilter);
        if (count < effect.minCount) return false;
      }
    }
  }
  return true;
}

export function getSelfPassiveAttackBonus(
  state: EngineState,
  attacker: CardInstance,
  playerId: PlayerId,
): number {
  const def = getDefinitionSafe(state, attacker.definitionId);
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  const opponentActive = opponent.active;
  let bonus = 0;

  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (
        effect.kind === "self_hand_equal_damage_bonus" &&
        player.hand.length === opponent.hand.length
      ) {
        bonus += effect.amount;
      }
      if (effect.kind === "self_attack_bonus_per_opponent_prize") {
        bonus += countPrizesTakenByPlayer(state, getOpponentId(playerId)) * effect.perPrize;
      }
      if (effect.kind === "self_conditional_attack_bonus" && effect.condition === "darkness_mega") {
        const hasDarknessMega = allOwnedPokemon(state, playerId).some((mon) => {
          const monDef = getDefinitionSafe(state, mon.definitionId);
          return (
            monDef.name.toLowerCase().includes("mega") &&
            monDef.subtypes?.some((s) => s.toLowerCase().includes("ex")) &&
            monDef.types?.includes("Darkness")
          );
        });
        if (hasDarknessMega) bonus += effect.amount;
      }
      if (effect.kind === "damage_bonus_vs_ability_active" && opponentActive) {
        const oppDef = getDefinitionSafe(state, opponentActive.definitionId);
        if (oppDef.abilities?.length) bonus += effect.amount;
      }
    }
  }
  return bonus;
}

export function getTeamPassiveAttackBonus(
  state: EngineState,
  attacker: CardInstance,
  playerId: PlayerId,
): number {
  const attackerDef = getDefinitionSafe(state, attacker.definitionId);
  let bonus = 0;

  for (const pokemon of allOwnedPokemon(state, playerId)) {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    for (const ability of def.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        if (effect.kind !== "team_typed_damage_bonus") continue;
        const filter = effect.nameFilter.toLowerCase();
        if (
          attackerDef.name.toLowerCase().includes(filter) ||
          attackerDef.types?.some((t) => t.toLowerCase() === filter) ||
          attackerDef.subtypes?.some((s) => s.toLowerCase().includes(filter))
        ) {
          bonus += effect.amount;
        }
      }
    }
  }
  return bonus;
}

export function getPassiveHpBonus(state: EngineState, pokemon: CardInstance): number {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  const opponentId = getOpponentId(pokemon.ownerId);
  const prizesTaken = countPrizesTakenByPlayer(state, opponentId);
  let bonus = 0;

  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "hp_bonus_per_opponent_prize") {
        bonus += prizesTaken * effect.perPrize;
      }
      if (effect.kind === "hp_bonus_per_typed_energy") {
        const type = effect.energyType.toLowerCase();
        bonus +=
          pokemon.attachedEnergy.filter((energy) => {
            const energyDef = getDefinitionSafe(state, energy.definitionId);
            return (
              energyDef.name.toLowerCase().includes(type) ||
              energyDef.types?.some((t) => t.toLowerCase() === type)
            );
          }).length * effect.perEnergy;
      }
    }
  }
  return bonus;
}

export function remainingHpWithPassives(state: EngineState, pokemon: CardInstance): number {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  const maxHp =
    (parseInt(def.hp ?? "0", 10) || 0) +
    getPassiveHpBonus(state, pokemon) +
    getStadiumHpModifier(state, pokemon) +
    getToolHpBonus(state, pokemon);
  return Math.max(0, maxHp - pokemon.damageCounters);
}

export function isKnockedOutWithPassives(state: EngineState, pokemon: CardInstance): boolean {
  return remainingHpWithPassives(state, pokemon) <= 0;
}

export function applyWeaknessAndResistanceForPokemon(
  state: EngineState,
  damage: number,
  attackerTypes: string[] | undefined,
  defender: CardInstance,
): number {
  const defenderDef = getDefinitionSafe(state, defender.definitionId);
  let total = damage;
  let weaknessMultiplier: number | null = null;

  const naturalWeakness = defenderDef.weaknesses?.find((entry) => attackerTypes?.includes(entry.type));
  if (naturalWeakness) {
    weaknessMultiplier = naturalWeakness.value.startsWith("×")
      ? parseInt(naturalWeakness.value.slice(1), 10)
      : 2;
  }

  if (defenderDef.types?.includes("Dragon")) {
    const overrideType = getDragonWeaknessOverrideType(state, defender);
    if (overrideType && attackerTypes?.includes(overrideType)) {
      weaknessMultiplier = 2;
    }
  }

  if (weaknessMultiplier) {
    total *= weaknessMultiplier || 2;
  }

  const resistance = defenderDef.resistances?.find((entry) => attackerTypes?.includes(entry.type));
  if (resistance) {
    const reduction = parseInt(resistance.value.replace(/[^\d]/g, ""), 10) || 30;
    total = Math.max(0, total - reduction);
  }
  return total;
}
