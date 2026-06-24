import type { PlayerId } from "../../models/enums";
import { PlayerId as PlayerIdEnum } from "../../models/enums";
import type { CardInstance } from "../../models/instance";
import { isBasicPokemon } from "../../models/definition";
import { getOpponentId, getPlayer, type EngineState } from "../types";

import { getDefinitionSafe } from "../rules";
import { parseAbilityText } from "./parseText";
import { getToolDamageReduction } from "./toolEffects";
import { getStadiumDamageReduction } from "./stadiumEffects";

export type ModifierPhase = "pending" | "active";

export function allOwnedPokemon(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  const list: CardInstance[] = [];
  if (player.active) list.push(player.active);
  list.push(...player.bench);
  return list;
}

export function allPokemonInGame(state: EngineState): CardInstance[] {
  return [PlayerIdEnum.P1, PlayerIdEnum.P2].flatMap((playerId) => allOwnedPokemon(state, playerId));
}

/** Call when a player's turn begins (after currentPlayerId switches). */
export function activatePendingModifiersForTurnStart(state: EngineState, currentPlayerId: PlayerId): void {
  for (const playerId of [PlayerIdEnum.P1, PlayerIdEnum.P2]) {
    for (const pokemon of allOwnedPokemon(state, playerId)) {
      if (pokemon.cantAttackNextOwnerTurn === "pending" && playerId === currentPlayerId) {
        pokemon.cantAttackNextOwnerTurn = "active";
      }
      if (pokemon.cantRetreatNextOpponentTurn === "pending" && playerId === currentPlayerId) {
        pokemon.cantRetreatNextOpponentTurn = "active";
      }
      if (
        pokemon.damageReductionPending !== undefined &&
        getOpponentId(playerId) === currentPlayerId
      ) {
        pokemon.damageReductionNextOpponentTurn = pokemon.damageReductionPending;
        pokemon.damageReductionPending = undefined;
      }
      if (
        pokemon.preventDamageEffectsNextOpponentTurn === "pending" &&
        getOpponentId(playerId) === currentPlayerId
      ) {
        pokemon.preventDamageEffectsNextOpponentTurn = "active";
      }
      if (
        pokemon.preventDamageFromBasicNonColorless === "pending" &&
        getOpponentId(playerId) === currentPlayerId
      ) {
        pokemon.preventDamageFromBasicNonColorless = "active";
      }
      if (pokemon.blockedAttackNextOpponentTurn?.phase === "pending" && playerId === currentPlayerId) {
        pokemon.blockedAttackNextOpponentTurn = {
          ...pokemon.blockedAttackNextOpponentTurn,
          phase: "active",
        };
      }
      if (
        pokemon.noWeaknessNextOpponentTurn === "pending" &&
        getOpponentId(playerId) === currentPlayerId
      ) {
        pokemon.noWeaknessNextOpponentTurn = "active";
      }
    }
  }
}

/** Call when a player ends their turn. */
export function clearModifiersWhenTurnEnds(state: EngineState, playerIdWhoEndedTurn: PlayerId): void {
  for (const playerId of [PlayerIdEnum.P1, PlayerIdEnum.P2]) {
    for (const pokemon of allOwnedPokemon(state, playerId)) {
      if (playerId === playerIdWhoEndedTurn && pokemon.cantAttackNextOwnerTurn === "active") {
        pokemon.cantAttackNextOwnerTurn = undefined;
      }
      if (playerId === playerIdWhoEndedTurn && pokemon.cantRetreatNextOpponentTurn === "active") {
        pokemon.cantRetreatNextOpponentTurn = undefined;
      }
      if (
        getOpponentId(playerId) === playerIdWhoEndedTurn &&
        pokemon.damageReductionNextOpponentTurn !== undefined
      ) {
        pokemon.damageReductionNextOpponentTurn = undefined;
      }
      if (
        getOpponentId(playerId) === playerIdWhoEndedTurn &&
        pokemon.preventDamageEffectsNextOpponentTurn === "active"
      ) {
        pokemon.preventDamageEffectsNextOpponentTurn = undefined;
      }
      if (
        getOpponentId(playerId) === playerIdWhoEndedTurn &&
        pokemon.preventDamageFromBasicNonColorless === "active"
      ) {
        pokemon.preventDamageFromBasicNonColorless = undefined;
      }
      if (playerId === playerIdWhoEndedTurn && pokemon.blockedAttackNextOpponentTurn?.phase === "active") {
        pokemon.blockedAttackNextOpponentTurn = undefined;
      }
      if (
        getOpponentId(playerId) === playerIdWhoEndedTurn &&
        pokemon.noWeaknessNextOpponentTurn === "active"
      ) {
        pokemon.noWeaknessNextOpponentTurn = undefined;
      }
    }
  }
}

export function getPassiveDamageReduction(
  state: EngineState,
  pokemon: CardInstance,
  attacker?: CardInstance,
): number {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  let reduction = 0;

  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "damage_reduction_passive") {
        reduction += effect.amount;
      }
    }
  }

  if (attacker) {
    for (const owned of allOwnedPokemon(state, pokemon.ownerId)) {
      const ownerDef = getDefinitionSafe(state, owned.definitionId);
      for (const ability of ownerDef.abilities ?? []) {
        for (const effect of parseAbilityText(ability).effects) {
          if (effect.kind !== "damage_reduction_passive_typed") continue;
          const filter = effect.nameFilter.toLowerCase();
          const hasOther = allOwnedPokemon(state, pokemon.ownerId).some(
            (mon) =>
              mon.instanceId !== owned.instanceId &&
              getDefinitionSafe(state, mon.definitionId).name.toLowerCase().includes(filter),
          );
          if (!hasOther) continue;
          const targetDef = getDefinitionSafe(state, pokemon.definitionId);
          if (
            isBasicPokemon(targetDef) &&
            targetDef.types?.some((t) => t.toLowerCase() === effect.typeFilter.toLowerCase())
          ) {
            reduction += effect.amount;
          }
        }
      }
    }

    for (const opponentMon of allOwnedPokemon(state, getOpponentId(pokemon.ownerId))) {
      const oppDef = getDefinitionSafe(state, opponentMon.definitionId);
      for (const ability of oppDef.abilities ?? []) {
        for (const effect of parseAbilityText(ability).effects) {
          if (effect.kind === "reduce_damage_vs_tool_active") {
            reduction += effect.amount;
          }
        }
      }
    }
  }

  return reduction;
}

export function applyDamageReduction(
  state: EngineState,
  damage: number,
  target: CardInstance | null | undefined,
  attacker?: CardInstance,
): number {
  if (!target) return damage;
  const reduction =
    (target.damageReductionNextOpponentTurn ?? 0) +
    getPassiveDamageReduction(state, target, attacker) +
    getToolDamageReduction(state, target, attacker) +
    getStadiumDamageReduction(state, target);
  return Math.max(0, damage - reduction);
}

export function hasPreventAttackEffectsOnSelf(state: EngineState, pokemon: CardInstance): boolean {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "prevent_attack_effects_on_self") return true;
    }
  }
  return false;
}

export function isProtectedFromAttackEffects(
  state: EngineState,
  pokemon: CardInstance | null | undefined,
): boolean {
  if (!pokemon) return false;
  if (pokemon.preventDamageEffectsNextOpponentTurn === "active") return true;
  return hasPreventAttackEffectsOnSelf(state, pokemon);
}

export function canPokemonAttack(pokemon: CardInstance): boolean {
  return pokemon.cantAttackNextOwnerTurn !== "active";
}

export function canPokemonRetreat(pokemon: CardInstance): boolean {
  return pokemon.cantRetreatNextOpponentTurn !== "active";
}
