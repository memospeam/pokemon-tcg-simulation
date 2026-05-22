import { isAceSpec, isItemTrainer } from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import type { PlayerId } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { allPokemonInPlay, getOpponentId, getPlayer, type EngineState } from "../types";
import { isAbilityDisabledOnPokemon } from "./abilityHooks";
import { parseAbilityText } from "./parseText";
import type { ParsedEffect } from "./types";

function opponentActiveHasPassiveEffect(
  state: EngineState,
  playerId: PlayerId,
  effectKind: ParsedEffect["kind"],
): boolean {
  const opponent = getPlayer(state, getOpponentId(playerId));
  if (!opponent.active) return false;
  if (isAbilityDisabledOnPokemon(state, opponent.active)) return false;
  const def = getDefinitionSafe(state, opponent.active.definitionId);
  for (const ability of def.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === effectKind) return true;
    }
  }
  return false;
}

function opponentHasAceNullifier(state: EngineState, playerId: PlayerId): boolean {
  const opponent = getPlayer(state, getOpponentId(playerId));
  for (const pokemon of allPokemonInPlay(opponent)) {
    if (isAbilityDisabledOnPokemon(state, pokemon)) continue;
    if ((pokemon.attachedTools ?? []).length === 0) continue;
    const def = getDefinitionSafe(state, pokemon.definitionId);
    for (const ability of def.abilities ?? []) {
      for (const effect of parseAbilityText(ability).effects) {
        if (effect.kind === "block_opponent_ace_spec_when_tool_attached") return true;
      }
    }
  }
  return false;
}

export function canPlayItemFromHand(state: EngineState, playerId: PlayerId): boolean {
  if (state.itemPlayBlockedForPlayerId === playerId) return false;
  if (opponentActiveHasPassiveEffect(state, playerId, "block_opponent_items_and_tools_while_active")) {
    return false;
  }
  return true;
}

export function canPlayToolFromHand(state: EngineState, playerId: PlayerId): boolean {
  if (opponentActiveHasPassiveEffect(state, playerId, "block_opponent_items_and_tools_while_active")) {
    return false;
  }
  return true;
}

export function canPlayAceSpecFromHand(state: EngineState, playerId: PlayerId): boolean {
  if (opponentHasAceNullifier(state, playerId)) return false;
  return true;
}

export function getItemPlayBlockReason(state: EngineState, playerId: PlayerId): string | null {
  if (state.itemPlayBlockedForPlayerId === playerId) {
    return "Item cards can't be played this turn (Itchy Pollen).";
  }
  if (opponentActiveHasPassiveEffect(state, playerId, "block_opponent_items_and_tools_while_active")) {
    return "Item cards can't be played while the opponent's Active Pokémon has Oceanic Curse.";
  }
  return null;
}

export function getToolPlayBlockReason(state: EngineState, playerId: PlayerId): string | null {
  if (opponentActiveHasPassiveEffect(state, playerId, "block_opponent_items_and_tools_while_active")) {
    return "Pokémon Tool cards can't be played while the opponent's Active Pokémon has Oceanic Curse.";
  }
  return null;
}

export function getAceSpecPlayBlockReason(state: EngineState, playerId: PlayerId): string | null {
  if (opponentHasAceNullifier(state, playerId)) {
    return "ACE SPEC cards can't be played while the opponent's Genesect has a Tool attached (ACE Nullifier).";
  }
  return null;
}

export function canPlayTrainerCardFromHand(
  state: EngineState,
  playerId: PlayerId,
  def: CardDefinition,
): boolean {
  if (isItemTrainer(def)) {
    if (!canPlayItemFromHand(state, playerId)) return false;
    if (isAceSpec(def) && !canPlayAceSpecFromHand(state, playerId)) return false;
  }
  return true;
}
