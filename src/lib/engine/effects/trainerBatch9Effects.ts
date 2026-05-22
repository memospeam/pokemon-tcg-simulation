import { isTool } from "../../models/definition";
import { PlayerId } from "../../models/enums";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { resolveDeckPick } from "../trainerEffects";
import type { EngineState } from "../types";
import type { ParsedEffect } from "./types";
import { deckMatching } from "./trainerDeckHelpers";
import type { TrainerPlayCheck } from "./trainerPlayCheck";

export type { TrainerPlayCheck } from "./trainerPlayCheck";

function deckTools(state: EngineState, playerId: PlayerId) {
  return deckMatching(state, playerId, isTool);
}

export function applyTreasureTracker(state: EngineState, playerId: PlayerId, count: number): void {
  const matches = deckTools(state, playerId);
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
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
