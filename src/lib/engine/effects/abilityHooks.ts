import { isBasicEnergy, isBasicPokemon, isNsPokemon } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import type { PlayerId } from "../../models/enums";
import { PlayerId as PlayerIdEnum } from "../../models/enums";
import { drawCards, getDefinitionSafe } from "../rules";
import { flipCoin, logMessage } from "../helpers";
import { allPokemonInPlay, getOpponentId, getPlayer, type EngineState } from "../types";
import { attachEnergyToPokemon } from "../trainerEffects";
import { getExecutableAbilityEffects } from "./abilityMeta";
import { canUseAbilityNow, markAbilityUsed } from "./abilities";
import { executeEffects } from "./execute";
import { parseAbilityText } from "./parseText";
import { allOwnedPokemon } from "./modifiers";
import { areStadiumAbilitiesDisabled, clearAllFestivalGroundsEligibleSpecialConditions, clearFestivalGroundsSpecialConditions, getStadiumKind, applySpecialCondition } from "./stadiumEffects";
import { getToolPrizeReduction, onActiveDamagedByOpponentAttackTools } from "./toolEffects";
import { getLegacyEnergyPrizeReduction } from "./specialEnergyEffects";
import { countersToDamage } from "./types";
import type { ParsedEffect } from "./types";

function allPokemonInGame(state: EngineState): CardInstance[] {
  return [PlayerIdEnum.P1, PlayerIdEnum.P2].flatMap((playerId) => allOwnedPokemon(state, playerId));
}

function forEachAbilityEffect(
  state: EngineState,
  playerId: PlayerId,
  visitor: (pokemon: CardInstance, effect: ParsedEffect, abilityName: string) => void,
): void {
  for (const pokemon of allOwnedPokemon(state, playerId)) {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    for (const ability of def.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        visitor(pokemon, effect, ability.name);
      }
    }
  }
}

function forEachAbilityEffectAllPlayers(
  state: EngineState,
  visitor: (pokemon: CardInstance, effect: ParsedEffect, abilityName: string) => void,
): void {
  forEachAbilityEffect(state, PlayerIdEnum.P1, visitor);
  forEachAbilityEffect(state, PlayerIdEnum.P2, visitor);
}

export function runPokemonCheckup(state: EngineState): void {
  clearAllFestivalGroundsEligibleSpecialConditions(state);

  forEachAbilityEffectAllPlayers(state, (pokemon, effect) => {
    if (effect.kind === "checkup_counters_on_opponent_basic") {
      const opponentId = getOpponentId(pokemon.ownerId);
      const opponent = getPlayer(state, opponentId);
      if (pokemon !== opponent.active) return;
      for (const basic of allOwnedPokemon(state, opponentId)) {
        const basicDef = getDefinitionSafe(state, basic.definitionId);
        if (!isBasicPokemon(basicDef)) continue;
        basic.damageCounters += countersToDamage(effect.counters);
      }
      logMessage(state, `Checkup: ${effect.counters} damage counters on each opponent Basic Pokémon.`);
    }
  });

  forEachAbilityEffectAllPlayers(state, (_pokemon, effect) => {
    if (effect.kind !== "checkup_counter_on_ability_pokemon") return;
    const except = effect.exceptName?.toLowerCase();
    for (const target of allPokemonInGame(state)) {
      const targetDef = getDefinitionSafe(state, target.definitionId);
      if (!targetDef.abilities?.length) continue;
      if (except && targetDef.name.toLowerCase().includes(except)) continue;
      target.damageCounters += 10;
    }
    logMessage(state, "Checkup: 1 damage counter on each Pokémon with an Ability.");
  });

  for (const playerId of [PlayerIdEnum.P1, PlayerIdEnum.P2]) {
    const player = getPlayer(state, playerId);
    for (const pokemon of allPokemonInPlay(player)) {
      if (!pokemon.statusConditions.includes("Burned")) continue;
      let counters = 2;
      forEachAbilityEffect(state, getOpponentId(playerId), (_mon, effect) => {
        if (effect.kind === "burn_checkup_extra") counters += effect.extra;
      });
      pokemon.damageCounters += countersToDamage(counters);
      logMessage(
        state,
        `Checkup: ${counters} damage counters on Burned ${getDefinitionSafe(state, pokemon.definitionId).name}.`,
      );
    }
    for (const pokemon of allPokemonInPlay(player)) {
      if (!pokemon.statusConditions.includes("Poisoned")) continue;
      let counters = 1;
      const def = getDefinitionSafe(state, pokemon.definitionId);
      for (const ability of def.abilities ?? []) {
        for (const effect of parseAbilityText(ability).effects) {
          if (effect.kind === "poison_enhanced_checkup") counters = effect.counters;
        }
      }
      pokemon.damageCounters += countersToDamage(counters);
      logMessage(state, `Checkup: ${counters} damage counter(s) on Poisoned ${def.name}.`);
    }
  }
}

export function onDefenderDamagedByAttack(
  state: EngineState,
  defender: CardInstance,
  attacker: CardInstance,
  damageDealt: number,
): void {
  if (damageDealt <= 0) return;

  const defenderDef = getDefinitionSafe(state, defender.definitionId);
  for (const ability of defenderDef.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "retaliate_damage_counters") {
        attacker.damageCounters += countersToDamage(effect.counters);
        logMessage(
          state,
          `${defenderDef.name} retaliated with ${effect.counters} damage counter(s) on ${getDefinitionSafe(state, attacker.definitionId).name}.`,
        );
      }
      if (effect.kind === "poison_attacker_when_damaged_from_opponent") {
        if (applySpecialCondition(state, attacker, "Poisoned")) {
          logMessage(state, `${getDefinitionSafe(state, attacker.definitionId).name} is now Poisoned.`);
        }
      }
      if (effect.kind === "burn_attacker_when_damaged_from_opponent") {
        if (applySpecialCondition(state, attacker, "Burned")) {
          logMessage(state, `${getDefinitionSafe(state, attacker.definitionId).name} is now Burned.`);
        }
      }
    }
  }

  onActiveDamagedByOpponentAttackTools(state, defender, attacker, damageDealt);
}

export function onBenchPlay(state: EngineState, playerId: PlayerId, pokemon: CardInstance): void {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  for (const ability of def.abilities ?? []) {
    const parsed = parseAbilityText(ability);
    const hasSwitchTrigger = parsed.effects.some(
      (effect) => effect.kind === "on_bench_play_switch_and_move_energy",
    );
    const hasBenchTrigger = parsed.effects.some((effect) => effect.kind === "on_bench_play_trigger");
    if (!hasSwitchTrigger && !hasBenchTrigger) continue;

    const player = getPlayer(state, playerId);
    if (!player.bench.includes(pokemon)) continue;
    if (!canUseAbilityNow(state, pokemon, parsed)) continue;

    markAbilityUsed(state, pokemon, ability.name, parsed);
    logMessage(state, `${def.name}'s ${ability.name} triggered.`);

    const ctx = {
      playerId,
      sourcePokemon: pokemon,
      opponentId: getOpponentId(playerId),
    };

    if (hasSwitchTrigger) {
      executeEffects(state, ctx, [
        { kind: "optional_switch_with_bench" },
        { kind: "move_energy_to_bench" },
      ]);
      continue;
    }

    executeEffects(state, ctx, getExecutableAbilityEffects(parsed.effects));
  }
}

export function onEvolvedFromHand(
  state: EngineState,
  playerId: PlayerId,
  evolved: CardInstance,
): void {
  const def = getDefinitionSafe(state, evolved.definitionId);
  for (const ability of def.abilities ?? []) {
    const parsed = parseAbilityText(ability);
    if (!parsed.effects.some((effect) => effect.kind === "evolve_trigger_ability")) continue;
    const executable = parsed.effects.filter(
      (effect) =>
        effect.kind !== "evolve_trigger_ability" &&
        effect.kind !== "ability_only_while_active",
    );
    if (executable.length === 0) continue;
    const ctx = {
      playerId,
      sourcePokemon: evolved,
      opponentId: getOpponentId(playerId),
    };
    logMessage(state, `${def.name}'s ${ability.name} triggered on evolution.`);
    executeEffects(state, ctx, executable);
  }
}

export function onRetreat(
  state: EngineState,
  playerId: PlayerId,
  outgoing: CardInstance,
): void {
  const opponentId = getOpponentId(playerId);
  forEachAbilityEffect(state, opponentId, (_pokemon, effect) => {
    if (effect.kind === "burn_on_opponent_switch") {
      if (applySpecialCondition(state, outgoing, "Burned")) {
        logMessage(state, `${getDefinitionSafe(state, outgoing.definitionId).name} is now Burned.`);
      }
    }
    if (effect.kind === "counter_on_opponent_switch") {
      outgoing.damageCounters += countersToDamage(effect.counters ?? 1);
    }
  });
}

export function onOpponentEvolve(
  state: EngineState,
  evolvingPlayerId: PlayerId,
  evolved: CardInstance,
): void {
  const opponentId = getOpponentId(evolvingPlayerId);
  forEachAbilityEffect(state, opponentId, (_pokemon, effect) => {
    if (effect.kind === "counter_on_opponent_evolve") {
      evolved.damageCounters += countersToDamage(effect.counters ?? 1);
      logMessage(
        state,
        `Placed damage counter(s) on evolved ${getDefinitionSafe(state, evolved.definitionId).name}.`,
      );
    }
  });
}

export function onEnergyAttached(
  state: EngineState,
  playerId: PlayerId,
  pokemon: CardInstance,
): void {
  const opponentId = getOpponentId(playerId);
  forEachAbilityEffect(state, opponentId, (_mon, effect) => {
    if (effect.kind === "counter_on_opponent_energy_attach") {
      pokemon.damageCounters += countersToDamage(effect.counters ?? 1);
    }
  });

  const def = getDefinitionSafe(state, pokemon.definitionId);
  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "poison_on_attach_energy" && applySpecialCondition(state, pokemon, "Poisoned")) {
        logMessage(state, `${def.name} is now Poisoned.`);
      }
    }
  }

  clearFestivalGroundsSpecialConditions(state, pokemon);
}

export function onKnockOut(
  state: EngineState,
  knockedOut: CardInstance,
  attackerId: PlayerId,
): void {
  const player = getPlayer(state, knockedOut.ownerId);
  for (const ability of getDefinitionSafe(state, knockedOut.definitionId).abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind !== "return_energy_on_ko_water") continue;
      const target = player.active ?? player.bench[0];
      if (!target) continue;
      for (const energy of [...knockedOut.attachedEnergy]) {
        const energyDef = getDefinitionSafe(state, energy.definitionId);
        const isWater =
          energyDef.name.toLowerCase().includes("water") || energyDef.types?.includes("Water");
        if (!isWater || !isBasicEnergy(energyDef)) continue;
        const index = knockedOut.attachedEnergy.findIndex((e) => e.instanceId === energy.instanceId);
        if (index === -1) continue;
        knockedOut.attachedEnergy.splice(index, 1);
        attachEnergyToPokemon(state, knockedOut.ownerId, energy, target);
      }
    }
  }

  forEachAbilityEffect(state, attackerId, (_mon, effect) => {
    if (effect.kind === "coin_flip_on_opponent_ko" && flipCoin(state)) {
      drawCards(state, attackerId, 1);
      logMessage(state, "Coin flip heads — drew 1 card.");
    }
  });
}

export function getModifiedPrizeCount(
  state: EngineState,
  knockedOut: CardInstance,
  attackerId: PlayerId,
  basePrize: number,
): number {
  let prize = basePrize;
  const koDef = getDefinitionSafe(state, knockedOut.definitionId);
  const attacker = getPlayer(state, attackerId);
  const attackerActive = attacker.active;
  const attackerDef = attackerActive ? getDefinitionSafe(state, attackerActive.definitionId) : null;

  forEachAbilityEffect(state, knockedOut.ownerId, (_mon, effect) => {
    if (effect.kind !== "reduce_prize_when_named_ko_by_ex") return;
    const filter = effect.nameFilter.toLowerCase();
    if (
      koDef.name.toLowerCase().includes(filter) &&
      attackerDef?.subtypes?.some((s) => s.toLowerCase().includes("ex"))
    ) {
      prize = Math.max(1, prize - 1);
    }
  });

  forEachAbilityEffect(state, attackerId, (_mon, effect) => {
    if (effect.kind === "bonus_prize_on_ko_basic" && isBasicPokemon(koDef)) {
      prize += 1;
    }
  });

  prize = Math.max(0, prize - getToolPrizeReduction(state, knockedOut));
  prize = Math.max(0, prize - getLegacyEnergyPrizeReduction(state, knockedOut));

  return Math.max(0, Math.min(6, prize));
}

export function getExtraRetreatCost(state: EngineState, pokemon: CardInstance): number {
  let extra = 0;
  forEachAbilityEffect(state, getOpponentId(pokemon.ownerId), (_mon, effect) => {
    if (effect.kind === "opponent_retreat_cost_increase") {
      extra += effect.amount ?? 1;
    }
  });
  return extra;
}

export function hasFreeRetreat(state: EngineState, pokemon: CardInstance): boolean {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "no_retreat_cost_if_no_energy" && pokemon.attachedEnergy.length === 0) {
        return true;
      }
      if (effect.kind === "basic_pokemon_no_retreat" && isBasicPokemon(def)) {
        return true;
      }
    }
  }
  if (getStadiumKind(state) === "ns_castle" && isNsPokemon(def)) {
    return true;
  }
  return false;
}

export function isAbilityDisabledOnPokemon(state: EngineState, pokemon: CardInstance): boolean {
  if (areStadiumAbilitiesDisabled(state, pokemon)) return true;

  const player = getPlayer(state, pokemon.ownerId);
  if (pokemon !== player.active) return false;

  const opponentId = getOpponentId(pokemon.ownerId);
  for (const mon of allOwnedPokemon(state, opponentId)) {
    const def = getDefinitionSafe(state, mon.definitionId);
    for (const ability of def.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        if (effect.kind === "disable_opponent_active_abilities") return true;
      }
    }
  }
  return false;
}

export function applyKnockOutSelfAfterAbility(state: EngineState, pokemon: CardInstance): void {
  pokemon.damageCounters = 9999;
  logMessage(
    state,
    `${getDefinitionSafe(state, pokemon.definitionId).name} Knocked Out itself after using its Ability.`,
  );
}
