import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { getDefinition, getPlayer, type EngineState } from "../types";
import { markMovedFromBenchToActive } from "./pokemonZoneHelpers";

export function deckMatching(
  state: EngineState,
  playerId: PlayerId,
  predicate: (def: CardDefinition) => boolean,
): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && predicate(def);
  });
}

export function addFromDeckToHand(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  label: string,
  verb: "added" | "revealed" = "added",
): void {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.deck.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  logMessage(
    state,
    verb === "revealed"
      ? `${player.name} revealed ${getDefinitionSafe(state, card.definitionId).name} (${label}).`
      : `${player.name} added ${getDefinitionSafe(state, card.definitionId).name} to hand (${label}).`,
  );
}

export function switchActiveWithBench(
  state: EngineState,
  playerId: PlayerId,
  benchId: string,
): boolean {
  const player = getPlayer(state, playerId);
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === benchId);
  if (benchIndex === -1 || !player.active) return false;
  const incoming = player.bench.splice(benchIndex, 1)[0]!;
  const outgoing = player.active;
  outgoing.zone = Zone.Bench;
  player.bench.push(outgoing);
  incoming.zone = Zone.Active;
  player.active = incoming;
  markMovedFromBenchToActive(state, incoming.instanceId);
  logMessage(
    state,
    `${player.name} switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
  return true;
}

export function finishDeckSearchShuffle(
  state: EngineState,
  playerId: PlayerId,
  label: string,
): void {
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, `${label}: shuffled deck.`);
}
