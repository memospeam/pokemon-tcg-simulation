import type { CardAttack } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId } from "../../models/enums";
import {
  canEvolveInto,
  getDefinitionSafe,
  parseDamage,
} from "../rules";
import { flipCoin, logMessage } from "../helpers";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  moveToDiscard,
  type EngineState,
} from "../types";
import { executeEffects } from "./execute";
import { parseAttackText } from "./parseText";
import {
  computePreDamageBonus,
  isSecondPlayerFirstTurnBlocked,
  shouldPreventDamageFromAttacker,
  shouldPreventDamageFromAbilityPokemon,
} from "./damageBonus";
import { onDefenderDamagedByAttack } from "./abilityHooks";
import { trySurviveKnockout } from "./koSurvival";
import { applyDamageReduction, isProtectedFromAttackEffects } from "./modifiers";
import {
  applyWeaknessAndResistanceForPokemon,
  attackerIgnoresOpponentActiveModifiers,
  getFuturePokemonDamageBonus,
  getSelfPassiveAttackBonus,
  getTeamPassiveAttackBonus,
  isKnockedOutWithPassives,
  remainingHpWithPassives,
} from "./passiveRules";
import type { ParsedEffect } from "./types";
import { PRE_DAMAGE_ATTACK_EFFECT_KINDS } from "./types";

export function isFestivalGroundsInPlay(state: EngineState): boolean {
  if (!state.stadium) return false;
  const def = getDefinition(state, state.stadium.definitionId);
  return def?.name.toLowerCase().includes("festival grounds") ?? false;
}

function filterPostDamageEffects(textEffects: ParsedEffect[]): ParsedEffect[] {
  return textEffects.filter(
    (effect) =>
      !PRE_DAMAGE_ATTACK_EFFECT_KINDS.has(effect.kind) &&
      effect.kind !== "discard_basic_energy_optional" &&
      effect.kind !== "damage_per_discarded_basic_energy" &&
      effect.kind !== "discard_bench_energy_optional" &&
      effect.kind !== "copy_benched_attack",
  );
}

export function listCopyableBenchAttacks(
  state: EngineState,
  playerId: PlayerId,
  nameFilter: string,
): { benchPokemonId: string; attackName: string }[] {
  const player = getPlayer(state, playerId);
  const filter = nameFilter.toLowerCase();
  const options: { benchPokemonId: string; attackName: string }[] = [];
  for (const bench of player.bench) {
    const def = getDefinitionSafe(state, bench.definitionId);
    if (!def.name.toLowerCase().includes(filter)) continue;
    for (const attack of def.attacks ?? []) {
      options.push({ benchPokemonId: bench.instanceId, attackName: attack.name });
    }
  }
  return options;
}

export function startAttackIfCopyPending(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
): boolean {
  const player = getPlayer(state, playerId);
  if (!player.active) return false;
  const attack = getDefinitionSafe(state, player.active.definitionId).attacks?.find(
    (entry) => entry.name === attackName,
  );
  if (!attack) return false;

  const copyEffect = parseAttackText(attack.text).find(
    (effect): effect is Extract<ParsedEffect, { kind: "copy_benched_attack" }> =>
      effect.kind === "copy_benched_attack",
  );
  if (!copyEffect) return false;

  const options = listCopyableBenchAttacks(state, playerId, copyEffect.nameFilter);
  if (options.length === 0) {
    logMessage(state, "No eligible Benched attacks to copy.");
    return false;
  }

  state.pendingAction = {
    type: "COPY_BENCH_ATTACK",
    playerId,
    wrapperAttackName: attackName,
    options,
  };
  logMessage(state, `Choose a ${copyEffect.nameFilter} Benched Pokémon's attack to copy.`);
  return true;
}

export function applyCopiedBenchAttack(
  state: EngineState,
  playerId: PlayerId,
  benchPokemonId: string,
  copiedAttackName: string,
  wrapperAttackName: string,
): ReturnType<typeof applyAttackDamagePhase> {
  const player = getPlayer(state, playerId);
  const benchMon = player.bench.find((entry) => entry.instanceId === benchPokemonId);
  if (!benchMon || !player.active) return "complete";

  const benchDef = getDefinitionSafe(state, benchMon.definitionId);
  const attack = benchDef.attacks?.find((entry) => entry.name === copiedAttackName);
  if (!attack) return "complete";

  const activeDef = getDefinitionSafe(state, player.active.definitionId);
  logMessage(
    state,
    `${activeDef.name} copied ${copiedAttackName} from ${benchDef.name}.`,
  );
  state.pendingAction = null;
  return applyAttackDamagePhaseWithDefinition(
    state,
    playerId,
    attack,
    wrapperAttackName,
    0,
  );
}

export function applyAttackDamagePhase(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
  extraBonusDamage = 0,
): "complete" | "knockout" | "pending" {
  const player = getPlayer(state, playerId);
  if (!player.active) return "complete";
  const attack = getDefinitionSafe(state, player.active.definitionId).attacks?.find(
    (entry) => entry.name === attackName,
  );
  if (!attack) return "complete";
  return applyAttackDamagePhaseWithDefinition(
    state,
    playerId,
    attack,
    attackName,
    extraBonusDamage,
  );
}

function applyAttackDamagePhaseWithDefinition(
  state: EngineState,
  playerId: PlayerId,
  attack: CardAttack,
  festivalAttackName: string,
  extraBonusDamage = 0,
): "complete" | "knockout" | "pending" {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  if (!player.active || !opponent.active) return "complete";

  const attackerDef = getDefinitionSafe(state, player.active.definitionId);
  const defenderDef = getDefinitionSafe(state, opponent.active.definitionId);
  const textEffects = parseAttackText(attack.text);
  const preDamageEffects = textEffects.filter((effect) =>
    PRE_DAMAGE_ATTACK_EFFECT_KINDS.has(effect.kind),
  );
  const postDamageEffects = filterPostDamageEffects(textEffects);
  const ignoreModifiers = attackerIgnoresOpponentActiveModifiers(state, player.active);

  if (!ignoreModifiers && isProtectedFromAttackEffects(state, opponent.active)) {
    logMessage(state, `${defenderDef.name} is protected from attack damage and effects.`);
    return applyPostAttackEffects(state, playerId, festivalAttackName, postDamageEffects, 0);
  }

  const defenderHpBefore = remainingHpWithPassives(state, opponent.active);
  let bonusDamage = extraBonusDamage + getFuturePokemonDamageBonus(state, player.active, playerId);
  bonusDamage += getSelfPassiveAttackBonus(state, player.active, playerId);
  bonusDamage += getTeamPassiveAttackBonus(state, player.active, playerId);
  for (const effect of preDamageEffects) {
    if (effect.kind === "coin_attack_fails_on_tails" && !flipCoin(state)) {
      logMessage(state, `${attack.name} failed — tails on the coin flip.`);
      state.turnFlags.attacked = true;
      return "complete";
    }
    if (effect.kind === "coin_damage_bonus" && flipCoin(state)) {
      bonusDamage += effect.amount;
    }
    if (effect.kind === "coin_multi_damage") {
      const results: boolean[] = [];
      for (let i = 0; i < effect.coinCount; i += 1) {
        results.push(flipCoin(state));
      }
      state.turnFlags.lastCoinFlipResults = results;
      const heads = results.filter(Boolean).length;
      bonusDamage += heads * effect.perHeads;
    }
    if (effect.kind === "discard_opponent_tools") {
      logMessage(state, "Discarded Pokémon Tools from opponent's Active (no Tool cards in sim).");
    }
    bonusDamage += computePreDamageBonus(state, effect, playerId, player.active, getOpponentId(playerId));
  }

  const baseDamage = parseDamage(attack.damage) + bonusDamage;
  let damageApplied = 0;
  if (baseDamage > 0) {
    let damage = applyWeaknessAndResistanceForPokemon(
      state,
      baseDamage,
      attackerDef.types,
      opponent.active,
    );
    if (shouldPreventDamageFromAttacker(opponent.active, attackerDef)) {
      damage = 0;
      logMessage(state, `${defenderDef.name} prevented damage from ${attackerDef.name}.`);
    } else if (shouldPreventDamageFromAbilityPokemon(state, opponent.active, attackerDef)) {
      damage = 0;
      logMessage(state, `${defenderDef.name} prevented damage from ${attackerDef.name}'s Ability Pokémon.`);
    } else if (!ignoreModifiers) {
      damage = applyDamageReduction(state, damage, opponent.active, player.active);
    }
    opponent.active.damageCounters += damage;
    damageApplied = damage;
    logMessage(state, `${attackerDef.name} used ${attack.name} for ${damage} damage to Active.`);
    if (damage > 0) {
      onDefenderDamagedByAttack(state, opponent.active, player.active, damage);
    }
  } else {
    logMessage(state, `${attackerDef.name} used ${attack.name}.`);
  }

  if (opponent.active && isKnockedOutWithPassives(state, opponent.active)) {
    if (!trySurviveKnockout(state, opponent.active, defenderHpBefore)) {
      return "knockout";
    }
  }

  return applyPostAttackEffects(
    state,
    playerId,
    festivalAttackName,
    postDamageEffects,
    damageApplied,
  );
}

function applyPostAttackEffects(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
  postDamageEffects: ParsedEffect[],
  damageApplied: number,
): "complete" | "pending" {
  const player = getPlayer(state, playerId);
  if (!player.active) return "complete";

  const ctx = {
    playerId,
    sourcePokemon: player.active,
    opponentId: getOpponentId(playerId),
    lastDamageToOpponentActive: damageApplied,
    attackName,
  };
  const result = executeEffects(state, ctx, postDamageEffects);
  if (result === "pending") return "pending";

  applyFestivalGroundsBonusIfEligible(state, playerId, attackName);

  return "complete";
}

export function startAttackIfDiscardPending(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
): boolean {
  const player = getPlayer(state, playerId);
  if (!player.active) return false;
  const attack = getDefinitionSafe(state, player.active.definitionId).attacks?.find(
    (entry) => entry.name === attackName,
  );
  if (!attack) return false;

  const textEffects = parseAttackText(attack.text);
  const discardBasic = textEffects.find((effect) => effect.kind === "discard_basic_energy_optional");
  const perDiscarded = textEffects.find(
    (effect): effect is Extract<ParsedEffect, { kind: "damage_per_discarded_basic_energy" }> =>
      effect.kind === "damage_per_discarded_basic_energy",
  );
  if (discardBasic && perDiscarded) {
    state.pendingAction = {
      type: "DISCARD_BASIC_ENERGY_FOR_DAMAGE",
      playerId,
      attackName,
      perCard: perDiscarded.perCard,
      discardedCount: 0,
      fromBenchOnly: false,
    };
    logMessage(state, "Discard Basic Energy from your Pokémon (optional).");
    return true;
  }

  const discardBench = textEffects.find(
    (effect): effect is Extract<ParsedEffect, { kind: "discard_bench_energy_optional" }> =>
      effect.kind === "discard_bench_energy_optional",
  );
  if (discardBench && perDiscarded) {
    state.pendingAction = {
      type: "DISCARD_BASIC_ENERGY_FOR_DAMAGE",
      playerId,
      attackName,
      perCard: perDiscarded.perCard,
      discardedCount: 0,
      fromBenchOnly: true,
      maxDiscard: discardBench.max,
    };
    logMessage(state, `Discard up to ${discardBench.max} Energy from your Benched Pokémon (optional).`);
    return true;
  }

  return false;
}

export function listDiscardableEnergy(
  state: EngineState,
  playerId: PlayerId,
  fromBenchOnly: boolean,
): { pokemonId: string; energyId: string }[] {
  const player = getPlayer(state, playerId);
  const options: { pokemonId: string; energyId: string }[] = [];
  const pokemon = fromBenchOnly ? player.bench : allPokemonInPlay(player);
  for (const mon of pokemon) {
    for (const energy of mon.attachedEnergy) {
      const def = getDefinition(state, energy.definitionId);
      if (def?.supertype === "Energy" && def.subtypes.includes("Basic")) {
        options.push({ pokemonId: mon.instanceId, energyId: energy.instanceId });
      }
    }
  }
  return options;
}

export function evolvePokemonFromDeck(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
  evolutionInstanceId: string,
): boolean {
  const player = getPlayer(state, playerId);
  const deckIndex = player.deck.findIndex((card) => card.instanceId === evolutionInstanceId);
  if (deckIndex === -1) return false;

  const target =
    player.active?.instanceId === targetId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === targetId);
  if (!target) return false;

  const evolution = player.deck.splice(deckIndex, 1)[0]!;
  const evoDef = getDefinitionSafe(state, evolution.definitionId);
  const targetDef = getDefinitionSafe(state, target.definitionId);
  if (!canEvolveInto(targetDef, evoDef)) {
    player.deck.unshift(evolution);
    return false;
  }

  evolution.attachedEnergy = [...target.attachedEnergy];
  evolution.damageCounters = target.damageCounters;
  evolution.enteredPlayTurn = target.enteredPlayTurn;
  evolution.zone = target.zone;
  evolution.ownerId = playerId;

  if (player.active?.instanceId === targetId) {
    player.active = evolution;
  } else {
    const benchIndex = player.bench.findIndex((entry) => entry.instanceId === targetId);
    if (benchIndex === -1) return false;
    player.bench[benchIndex] = evolution;
  }

  logMessage(state, `${player.name} evolved to ${evoDef.name} from deck.`);
  return true;
}

export function pokemonMatchesNameFilter(
  state: EngineState,
  pokemon: CardInstance,
  nameFilter?: string,
): boolean {
  if (!nameFilter) return true;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return def.name.toLowerCase().includes(nameFilter.toLowerCase());
}

export function resolveDiscardOwnEnergyForAttack(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  energyId: string,
): "failed" | "pending" | "ready" {
  const pending = state.pendingAction;
  if (pending?.type !== "DISCARD_BASIC_ENERGY_FOR_DAMAGE" || pending.playerId !== playerId) {
    return "failed";
  }
  if (
    pending.fromBenchOnly &&
    pending.maxDiscard !== undefined &&
    pending.discardedCount >= pending.maxDiscard
  ) {
    return "failed";
  }

  const player = getPlayer(state, playerId);
  const pokemon =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon) return "failed";
  if (pending.fromBenchOnly && !player.bench.some((entry) => entry.instanceId === pokemonId)) {
    return "failed";
  }

  const energyIndex = pokemon.attachedEnergy.findIndex((entry) => entry.instanceId === energyId);
  if (energyIndex === -1) return "failed";
  const def = getDefinition(state, pokemon.attachedEnergy[energyIndex]!.definitionId);
  if (def?.supertype !== "Energy" || !def.subtypes.includes("Basic")) return "failed";

  const energy = pokemon.attachedEnergy.splice(energyIndex, 1)[0]!;
  moveToDiscard(player, energy);
  pending.discardedCount += 1;
  logMessage(
    state,
    `Discarded ${getDefinitionSafe(state, energy.definitionId).name} (${pending.discardedCount} total).`,
  );
  return "pending";
}

export function finishDiscardEnergyForAttack(
  state: EngineState,
  playerId: PlayerId,
): { attackName: string; bonusDamage: number } | null {
  const pending = state.pendingAction;
  if (pending?.type !== "DISCARD_BASIC_ENERGY_FOR_DAMAGE" || pending.playerId !== playerId) {
    return null;
  }
  const payload = {
    attackName: pending.attackName,
    bonusDamage: pending.discardedCount * pending.perCard,
  };
  state.pendingAction = null;
  return payload;
}

export function applyFestivalGroundsBonusIfEligible(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
): void {
  const player = getPlayer(state, playerId);
  if (!player.active) return;
  const attack = getDefinitionSafe(state, player.active.definitionId).attacks?.find(
    (entry) => entry.name === attackName,
  );
  if (!attack) return;
  const textEffects = parseAttackText(attack.text);
  if (
    textEffects.some((effect) => effect.kind === "festival_grounds_double_attack") &&
    isFestivalGroundsInPlay(state) &&
    !state.turnFlags.bonusAttackUsed
  ) {
    state.turnFlags.bonusAttackUsed = true;
    state.turnFlags.bonusAttackAvailable = true;
    logMessage(state, "Festival Grounds: this Pokémon may attack again.");
  }
}

export function canStartAttack(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
): boolean {
  const player = getPlayer(state, playerId);
  if (!player.active) return false;
  const attack = getDefinitionSafe(state, player.active.definitionId).attacks?.find(
    (entry) => entry.name === attackName,
  );
  if (!attack) return false;
  const textEffects = parseAttackText(attack.text);
  if (isSecondPlayerFirstTurnBlocked(state, playerId, textEffects)) return false;
  return true;
}
