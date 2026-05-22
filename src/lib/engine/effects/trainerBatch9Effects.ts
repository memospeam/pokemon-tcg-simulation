import type { CardInstance } from "../../models/instance";
import { isTool } from "../../models/definition";
import { PlayerId } from "../../models/enums";
import { logMessage } from "../helpers";
import { createRng } from "../rng";
import { resolveDeckPick } from "../trainerEffects";
import { getDefinition, getPlayer, type EngineState } from "../types";
import type { ParsedEffect } from "./types";

export type TrainerPlayCheck = { ok: true } | { ok: false; reason: string };

function shuffleDeck(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  state.rngSeed += 1;
  const rng = createRng(state.rngSeed + player.deck.length);
  player.deck = rng.shuffle(player.deck);
}

function deckTools(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isTool(def);
  });
}

export function applyTreasureTracker(state: EngineState, playerId: PlayerId, count: number): void {
  const matches = deckTools(state, playerId);
  if (matches.length === 0) {
    shuffleDeck(state, playerId);
    logMessage(state, "Treasure Tracker: no Pokémon Tool cards found in deck.");
    return;
  }
  if (matches.length === 1) {
    resolveDeckPick(state, playerId, matches[0]!.instanceId, "TOOL_HAND");
    logMessage(state, "Treasure Tracker: added a Pokémon Tool to hand.");
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "TOOL_HAND",
    options: matches.map((entry) => entry.instanceId),
    slotsRemaining: Math.min(count, matches.length),
  };
  logMessage(state, `Treasure Tracker: choose up to ${Math.min(count, matches.length)} Pokémon Tool cards from your deck.`);
}

export function canPlayTrainerBatch9Kind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  switch (kind) {
    case "trainer_treasure_tracker":
      if (deckTools(state, playerId).length === 0) {
        return { ok: false, reason: "Treasure Tracker: no Pokémon Tool cards found in your deck." };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function applyTrainerBatch9Kind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  switch (effect.kind) {
    case "trainer_treasure_tracker":
      applyTreasureTracker(state, playerId, effect.count);
      return;
    default:
      return;
  }
}
