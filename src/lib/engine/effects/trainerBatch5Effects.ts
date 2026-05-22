import {
  isBasicEnergy,
  isItemTrainer,
  isStadium,
  isSupporter,
  isTool,
} from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { getDefinition, getPlayer, moveToDiscard, type EngineState } from "../types";
import type { ParsedEffect } from "./types";
import { finishDeckSearchShuffle } from "./trainerDeckHelpers";
import type { TrainerPlayCheck } from "./trainerPlayCheck";

export type { TrainerPlayCheck } from "./trainerPlayCheck";

function deckTopCards(state: EngineState, playerId: PlayerId, count: number): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.slice(0, Math.min(count, player.deck.length));
}

function moveDeckCardToHand(state: EngineState, playerId: PlayerId, instanceId: string): boolean {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return false;
  const card = player.deck.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  return true;
}

function isGrassPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && (def.types?.includes("Grass") ?? false);
}

function isBasicGrassEnergy(def: CardDefinition): boolean {
  if (!isBasicEnergy(def)) return false;
  return (
    def.types?.includes("Grass") === true ||
    def.name.toLowerCase().includes("grass")
  );
}

function bugCatchingEligible(def: CardDefinition): boolean {
  return isGrassPokemon(def) || isBasicGrassEnergy(def);
}

export function applyRotoStick(state: EngineState, playerId: PlayerId): void {
  const top = deckTopCards(state, playerId, 4);
  const supporters = top.filter((card) => isSupporter(getDefinitionSafe(state, card.definitionId)));
  if (supporters.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Roto-Stick: no Supporters in the top 4 cards — shuffled deck.");
    return;
  }
  if (supporters.length === 1) {
    moveDeckCardToHand(state, playerId, supporters[0]!.instanceId);
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Roto-Stick: put 1 Supporter into hand and shuffled deck.");
    return;
  }
  state.pendingAction = {
    type: "ROTO_STICK",
    playerId,
    options: supporters.map((card) => card.instanceId),
    pickedIds: [],
  };
  logMessage(state, "Roto-Stick: choose Supporter(s) from the top 4 cards of your deck.");
}

export function continueRotoStickPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ROTO_STICK" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  if (!moveDeckCardToHand(state, playerId, instanceId)) return;

  const pickedIds = [...pending.pickedIds, instanceId];
  const remaining = pending.options.filter((id) => !pickedIds.includes(id));
  if (remaining.length === 0) {
    finishDeckSearchShuffle(state, playerId, "Roto-Stick");
    return;
  }
  state.pendingAction = { ...pending, pickedIds, options: remaining };
}

export function finishRotoStick(state: EngineState, playerId: PlayerId): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ROTO_STICK" || pending.playerId !== playerId) return;
  finishDeckSearchShuffle(state, playerId, "Roto-Stick");
}

export function applyMiracleHeadset(state: EngineState, playerId: PlayerId, count: number): void {
  const player = getPlayer(state, playerId);
  const supporters = player.discard.filter((card) =>
    isSupporter(getDefinitionSafe(state, card.definitionId)),
  );
  if (supporters.length === 0) {
    logMessage(state, "Miracle Headset: no Supporter cards in your discard pile.");
    return;
  }
  if (supporters.length === 1) {
    const card = supporters[0]!;
    const index = player.discard.indexOf(card);
    player.discard.splice(index, 1);
    card.zone = Zone.Hand;
    player.hand.push(card);
    logMessage(state, "Miracle Headset: put 1 Supporter into your hand.");
    return;
  }
  state.pendingAction = {
    type: "MIRACLE_HEADSET",
    playerId,
    options: supporters.map((card) => card.instanceId),
    pickedIds: [],
    maxPicks: count,
  };
  logMessage(state, `Miracle Headset: choose up to ${count} Supporter cards from your discard pile.`);
}

export function continueMiracleHeadsetPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "MIRACLE_HEADSET" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;

  const player = getPlayer(state, playerId);
  const index = player.discard.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.discard.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);

  const pickedIds = [...pending.pickedIds, instanceId];
  const remaining = player.discard
    .filter((entry) => isSupporter(getDefinitionSafe(state, entry.definitionId)))
    .map((entry) => entry.instanceId)
    .filter((id) => !pickedIds.includes(id));

  if (pickedIds.length >= pending.maxPicks || remaining.length === 0) {
    state.pendingAction = null;
    logMessage(state, "Miracle Headset: finished choosing Supporters.");
    return;
  }

  state.pendingAction = { ...pending, pickedIds, options: remaining };
}

export function finishMiracleHeadset(state: EngineState, playerId: PlayerId): void {
  const pending = state.pendingAction;
  if (pending?.type !== "MIRACLE_HEADSET" || pending.playerId !== playerId) return;
  state.pendingAction = null;
  logMessage(state, "Miracle Headset: finished choosing Supporters.");
}

export function applyBugCatchingSet(state: EngineState, playerId: PlayerId, maxPicks: number): void {
  const top = deckTopCards(state, playerId, 7);
  const eligible = top.filter((card) => bugCatchingEligible(getDefinitionSafe(state, card.definitionId)));
  if (eligible.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Bug Catching Set: no [G] Pokémon or Basic [G] Energy in the top 7 cards.");
    return;
  }
  if (eligible.length === 1) {
    moveDeckCardToHand(state, playerId, eligible[0]!.instanceId);
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Bug Catching Set: put 1 card into hand and shuffled deck.");
    return;
  }
  state.pendingAction = {
    type: "BUG_CATCHING_SET",
    playerId,
    options: eligible.map((card) => card.instanceId),
    pickedIds: [],
    maxPicks,
  };
  logMessage(state, `Bug Catching Set: choose up to ${maxPicks} [G] Pokémon or Basic [G] Energy from the top 7 cards.`);
}

export function continueBugCatchingPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "BUG_CATCHING_SET" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  if (!moveDeckCardToHand(state, playerId, instanceId)) return;

  const pickedIds = [...pending.pickedIds, instanceId];
  const remaining = pending.options.filter((id) => !pickedIds.includes(id));
  if (pickedIds.length >= pending.maxPicks || remaining.length === 0) {
    finishDeckSearchShuffle(state, playerId, "Bug Catching Set");
    return;
  }
  state.pendingAction = { ...pending, pickedIds, options: remaining };
}

export function finishBugCatchingSet(state: EngineState, playerId: PlayerId): void {
  const pending = state.pendingAction;
  if (pending?.type !== "BUG_CATCHING_SET" || pending.playerId !== playerId) return;
  finishDeckSearchShuffle(state, playerId, "Bug Catching Set");
}

function secretBoxMatches(
  state: EngineState,
  playerId: PlayerId,
  step: "ITEM" | "TOOL" | "SUPPORTER" | "STADIUM",
): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    if (!def) return false;
    switch (step) {
      case "ITEM":
        return isItemTrainer(def) && !isTool(def) && !isStadium(def);
      case "TOOL":
        return isTool(def);
      case "SUPPORTER":
        return isSupporter(def);
      case "STADIUM":
        return isStadium(def);
      default:
        return false;
    }
  });
}

function startSecretBoxSearch(state: EngineState, playerId: PlayerId): void {
  const steps: Array<"ITEM" | "TOOL" | "SUPPORTER" | "STADIUM"> = ["ITEM", "TOOL", "SUPPORTER", "STADIUM"];
  for (const step of steps) {
    const matches = secretBoxMatches(state, playerId, step);
    if (matches.length === 0) continue;
    if (matches.length === 1) {
      moveDeckCardToHand(state, playerId, matches[0]!.instanceId);
      continue;
    }
    state.pendingAction = {
      type: "SECRET_BOX",
      playerId,
      step,
      options: matches.map((card) => card.instanceId),
    };
    logMessage(state, `Secret Box: choose a ${step.toLowerCase()} card from your deck.`);
    return;
  }
  finishDeckSearchShuffle(state, playerId, "Secret Box");
}

export function applySecretBox(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  if (player.hand.length < 3) {
    logMessage(state, "Secret Box: need at least 3 other cards in your hand to discard.");
    return;
  }
  state.pendingAction = {
    type: "SECRET_BOX",
    playerId,
    step: "DISCARD",
    options: player.hand.map((card) => card.instanceId),
    discardIds: [],
  };
  logMessage(state, "Secret Box: choose 3 cards from your hand to discard.");
}

export function continueSecretBoxDiscard(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "SECRET_BOX" || pending.playerId !== playerId || pending.step !== "DISCARD") return;
  if (!pending.options.includes(instanceId) || pending.discardIds?.includes(instanceId)) return;

  const player = getPlayer(state, playerId);
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.hand.splice(index, 1)[0]!;
  moveToDiscard(player, card);

  const discardIds = [...(pending.discardIds ?? []), instanceId];
  if (discardIds.length < 3) {
    state.pendingAction = {
      ...pending,
      discardIds,
      options: player.hand.map((entry) => entry.instanceId),
    };
    logMessage(state, `Secret Box: discard ${3 - discardIds.length} more card(s).`);
    return;
  }

  startSecretBoxSearch(state, playerId);
}

export function continueSecretBoxSearch(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "SECRET_BOX" || pending.playerId !== playerId) return;
  if (pending.step === "DISCARD") return;
  if (!pending.options.includes(instanceId)) return;
  if (!moveDeckCardToHand(state, playerId, instanceId)) return;

  const currentStep = pending.step;
  const steps: Array<"ITEM" | "TOOL" | "SUPPORTER" | "STADIUM"> = ["ITEM", "TOOL", "SUPPORTER", "STADIUM"];
  const nextIndex = steps.indexOf(currentStep) + 1;
  for (let i = nextIndex; i < steps.length; i += 1) {
    const step = steps[i]!;
    const matches = secretBoxMatches(state, playerId, step);
    if (matches.length === 0) continue;
    if (matches.length === 1) {
      moveDeckCardToHand(state, playerId, matches[0]!.instanceId);
      continue;
    }
    state.pendingAction = {
      type: "SECRET_BOX",
      playerId,
      step,
      options: matches.map((card) => card.instanceId),
    };
    logMessage(state, `Secret Box: choose a ${step.toLowerCase()} card from your deck.`);
    return;
  }
  finishDeckSearchShuffle(state, playerId, "Secret Box");
}

export function canPlayTrainerBatch5Kind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  const player = getPlayer(state, playerId);

  switch (kind) {
    case "trainer_roto_stick":
      if (player.deck.length === 0) {
        return { ok: false, reason: "Roto-Stick: your deck is empty." };
      }
      return { ok: true };
    case "trainer_miracle_headset":
      if (!player.discard.some((card) => isSupporter(getDefinitionSafe(state, card.definitionId)))) {
        return { ok: false, reason: "Miracle Headset: no Supporter cards in your discard pile." };
      }
      return { ok: true };
    case "trainer_secret_box":
      if (player.hand.length < 4) {
        return { ok: false, reason: "Secret Box: need 4 cards in hand (Secret Box plus 3 to discard)." };
      }
      if (
        secretBoxMatches(state, playerId, "ITEM").length === 0 &&
        secretBoxMatches(state, playerId, "TOOL").length === 0 &&
        secretBoxMatches(state, playerId, "SUPPORTER").length === 0 &&
        secretBoxMatches(state, playerId, "STADIUM").length === 0
      ) {
        return { ok: false, reason: "Secret Box: no matching Trainer cards in your deck." };
      }
      return { ok: true };
    case "trainer_bug_catching_set":
      if (player.deck.length === 0) {
        return { ok: false, reason: "Bug Catching Set: your deck is empty." };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function applyTrainerBatch5Kind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  switch (effect.kind) {
    case "trainer_roto_stick":
      applyRotoStick(state, playerId);
      return;
    case "trainer_miracle_headset":
      applyMiracleHeadset(state, playerId, effect.count);
      return;
    case "trainer_secret_box":
      applySecretBox(state, playerId);
      return;
    case "trainer_bug_catching_set":
      applyBugCatchingSet(state, playerId, effect.count);
      return;
    default:
      return;
  }
}
