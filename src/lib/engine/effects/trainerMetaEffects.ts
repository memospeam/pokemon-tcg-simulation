import {
  isBasicEnergy,
  isBasicPokemon,
  isColorlessPokemon,
  isEnergyCard,
  isNsPokemon,
  isPokemonEx,
  isStage1,
  isStage2,
  isStadium,
  isSupporter,
  isTeamRocketPokemon,
  isTool,
  getHp,
} from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone } from "../../models/enums";
import { drawCards, getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  type EngineState,
  type PendingAction,
} from "../types";
import type { ParsedEffect } from "./types";
import { attachEnergyToPokemon } from "../trainerEffects";
import { discardAttachedTool, listAllAttachedTools } from "./toolEffects";
import { addFromDeckToHand, deckMatching } from "./trainerDeckHelpers";
import type { TrainerPlayCheck } from "./trainerPlayCheck";

export type { TrainerPlayCheck } from "./trainerPlayCheck";

function drawUntilHand(state: EngineState, playerId: PlayerId, target: number): void {
  const player = getPlayer(state, playerId);
  let drawn = 0;
  while (player.hand.length < target && player.deck.length > 0) {
    const card = player.deck.shift()!;
    card.zone = Zone.Hand;
    player.hand.push(card);
    drawn += 1;
  }
  if (drawn > 0) {
    logMessage(state, `${player.name} drew until they had ${player.hand.length} cards in hand.`);
  }
}

function allInPlayAreTeamRocket(state: EngineState, playerId: PlayerId): boolean {
  const inPlay = allPokemonInPlay(getPlayer(state, playerId));
  if (inPlay.length === 0) return false;
  return inPlay.every((pokemon) => isTeamRocketPokemon(getDefinitionSafe(state, pokemon.definitionId)));
}

function shuffleHandIntoDeck(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const returned = [...player.hand];
  player.hand = [];
  for (const card of returned) {
    card.zone = Zone.Deck;
    player.deck.push(card);
  }
  shufflePlayerDeck(state, playerId);
}

export function applyDawn(state: EngineState, playerId: PlayerId): void {
  const basic = deckMatching(state, playerId, isBasicPokemon);
  if (basic.length === 0) {
    logMessage(state, "Dawn: no Basic Pokémon found in deck.");
    shufflePlayerDeck(state, playerId);
    return;
  }
  if (basic.length === 1) {
    addFromDeckToHand(state, playerId, basic[0]!.instanceId, "Dawn", "revealed");
    continueDawnAfterBasic(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "DAWN",
    playerId,
    step: "BASIC",
    options: basic.map((entry) => entry.instanceId),
  };
  logMessage(state, "Dawn: choose a Basic Pokémon from your deck.");
}

function continueDawnAfterBasic(state: EngineState, playerId: PlayerId): void {
  const stage1 = deckMatching(state, playerId, isStage1);
  if (stage1.length === 0) {
    continueDawnAfterStage1(state, playerId);
    return;
  }
  if (stage1.length === 1) {
    addFromDeckToHand(state, playerId, stage1[0]!.instanceId, "Dawn", "revealed");
    continueDawnAfterStage1(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "DAWN",
    playerId,
    step: "STAGE1",
    options: stage1.map((entry) => entry.instanceId),
  };
  logMessage(state, "Dawn: choose a Stage 1 Pokémon from your deck.");
}

function continueDawnAfterStage1(state: EngineState, playerId: PlayerId): void {
  const stage2 = deckMatching(state, playerId, isStage2);
  if (stage2.length === 0) {
    finishDawn(state, playerId);
    return;
  }
  if (stage2.length === 1) {
    addFromDeckToHand(state, playerId, stage2[0]!.instanceId, "Dawn", "revealed");
    finishDawn(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "DAWN",
    playerId,
    step: "STAGE2",
    options: stage2.map((entry) => entry.instanceId),
  };
  logMessage(state, "Dawn: choose a Stage 2 Pokémon from your deck.");
}

function finishDawn(state: EngineState, playerId: PlayerId): void {
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, "Dawn: shuffled deck.");
}

export function resolveDawnPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "DAWN" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  addFromDeckToHand(state, playerId, instanceId, "Dawn", "revealed");
  if (pending.step === "BASIC") continueDawnAfterBasic(state, playerId);
  else if (pending.step === "STAGE1") continueDawnAfterStage1(state, playerId);
  else finishDawn(state, playerId);
}

export function applyAriana(state: EngineState, playerId: PlayerId): void {
  const target = allInPlayAreTeamRocket(state, playerId) ? 8 : 5;
  drawUntilHand(state, playerId, target);
}

export function applyArcher(state: EngineState, playerId: PlayerId): void {
  const opponentId = getOpponentId(playerId);
  shuffleHandIntoDeck(state, playerId);
  shuffleHandIntoDeck(state, opponentId);
  drawCards(state, playerId, 5);
  drawCards(state, opponentId, 3);
  state.teamRocketKnockedOutSinceMyLastTurn[playerId] = false;
  logMessage(state, "Team Rocket's Archer: both players shuffled their hands into their decks.");
}

export function applyProton(state: EngineState, playerId: PlayerId, count: number): void {
  const matches = deckMatching(
    state,
    playerId,
    (def) => isBasicPokemon(def) && isTeamRocketPokemon(def),
  );
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Team Rocket's Proton: no Basic Team Rocket's Pokémon in deck.");
    return;
  }
  if (matches.length <= count) {
    for (const card of matches) addFromDeckToHand(state, playerId, card.instanceId, "Proton", "revealed");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "TEAM_ROCKET_BASIC_HAND",
    options: matches.map((entry) => entry.instanceId),
    slotsRemaining: count,
  };
  logMessage(state, `Team Rocket's Proton: choose up to ${count} Basic Team Rocket's Pokémon.`);
}

export function applyPetrel(state: EngineState, playerId: PlayerId): void {
  const matches = deckMatching(state, playerId, (def) => def.supertype === "Trainer");
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Team Rocket's Petrel: no Trainer cards in deck.");
    return;
  }
  if (matches.length === 1) {
    addFromDeckToHand(state, playerId, matches[0]!.instanceId, "Petrel", "revealed");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "ANY_TRAINER_HAND",
    options: matches.map((entry) => entry.instanceId),
  };
  logMessage(state, "Team Rocket's Petrel: choose a Trainer from your deck.");
}

export function applyCyrano(state: EngineState, playerId: PlayerId, count: number): void {
  const matches = deckMatching(state, playerId, isPokemonEx);
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Cyrano: no Pokémon ex in deck.");
    return;
  }
  if (matches.length <= count) {
    for (const card of matches) addFromDeckToHand(state, playerId, card.instanceId, "Cyrano", "revealed");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "POKEMON_EX_HAND",
    options: matches.map((entry) => entry.instanceId),
    slotsRemaining: count,
  };
  logMessage(state, `Cyrano: choose up to ${count} Pokémon ex from your deck.`);
}

export function applyCiphermaniac(state: EngineState, playerId: PlayerId, count: number): void {
  const player = getPlayer(state, playerId);
  if (player.deck.length === 0) return;
  if (player.deck.length <= count) {
    const picked = [...player.deck];
    player.deck = [];
    for (const card of picked) {
      card.zone = Zone.Deck;
      player.deck.unshift(card);
    }
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Ciphermaniac's Codebreaking: put searched cards on top of the deck.");
    return;
  }
  state.pendingAction = {
    type: "CIPHERMANIAC",
    playerId,
    pickedIds: [],
    options: player.deck.map((entry) => entry.instanceId),
  };
  logMessage(state, `Ciphermaniac's Codebreaking: choose ${count} cards from your deck.`);
}

export function resolveCiphermaniacPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "CIPHERMANIAC" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.deck.splice(index, 1)[0]!;
  pending.pickedIds.push(instanceId);
  player.deck.unshift(card);
  card.zone = Zone.Deck;
  if (pending.pickedIds.length < 2 && player.deck.some((entry) => !pending.pickedIds.includes(entry.instanceId))) {
    state.pendingAction = {
      ...pending,
      options: player.deck.filter((entry) => !pending.pickedIds.includes(entry.instanceId)).map((e) => e.instanceId),
    };
    logMessage(state, "Ciphermaniac's Codebreaking: choose another card.");
    return;
  }
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, "Ciphermaniac's Codebreaking: shuffled deck and placed cards on top.");
}

function matchesFightingGong(def: CardDefinition): boolean {
  if (isBasicEnergy(def)) {
    return def.types?.includes("Fighting") ?? def.name.toLowerCase().includes("fighting");
  }
  return isBasicPokemon(def) && (def.types?.includes("Fighting") ?? false);
}

export function applyFightingGong(state: EngineState, playerId: PlayerId): void {
  const matches = deckMatching(state, playerId, matchesFightingGong);
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Fighting Gong: no matching cards in deck.");
    return;
  }
  if (matches.length === 1) {
    addFromDeckToHand(state, playerId, matches[0]!.instanceId, "Fighting Gong", "revealed");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "FIGHTING_GONG",
    playerId,
    options: matches.map((entry) => entry.instanceId),
  };
  logMessage(state, "Fighting Gong: choose a Basic Fighting Energy or Basic Fighting Pokémon.");
}

export function applyColressTenacity(state: EngineState, playerId: PlayerId): void {
  const stadiums = deckMatching(state, playerId, isStadium);
  const energies = deckMatching(state, playerId, isEnergyCard);
  if (stadiums.length === 0 && energies.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Colress's Tenacity: no Stadium or Energy in deck.");
    return;
  }
  if (stadiums.length === 0) {
    addFromDeckToHand(state, playerId, energies[0]!.instanceId, "Colress's Tenacity", "revealed");
    shufflePlayerDeck(state, playerId);
    return;
  }
  if (stadiums.length === 1) {
    addFromDeckToHand(state, playerId, stadiums[0]!.instanceId, "Colress's Tenacity", "revealed");
    startColressEnergyStep(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "COLRESS",
    playerId,
    step: "STADIUM",
    options: stadiums.map((entry) => entry.instanceId),
  };
  logMessage(state, "Colress's Tenacity: choose a Stadium from your deck.");
}

function startColressEnergyStep(state: EngineState, playerId: PlayerId): void {
  const energies = deckMatching(state, playerId, isEnergyCard);
  if (energies.length === 0) {
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }
  if (energies.length === 1) {
    addFromDeckToHand(state, playerId, energies[0]!.instanceId, "Colress's Tenacity", "revealed");
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }
  state.pendingAction = {
    type: "COLRESS",
    playerId,
    step: "ENERGY",
    options: energies.map((entry) => entry.instanceId),
  };
  logMessage(state, "Colress's Tenacity: choose an Energy from your deck.");
}

export function resolveColressPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "COLRESS" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  addFromDeckToHand(state, playerId, instanceId, "Colress's Tenacity", "revealed");
  if (pending.step === "STADIUM") startColressEnergyStep(state, playerId);
  else {
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
  }
}

export function applyGiovanni(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const options = player.bench.filter((pokemon) =>
    isTeamRocketPokemon(getDefinitionSafe(state, pokemon.definitionId)),
  );
  if (options.length === 0) {
    logMessage(state, "Team Rocket's Giovanni: no benched Team Rocket's Pokémon.");
    return;
  }
  if (options.length === 1) {
    resolveGiovanniOwnBench(state, playerId, options[0]!.instanceId);
    return;
  }
  state.pendingAction = {
    type: "GIOVANNI",
    playerId,
    step: "OWN_BENCH",
    options: options.map((entry) => entry.instanceId),
  };
  logMessage(state, "Giovanni: choose your benched Team Rocket's Pokémon to switch with Active.");
}

export function resolveGiovanniOwnBench(state: EngineState, playerId: PlayerId, benchId: string): void {
  const pending = state.pendingAction;
  if (pending?.type === "GIOVANNI" && pending.playerId === playerId && pending.step !== "OWN_BENCH") {
    return;
  }

  const player = getPlayer(state, playerId);
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === benchId);
  if (benchIndex === -1 || !player.active) return;
  const incoming = player.bench.splice(benchIndex, 1)[0]!;
  const outgoing = player.active;
  outgoing.zone = Zone.Bench;
  player.bench.push(outgoing);
  incoming.zone = Zone.Active;
  player.active = incoming;

  const opponent = getPlayer(state, getOpponentId(playerId));
  if (opponent.bench.length === 0) {
    state.pendingAction = null;
    logMessage(state, "Giovanni: opponent has no Benched Pokémon to switch in.");
    return;
  }
  if (opponent.bench.length === 1) {
    resolveGiovanniOpponentBench(state, playerId, opponent.bench[0]!.instanceId);
    return;
  }
  state.pendingAction = {
    type: "GIOVANNI",
    playerId,
    step: "OPPONENT_BENCH",
    ownBenchId: benchId,
    options: opponent.bench.map((entry) => entry.instanceId),
  };
  logMessage(state, "Giovanni: choose an opponent's Benched Pokémon to become Active.");
}

export function resolveGiovanniOpponentBench(
  state: EngineState,
  playerId: PlayerId,
  benchId: string,
): void {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const benchIndex = opponent.bench.findIndex((entry) => entry.instanceId === benchId);
  if (benchIndex === -1 || !opponent.active) return;
  const incoming = opponent.bench.splice(benchIndex, 1)[0]!;
  const outgoing = opponent.active;
  outgoing.zone = Zone.Bench;
  opponent.bench.push(outgoing);
  incoming.zone = Zone.Active;
  opponent.active = incoming;
  state.pendingAction = null;
  logMessage(state, "Team Rocket's Giovanni: both Active Pokémon were switched.");
}

export function applyNsPpUp(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const energies = player.discard.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isBasicEnergy(def);
  });
  const targets = player.bench.filter((pokemon) =>
    isNsPokemon(getDefinitionSafe(state, pokemon.definitionId)),
  );
  if (energies.length === 0 || targets.length === 0) {
    logMessage(state, "N's PP Up: requires Basic Energy in discard and N's Pokémon on Bench.");
    return;
  }
  if (energies.length === 1 && targets.length === 1) {
    const energy = energies[0]!;
    const idx = player.discard.indexOf(energy);
    player.discard.splice(idx, 1);
    attachEnergyToPokemon(state, playerId, energy, targets[0]!);
    return;
  }
  state.pendingAction = {
    type: "N_PP_UP",
    playerId,
    step: "ENERGY",
    options: energies.map((entry) => entry.instanceId),
  };
  logMessage(state, "N's PP Up: choose Basic Energy from your discard pile.");
}

export function resolveNsPpUpEnergy(state: EngineState, playerId: PlayerId, energyId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "N_PP_UP" || pending.playerId !== playerId || pending.step !== "ENERGY") return;
  const player = getPlayer(state, playerId);
  const targets = player.bench.filter((pokemon) =>
    isNsPokemon(getDefinitionSafe(state, pokemon.definitionId)),
  );
  if (targets.length === 1) {
    const index = player.discard.findIndex((card) => card.instanceId === energyId);
    if (index === -1) return;
    const energy = player.discard.splice(index, 1)[0]!;
    attachEnergyToPokemon(state, playerId, energy, targets[0]!);
    state.pendingAction = null;
    return;
  }
  state.pendingAction = {
    type: "N_PP_UP",
    playerId,
    step: "TARGET",
    energyId,
    options: targets.map((entry) => entry.instanceId),
  };
  logMessage(state, "N's PP Up: choose an N's Pokémon on your Bench.");
}

export function resolveNsPpUpTarget(state: EngineState, playerId: PlayerId, pokemonId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "N_PP_UP" || pending.playerId !== playerId || pending.step !== "TARGET") return;
  const player = getPlayer(state, playerId);
  const target = player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!target || !pending.energyId) return;
  const index = player.discard.findIndex((card) => card.instanceId === pending.energyId);
  if (index === -1) return;
  const energy = player.discard.splice(index, 1)[0]!;
  attachEnergyToPokemon(state, playerId, energy, target);
  state.pendingAction = null;
}

export function applyToolScrapper(state: EngineState, playerId: PlayerId): void {
  const tools = listAllAttachedTools(state);
  if (tools.length === 0) {
    logMessage(state, "Tool Scrapper: no Pokémon Tools in play.");
    return;
  }
  if (tools.length === 1) {
    discardAttachedTool(state, tools[0]!.tool.instanceId);
    return;
  }
  state.pendingAction = {
    type: "TOOL_SCRAPPER",
    playerId,
    discardRemaining: 2,
    options: tools.map((entry) => entry.tool.instanceId),
  };
  logMessage(state, "Tool Scrapper: choose up to 2 Pokémon Tools to discard.");
}

export function continueToolScrapperPick(
  state: EngineState,
  playerId: PlayerId,
  toolInstanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "TOOL_SCRAPPER" || pending.playerId !== playerId) return;
  if (!pending.options.includes(toolInstanceId)) return;
  if (!discardAttachedTool(state, toolInstanceId)) return;

  const remaining = pending.discardRemaining - 1;
  const stillAttached = listAllAttachedTools(state).map((entry) => entry.tool.instanceId);
  const nextOptions = pending.options.filter((id) => stillAttached.includes(id));

  if (remaining <= 0 || nextOptions.length === 0) {
    state.pendingAction = null;
    return;
  }

  state.pendingAction = {
    type: "TOOL_SCRAPPER",
    playerId,
    discardRemaining: remaining,
    options: nextOptions,
  };
}

export function canPlayTrainerMetaKind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  switch (kind) {
    case "trainer_archer":
      if (!state.teamRocketKnockedOutSinceMyLastTurn[playerId]) {
        return {
          ok: false,
          reason: "Team Rocket's Archer: none of your Team Rocket's Pokémon were Knocked Out last turn.",
        };
      }
      return { ok: true };
    case "trainer_giovanni": {
      const player = getPlayer(state, playerId);
      if (!player.active || !isTeamRocketPokemon(getDefinitionSafe(state, player.active.definitionId))) {
        return { ok: false, reason: "Giovanni: your Active must be a Team Rocket's Pokémon." };
      }
      if (!player.bench.some((p) => isTeamRocketPokemon(getDefinitionSafe(state, p.definitionId)))) {
        return { ok: false, reason: "Giovanni: you need a benched Team Rocket's Pokémon." };
      }
      const opponent = getPlayer(state, getOpponentId(playerId));
      if (opponent.bench.length === 0) {
        return { ok: false, reason: "Giovanni: opponent has no Benched Pokémon." };
      }
      return { ok: true };
    }
    case "trainer_dawn":
      if (
        deckMatching(state, playerId, isBasicPokemon).length === 0 &&
        deckMatching(state, playerId, isStage1).length === 0 &&
        deckMatching(state, playerId, isStage2).length === 0
      ) {
        return { ok: false, reason: "Dawn: no evolution line cards found in your deck." };
      }
      return { ok: true };
    case "trainer_proton":
      if (deckMatching(state, playerId, (d) => isBasicPokemon(d) && isTeamRocketPokemon(d)).length === 0) {
        return { ok: false, reason: "Proton: no Basic Team Rocket's Pokémon in deck." };
      }
      return { ok: true };
    case "trainer_petrel":
      if (deckMatching(state, playerId, (d) => d.supertype === "Trainer").length === 0) {
        return { ok: false, reason: "Petrel: no Trainer cards in deck." };
      }
      return { ok: true };
    case "trainer_cyrano":
      if (deckMatching(state, playerId, isPokemonEx).length === 0) {
        return { ok: false, reason: "Cyrano: no Pokémon ex in deck." };
      }
      return { ok: true };
    case "trainer_ciphermaniac":
      if (getPlayer(state, playerId).deck.length === 0) {
        return { ok: false, reason: "Ciphermaniac: your deck is empty." };
      }
      return { ok: true };
    case "trainer_fighting_gong":
      if (deckMatching(state, playerId, matchesFightingGong).length === 0) {
        return { ok: false, reason: "Fighting Gong: no matching cards in deck." };
      }
      return { ok: true };
    case "trainer_colress_tenacity":
      if (
        deckMatching(state, playerId, isStadium).length === 0 &&
        deckMatching(state, playerId, isEnergyCard).length === 0
      ) {
        return { ok: false, reason: "Colress's Tenacity: no Stadium or Energy in deck." };
      }
      return { ok: true };
    case "trainer_ns_pp_up": {
      const player = getPlayer(state, playerId);
      const hasEnergy = player.discard.some((c) => isBasicEnergy(getDefinitionSafe(state, c.definitionId)));
      const hasTarget = player.bench.some((p) => isNsPokemon(getDefinitionSafe(state, p.definitionId)));
      if (!hasEnergy || !hasTarget) {
        return { ok: false, reason: "N's PP Up: need Basic Energy in discard and N's Pokémon on Bench." };
      }
      return { ok: true };
    }
    case "trainer_tool_scrapper":
      if (listAllAttachedTools(state).length === 0) {
        return { ok: false, reason: "Tool Scrapper: no Pokémon Tools in play." };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function applyTrainerMetaKind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  switch (effect.kind) {
    case "trainer_dawn":
      applyDawn(state, playerId);
      return;
    case "trainer_ariana":
      applyAriana(state, playerId);
      return;
    case "trainer_archer":
      applyArcher(state, playerId);
      return;
    case "trainer_giovanni":
      applyGiovanni(state, playerId);
      return;
    case "trainer_proton":
      applyProton(state, playerId, effect.count);
      return;
    case "trainer_petrel":
      applyPetrel(state, playerId);
      return;
    case "trainer_cyrano":
      applyCyrano(state, playerId, effect.count);
      return;
    case "trainer_ciphermaniac":
      applyCiphermaniac(state, playerId, effect.count);
      return;
    case "trainer_fighting_gong":
      applyFightingGong(state, playerId);
      return;
    case "trainer_colress_tenacity":
      applyColressTenacity(state, playerId);
      return;
    case "trainer_ns_pp_up":
      applyNsPpUp(state, playerId);
      return;
    case "trainer_tool_scrapper":
      applyToolScrapper(state, playerId);
      return;
    default:
      return;
  }
}

type SearchHandFilter = Extract<PendingAction, { type: "SEARCH_DECK" }>["filter"];

function deckFilterPredicate(
  filter: SearchHandFilter,
  def: CardDefinition,
  meta?: { typeFilter?: string; maxHp?: number; nameFilter?: string },
): boolean {
  switch (filter) {
    case "TEAM_ROCKET_BASIC_HAND":
      return isBasicPokemon(def) && isTeamRocketPokemon(def);
    case "POKEMON_EX_HAND":
      return isPokemonEx(def);
    case "ANY_TRAINER_HAND":
      return def.supertype === "Trainer";
    case "TEAM_ROCKET_SUPPORTER_HAND":
      return isSupporter(def) && def.name.toLowerCase().includes("team rocket");
    case "FIGHTING_GONG":
      return matchesFightingGong(def);
    case "TOOL_HAND":
      return isTool(def);
    case "TYPED_POKEMON_MAX_HP_HAND": {
      if (def.supertype !== "Pokémon") return false;
      const typeFilter = meta?.typeFilter ?? "Colorless";
      const maxHp = meta?.maxHp ?? 100;
      if (typeFilter === "Colorless" && !isColorlessPokemon(def)) return false;
      else if (!(def.types?.some((t) => t.toLowerCase() === typeFilter.toLowerCase()) ?? false)) return false;
      return getHp(def) <= maxHp;
    }
    case "NAMED_POKEMON_BENCH": {
      if (def.supertype !== "Pokémon") return false;
      const nameFilter = meta?.nameFilter?.toLowerCase();
      return !nameFilter || def.name.toLowerCase().includes(nameFilter);
    }
    default:
      return false;
  }
}

export function continueMultiPickDeckToHand(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  filter: SearchHandFilter,
): void {
  const pending = state.pendingAction;
  if (pending?.type === "SEARCH_DECK" && pending.filter === filter && (pending.slotsRemaining ?? 1) > 1) {
    const meta = pending.searchMeta;
    const remaining = deckMatching(state, playerId, (def) => deckFilterPredicate(filter, def, meta)).filter(
      (entry) => entry.instanceId !== instanceId,
    );
    if (remaining.length > 0) {
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId,
        filter,
        options: remaining.map((entry) => entry.instanceId),
        slotsRemaining: (pending.slotsRemaining ?? 1) - 1,
        searchMeta: pending.searchMeta,
      };
      return;
    }
  }
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
}

export function resolveMultiPickDeckToHand(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  filter: SearchHandFilter,
): boolean {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return false;
  const card = player.deck.splice(index, 1)[0]!;
  const def = getDefinitionSafe(state, card.definitionId);
  card.zone = Zone.Hand;
  player.hand.push(card);
  logMessage(state, `${player.name} added ${def.name} to their hand.`);
  continueMultiPickDeckToHand(state, playerId, instanceId, filter);
  return true;
}

export function resolveFightingGongPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "FIGHTING_GONG" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  addFromDeckToHand(state, playerId, instanceId, "Fighting Gong", "revealed");
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
}
