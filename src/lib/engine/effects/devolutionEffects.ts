import { isBasicPokemon, isStage1, isStage2 } from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { findDefinitionByName, getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import {
  allPokemonInPlay,
  getOpponentId,
  getPlayer,
  type EngineState,
  type PlayerState,
} from "../types";
import { createCardInstance } from "../../models/instance";
import { getStatusConditionsAfterEvolution } from "./stadiumEffects";
import { resetPokemonCombatState } from "./pokemonZoneHelpers";

function definitionIdFor(state: EngineState, def: CardDefinition): string | null {
  const entry = Object.entries(state.definitions).find(
    ([, candidate]) => candidate.apiId === def.apiId || candidate.name === def.name,
  );
  return entry?.[0] ?? def.apiId ?? null;
}

function evolutionStageRank(def: CardDefinition): number {
  if (isStage2(def)) return 2;
  if (isStage1(def)) return 1;
  return 0;
}

function transferInPlayStateOntoDevolution(
  state: EngineState,
  from: CardInstance,
  to: CardInstance,
  ownerId: PlayerId,
): void {
  to.attachedEnergy = [...from.attachedEnergy];
  to.attachedTools = [...(from.attachedTools ?? [])];
  to.damageCounters = from.damageCounters;
  to.enteredPlayTurn = from.enteredPlayTurn;
  to.zone = from.zone;
  to.ownerId = ownerId;
  to.statusConditions = getStatusConditionsAfterEvolution(state, from);
  from.attachedTools = [];
}

function replacePokemonInPlay(player: PlayerState, outgoing: CardInstance, incoming: CardInstance): boolean {
  if (player.active?.instanceId === outgoing.instanceId) {
    player.active = incoming;
    return true;
  }
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === outgoing.instanceId);
  if (benchIndex >= 0) {
    player.bench[benchIndex] = incoming;
    return true;
  }
  return false;
}

type PlaySlot = { where: "active" } | { where: "bench"; index: number };

function playSlotForPokemon(player: PlayerState, pokemon: CardInstance): PlaySlot | null {
  if (player.active?.instanceId === pokemon.instanceId) return { where: "active" };
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === pokemon.instanceId);
  if (benchIndex >= 0) return { where: "bench", index: benchIndex };
  return null;
}

function pokemonAtSlot(player: PlayerState, slot: PlaySlot): CardInstance | null {
  return slot.where === "active" ? player.active : (player.bench[slot.index] ?? null);
}

function sendEvolutionCardToZone(
  state: EngineState,
  player: PlayerState,
  definitionId: string,
  destination: "hand" | "deck",
): void {
  const evoCard = createCardInstance(definitionId, player.id, destination === "hand" ? Zone.Hand : Zone.Deck);
  resetPokemonCombatState(evoCard);
  if (destination === "hand") {
    player.hand.push(evoCard);
    return;
  }
  player.deck.push(evoCard);
  shufflePlayerDeck(state, player.id);
}

/** Devolve one stage: the current evolution card leaves play; the Pokémon becomes its previous stage. */
export function devolvePokemonOneStage(
  state: EngineState,
  playerId: PlayerId,
  pokemon: CardInstance,
  evoDestination: "hand" | "deck",
): boolean {
  const player = getPlayer(state, playerId);
  const def = getDefinitionSafe(state, pokemon.definitionId);
  if (isBasicPokemon(def) || !def.evolvesFrom) return false;

  const prevDef = findDefinitionByName(state.definitions, def.evolvesFrom);
  if (!prevDef) return false;

  const prevDefId = definitionIdFor(state, prevDef);
  if (!prevDefId) return false;

  const reverted = createCardInstance(prevDefId, playerId, pokemon.zone);
  transferInPlayStateOntoDevolution(state, pokemon, reverted, playerId);
  if (!replacePokemonInPlay(player, pokemon, reverted)) return false;

  sendEvolutionCardToZone(state, player, pokemon.definitionId, evoDestination);
  logMessage(
    state,
    `${player.name}'s ${def.name} devolved to ${prevDef.name} (${evoDestination === "hand" ? "evolution card to hand" : "evolution card shuffled into deck"}).`,
  );
  return true;
}

export function findEvolvedPokemon(
  state: EngineState,
  player: PlayerState,
  filter?: (def: CardDefinition) => boolean,
): CardInstance | null {
  let best: CardInstance | null = null;
  let bestRank = 0;
  for (const pokemon of allPokemonInPlay(player)) {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    if (isBasicPokemon(def)) continue;
    if (filter && !filter(def)) continue;
    const rank = evolutionStageRank(def);
    if (rank > bestRank) {
      best = pokemon;
      bestRank = rank;
    }
  }
  return best;
}

export function devolveOneOpponentEvolved(state: EngineState, playerId: PlayerId): boolean {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const target = findEvolvedPokemon(state, opponent);
  if (!target) {
    logMessage(state, "No evolved opponent Pokémon to devolve.");
    return false;
  }
  return devolvePokemonOneStage(state, opponent.id, target, "hand");
}

export function devolveEachOpponentEvolved(state: EngineState, playerId: PlayerId): void {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const evolved = allPokemonInPlay(opponent).filter(
    (pokemon) => !isBasicPokemon(getDefinitionSafe(state, pokemon.definitionId)),
  );
  if (evolved.length === 0) {
    logMessage(state, "No evolved opponent Pokémon to devolve.");
    return;
  }
  for (const pokemon of evolved) {
    devolvePokemonOneStage(state, opponent.id, pokemon, "deck");
  }
}

export function listDevolveEligibleTyped(
  state: EngineState,
  playerId: PlayerId,
  pokemonType: string,
): CardInstance[] {
  const player = getPlayer(state, playerId);
  const type = pokemonType.toLowerCase();
  return allPokemonInPlay(player).filter((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    if (isBasicPokemon(def)) return false;
    return (def.types ?? []).some((entry) => entry.toLowerCase() === type);
  });
}

function devolveAtSlot(
  state: EngineState,
  playerId: PlayerId,
  slot: PlaySlot,
  options?: { untilBasic?: boolean; blockEvolveThisTurn?: boolean },
): boolean {
  const untilBasic = options?.untilBasic ?? true;
  const blockEvolveThisTurn = options?.blockEvolveThisTurn ?? true;
  const player = getPlayer(state, playerId);

  let devolvedAny = false;
  while (true) {
    const mon = pokemonAtSlot(player, slot);
    if (!mon) break;
    const def = getDefinitionSafe(state, mon.definitionId);
    if (isBasicPokemon(def) || !def.evolvesFrom) break;
    if (!devolvePokemonOneStage(state, playerId, mon, "hand")) break;
    devolvedAny = true;
    if (!untilBasic) break;
  }

  if (devolvedAny && blockEvolveThisTurn) {
    const finalMon = pokemonAtSlot(player, slot);
    if (finalMon) finalMon.enteredPlayTurn = state.turnNumber;
  }
  return devolvedAny;
}

export function devolveOwnTypedPokemonById(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  pokemonType: string,
  options?: { untilBasic?: boolean; blockEvolveThisTurn?: boolean },
): boolean {
  const player = getPlayer(state, playerId);
  const type = pokemonType.toLowerCase();
  const target = allPokemonInPlay(player).find((pokemon) => pokemon.instanceId === instanceId);
  if (!target) return false;
  const def = getDefinitionSafe(state, target.definitionId);
  if (isBasicPokemon(def) || !(def.types ?? []).some((entry) => entry.toLowerCase() === type)) {
    return false;
  }
  const slot = playSlotForPokemon(player, target);
  if (!slot) return false;
  return devolveAtSlot(state, playerId, slot, options);
}

export function startDevolveOwnTypedFlow(state: EngineState, playerId: PlayerId, pokemonType: string): void {
  const options = listDevolveEligibleTyped(state, playerId, pokemonType);
  if (options.length === 0) {
    logMessage(state, `No evolved ${pokemonType} Pokémon to devolve.`);
    return;
  }
  if (options.length === 1) {
    devolveOwnTypedPokemonById(state, playerId, options[0]!.instanceId, pokemonType);
    return;
  }
  state.pendingAction = {
    type: "STRANGE_TIMEPIECE",
    playerId,
    pokemonType,
    options: options.map((pokemon) => pokemon.instanceId),
  };
  logMessage(state, `Strange Timepiece: choose an evolved ${pokemonType} Pokémon to devolve.`);
}

export function resolveDevolveOwnTypedById(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "STRANGE_TIMEPIECE" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  devolveOwnTypedPokemonById(state, playerId, instanceId, pending.pokemonType);
  state.pendingAction = null;
}

export function devolveOwnTypedPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonType: string,
  options?: { untilBasic?: boolean; blockEvolveThisTurn?: boolean },
): boolean {
  const target = findEvolvedPokemon(state, getPlayer(state, playerId), (def) =>
    (def.types ?? []).some((entry) => entry.toLowerCase() === pokemonType.toLowerCase()),
  );
  if (!target) {
    logMessage(state, `No evolved ${pokemonType} Pokémon to devolve.`);
    return false;
  }
  return devolveOwnTypedPokemonById(state, playerId, target.instanceId, pokemonType, options);
}
