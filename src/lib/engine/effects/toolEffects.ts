import type { CardDefinition } from "../../models/definition";
import { isCynthiasPokemon, isLilliesPokemon, isTool } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { drawCards, getDefinitionSafe } from "../rules";
import { logMessage } from "../helpers";
import {
  allPokemonInPlay,
  findInstance,
  getOpponentId,
  getPlayer,
  moveToDiscard,
  type EngineState,
  type PlayerState,
} from "../types";
import { attachEnergyToPokemon } from "../trainerEffects";
import { parseToolKind, type ToolKind } from "./parseTextTool";

export function getToolKind(state: EngineState, tool: CardInstance): ToolKind {
  const def = getDefinitionSafe(state, tool.definitionId);
  return parseToolKind(def);
}

export function transferPokemonStateOntoEvolution(from: CardInstance, to: CardInstance, ownerId: PlayerId): void {
  to.attachedEnergy = [...from.attachedEnergy];
  to.attachedTools = [...(from.attachedTools ?? [])];
  to.damageCounters = from.damageCounters;
  to.enteredPlayTurn = from.enteredPlayTurn;
  to.zone = from.zone;
  to.ownerId = ownerId;
  from.attachedTools = [];
}

export function discardToolsFromPokemon(
  _state: EngineState,
  player: PlayerState,
  pokemon: CardInstance,
): void {
  for (const tool of pokemon.attachedTools ?? []) {
    moveToDiscard(player, tool);
  }
  pokemon.attachedTools = [];
}

export function discardPokemonAttachments(
  state: EngineState,
  player: PlayerState,
  pokemon: CardInstance,
): void {
  for (const energy of pokemon.attachedEnergy) {
    moveToDiscard(player, energy);
  }
  pokemon.attachedEnergy = [];
  discardToolsFromPokemon(state, player, pokemon);
}

export function findPokemonWithTool(state: EngineState, toolInstanceId: string): CardInstance | null {
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    for (const pokemon of allPokemonInPlay(player)) {
      if ((pokemon.attachedTools ?? []).some((tool) => tool.instanceId === toolInstanceId)) {
        return pokemon;
      }
    }
  }
  return null;
}

export function listAllAttachedTools(state: EngineState): { tool: CardInstance; ownerId: PlayerId }[] {
  const results: { tool: CardInstance; ownerId: PlayerId }[] = [];
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    for (const pokemon of allPokemonInPlay(player)) {
      for (const tool of pokemon.attachedTools ?? []) {
        results.push({ tool, ownerId: playerId });
      }
    }
  }
  return results;
}

export function countToolsOnPlayerPokemon(state: EngineState, playerId: PlayerId): number {
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).reduce((sum, pokemon) => sum + (pokemon.attachedTools?.length ?? 0), 0);
}

export function canAttachToolToPokemon(
  state: EngineState,
  playerId: PlayerId,
  toolDef: CardDefinition,
  pokemon: CardInstance,
): boolean {
  if (pokemon.ownerId !== playerId) return false;
  const kind = parseToolKind(toolDef);
  if (kind === "cynthias_power_weight") {
    const pokemonDef = getDefinitionSafe(state, pokemon.definitionId);
    if (!isCynthiasPokemon(pokemonDef)) return false;
  }
  if (kind === "lillies_pearl") {
    const pokemonDef = getDefinitionSafe(state, pokemon.definitionId);
    if (!isLilliesPokemon(pokemonDef)) return false;
  }
  return true;
}

export function attachToolToPokemon(
  state: EngineState,
  playerId: PlayerId,
  tool: CardInstance,
  pokemon: CardInstance,
): boolean {
  const player = getPlayer(state, playerId);
  const toolDef = getDefinitionSafe(state, tool.definitionId);
  if (!isTool(toolDef)) return false;
  if (!canAttachToolToPokemon(state, playerId, toolDef, pokemon)) return false;

  discardToolsFromPokemon(state, player, pokemon);
  tool.zone = Zone.Active;
  tool.ownerId = playerId;
  if (!pokemon.attachedTools) pokemon.attachedTools = [];
  pokemon.attachedTools.push(tool);
  logMessage(
    state,
    `${player.name} attached ${toolDef.name} to ${getDefinitionSafe(state, pokemon.definitionId).name}.`,
  );
  return true;
}

export function discardAttachedTool(
  state: EngineState,
  toolInstanceId: string,
): boolean {
  const pokemon = findPokemonWithTool(state, toolInstanceId);
  if (!pokemon) return false;
  const player = getPlayer(state, pokemon.ownerId);
  const index = (pokemon.attachedTools ?? []).findIndex((tool) => tool.instanceId === toolInstanceId);
  if (index === -1) return false;
  const tool = pokemon.attachedTools!.splice(index, 1)[0]!;
  const toolDef = getDefinitionSafe(state, tool.definitionId);
  moveToDiscard(player, tool);
  logMessage(state, `${toolDef.name} was discarded.`);
  return true;
}

export function getToolRetreatReduction(state: EngineState, pokemon: CardInstance): number {
  let reduction = 0;
  for (const tool of pokemon.attachedTools ?? []) {
    if (getToolKind(state, tool) === "air_balloon") reduction += 2;
  }
  return reduction;
}

export function getToolHpBonus(state: EngineState, pokemon: CardInstance): number {
  let bonus = 0;
  for (const tool of pokemon.attachedTools ?? []) {
    const kind = getToolKind(state, tool);
    if (kind === "cynthias_power_weight") bonus += 70;
    if (kind === "heroes_cape") bonus += 100;
  }
  return bonus;
}

export function getToolAttackBonus(
  state: EngineState,
  attacker: CardInstance,
  _opponentActive: CardInstance,
): number {
  if (!attacker.statusConditions.includes("Poisoned")) return 0;
  let bonus = 0;
  for (const tool of attacker.attachedTools ?? []) {
    if (getToolKind(state, tool) === "binding_mochi") bonus += 40;
  }
  return bonus;
}

export function getToolPrizeReduction(state: EngineState, knockedOut: CardInstance): number {
  let reduction = 0;
  for (const tool of knockedOut.attachedTools ?? []) {
    if (getToolKind(state, tool) === "lillies_pearl") reduction += 1;
  }
  return reduction;
}

export function discardToolsFromOpponentActive(
  state: EngineState,
  opponentId: PlayerId,
  max = 2,
): number {
  const opponent = getPlayer(state, opponentId);
  if (!opponent.active) return 0;
  let discarded = 0;
  while (discarded < max && (opponent.active.attachedTools?.length ?? 0) > 0) {
    const tool = opponent.active.attachedTools!.shift()!;
    moveToDiscard(opponent, tool);
    discarded += 1;
    logMessage(
      state,
      `Discarded ${getDefinitionSafe(state, tool.definitionId).name} from ${getDefinitionSafe(state, opponent.active.definitionId).name}.`,
    );
  }
  return discarded;
}

export function onActiveDamagedByOpponentAttackTools(
  state: EngineState,
  defender: CardInstance,
  attacker: CardInstance,
  damageDealt: number,
): void {
  if (damageDealt <= 0) return;

  const defenderPlayer = getPlayer(state, defender.ownerId);
  const opponent = getPlayer(state, getOpponentId(defender.ownerId));
  if (defender !== defenderPlayer.active) return;

  for (const tool of defender.attachedTools ?? []) {
    const kind = getToolKind(state, tool);
    if (kind === "lucky_helmet") {
      drawCards(state, defender.ownerId, 2);
      logMessage(state, "Lucky Helmet: drew 2 cards.");
    }
    if (kind === "handheld_fan") {
      if (attacker.attachedEnergy.length === 0) continue;
      const benchTargets = opponent.bench.filter((p) => p.attachedEnergy.length >= 0);
      if (benchTargets.length === 0) continue;
      const energy = attacker.attachedEnergy.shift()!;
      const target = benchTargets[0]!;
      attachEnergyToPokemon(state, getOpponentId(defender.ownerId), energy, target);
      logMessage(
        state,
        `Handheld Fan: moved Energy from ${getDefinitionSafe(state, attacker.definitionId).name} to ${getDefinitionSafe(state, target.definitionId).name}.`,
      );
    }
  }
}

export function findToolInPlay(state: EngineState, toolInstanceId: string): CardInstance | null {
  for (const entry of listAllAttachedTools(state)) {
    if (entry.tool.instanceId === toolInstanceId) return entry.tool;
  }
  return findInstance(state, toolInstanceId);
}
