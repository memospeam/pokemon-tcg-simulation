import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { resolveDeckPick } from "../trainerEffects";
import { getOpponentId, getPlayer, type EngineState } from "../types";
import type { ParsedEffect } from "./types";
import { deckMatching, switchActiveWithBench } from "./trainerDeckHelpers";
import type { TrainerPlayCheck } from "./trainerPlayCheck";

export type { TrainerPlayCheck } from "./trainerPlayCheck";

function switchOpponentBenchToActive(
  state: EngineState,
  playerId: PlayerId,
  benchId: string,
): boolean {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const benchIndex = opponent.bench.findIndex((entry) => entry.instanceId === benchId);
  if (benchIndex === -1 || !opponent.active) return false;
  const incoming = opponent.bench.splice(benchIndex, 1)[0]!;
  const outgoing = opponent.active;
  outgoing.zone = Zone.Bench;
  opponent.bench.push(outgoing);
  incoming.zone = Zone.Active;
  opponent.active = incoming;
  logMessage(
    state,
    `${getPlayer(state, playerId).name} switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
  return true;
}

function deckPokemon(state: EngineState, playerId: PlayerId): CardInstance[] {
  return deckMatching(state, playerId, (def) => def.supertype === "Pokémon");
}

export function applyPrimeCatcher(state: EngineState, playerId: PlayerId): void {
  const opponent = getPlayer(state, getOpponentId(playerId));
  if (opponent.bench.length === 0) {
    logMessage(state, "Prime Catcher: opponent has no Benched Pokémon.");
    return;
  }
  if (opponent.bench.length === 1) {
    resolvePrimeCatcherOpponentBench(state, playerId, opponent.bench[0]!.instanceId);
    return;
  }
  state.pendingAction = {
    type: "PRIME_CATCHER",
    playerId,
    step: "OPPONENT_BENCH",
    options: opponent.bench.map((entry) => entry.instanceId),
  };
  logMessage(state, "Prime Catcher: choose an opponent's Benched Pokémon to switch into the Active Spot.");
}

export function resolvePrimeCatcherOpponentBench(
  state: EngineState,
  playerId: PlayerId,
  benchId: string,
): void {
  const pending = state.pendingAction;
  if (
    pending?.type === "PRIME_CATCHER" &&
    pending.playerId === playerId &&
    pending.step !== "OPPONENT_BENCH"
  ) {
    return;
  }
  if (!switchOpponentBenchToActive(state, playerId, benchId)) return;

  const player = getPlayer(state, playerId);
  if (!player.active || player.bench.length === 0) {
    state.pendingAction = null;
    logMessage(state, "Prime Catcher: opponent's Active Pokémon was switched.");
    return;
  }
  if (player.bench.length === 1) {
    resolvePrimeCatcherOwnBench(state, playerId, player.bench[0]!.instanceId);
    return;
  }
  state.pendingAction = {
    type: "PRIME_CATCHER",
    playerId,
    step: "OWN_BENCH",
    opponentBenchId: benchId,
    options: player.bench.map((entry) => entry.instanceId),
  };
  logMessage(state, "Prime Catcher: switch your Active Pokémon with a Benched Pokémon.");
}

export function resolvePrimeCatcherOwnBench(
  state: EngineState,
  playerId: PlayerId,
  benchId: string,
): void {
  if (!switchActiveWithBench(state, playerId, benchId)) return;
  state.pendingAction = null;
  logMessage(state, "Prime Catcher: both Active Pokémon were switched.");
}

export function applyMasterBall(state: EngineState, playerId: PlayerId): void {
  const matches = deckPokemon(state, playerId);
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Master Ball: no Pokémon found in deck.");
    return;
  }
  if (matches.length === 1) {
    resolveDeckPick(state, playerId, matches[0]!.instanceId, "ANY_POKEMON");
    logMessage(state, "Master Ball: added a Pokémon to hand.");
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "ANY_POKEMON",
    options: matches.map((entry) => entry.instanceId),
  };
  logMessage(state, "Master Ball: choose a Pokémon from your deck.");
}

export function canPlayTrainerBatch7Kind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));

  switch (kind) {
    case "trainer_prime_catcher":
      if (!player.active) {
        return { ok: false, reason: "Prime Catcher requires an Active Pokémon." };
      }
      if (opponent.bench.length === 0) {
        return { ok: false, reason: "Prime Catcher: opponent has no Benched Pokémon." };
      }
      return { ok: true };
    case "trainer_master_ball":
      if (deckPokemon(state, playerId).length === 0) {
        return { ok: false, reason: "Master Ball: no Pokémon found in your deck." };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function applyTrainerBatch7Kind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  switch (effect.kind) {
    case "trainer_prime_catcher":
      applyPrimeCatcher(state, playerId);
      return;
    case "trainer_master_ball":
      applyMasterBall(state, playerId);
      return;
    default:
      return;
  }
}
