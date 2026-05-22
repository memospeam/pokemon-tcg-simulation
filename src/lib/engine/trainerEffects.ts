import {
  getHp,
  isBasicEnergy,
  isBasicPokemon,
  isPokemonWithoutRuleBox,
  isStage2,
} from "../models/definition";
import type { CardDefinition } from "../models/definition";
import type { CardInstance } from "../models/instance";
import { PlayerId, Zone } from "../models/enums";
import {
  applyJudgeEffect,
  canRareCandyEvolveInto,
  drawCards,
  getDefinitionSafe,
} from "./rules";
import { flipCoin, logMessage } from "./helpers";
import { createRng } from "./rng";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  moveToDiscard,
  type EngineState,
  type PendingAction,
} from "./types";

function shuffleDeck(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  state.rngSeed += 1;
  const rng = createRng(state.rngSeed + player.deck.length);
  player.deck = rng.shuffle(player.deck);
}

function matchName(def: CardDefinition, pattern: string): boolean {
  return def.name.toLowerCase().includes(pattern);
}

function deckPokemonMatching(
  state: EngineState,
  playerId: PlayerId,
  predicate: (def: CardDefinition) => boolean,
): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def?.supertype === "Pokémon" && predicate(def);
  });
}

function setSearchPending(
  state: EngineState,
  playerId: PlayerId,
  filter: Extract<PendingAction, { type: "SEARCH_DECK" }>["filter"],
  options: CardInstance[],
): void {
  if (options.length === 0) {
    logMessage(state, "No matching cards found in deck.");
    return;
  }
  if (options.length === 1) {
    resolveDeckPick(state, playerId, options[0]!.instanceId, filter);
    return;
  }
  state.pendingAction = { type: "SEARCH_DECK", playerId, filter, options: options.map((c) => c.instanceId) };
  logMessage(state, `Choose a card from your deck (${options.length} found).`);
}

export function resolveDeckPick(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  filter: Extract<PendingAction, { type: "SEARCH_DECK" }>["filter"],
): void {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;

  const card = player.deck.splice(index, 1)[0]!;
  const def = getDefinitionSafe(state, card.definitionId);

  if (filter === "POFFIN") {
    if (player.bench.length >= 5) {
      player.deck.unshift(card);
      logMessage(state, "Bench is full — cannot place more Pokémon from Buddy-Buddy Poffin.");
      shuffleDeck(state, playerId);
      state.pendingAction = null;
      return;
    }
    card.zone = Zone.Bench;
    card.ownerId = playerId;
    card.enteredPlayTurn = state.turnNumber;
    player.bench.push(card);
    logMessage(state, `${player.name} placed ${def.name} on the Bench with Buddy-Buddy Poffin.`);

    const pending = state.pendingAction;
    if (pending?.type === "SEARCH_DECK" && pending.filter === "POFFIN" && (pending.slotsRemaining ?? 1) > 1) {
      const remaining = deckPokemonMatching(
        state,
        playerId,
        (entry) => isBasicPokemon(entry) && getHp(entry) <= 70,
      );
      if (remaining.length > 0 && player.bench.length < 5) {
        state.pendingAction = {
          type: "SEARCH_DECK",
          playerId,
          filter: "POFFIN",
          options: remaining.map((entry) => entry.instanceId),
          slotsRemaining: (pending.slotsRemaining ?? 1) - 1,
        };
        logMessage(state, "Choose another Pokémon for Buddy-Buddy Poffin (optional).");
        return;
      }
    }
    shuffleDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "BASIC_BENCH") {
    if (player.bench.length >= 5) {
      player.deck.unshift(card);
      logMessage(state, "Bench is full — cannot place more Pokémon.");
      shuffleDeck(state, playerId);
      state.pendingAction = null;
      return;
    }
    card.zone = Zone.Bench;
    card.ownerId = playerId;
    card.enteredPlayTurn = state.turnNumber;
    player.bench.push(card);
    logMessage(state, `${player.name} placed ${def.name} on the Bench.`);

    const pending = state.pendingAction;
    if (
      pending?.type === "SEARCH_DECK" &&
      pending.filter === "BASIC_BENCH" &&
      (pending.slotsRemaining ?? 1) > 1
    ) {
      const remaining = deckPokemonMatching(state, playerId, isBasicPokemon);
      if (remaining.length > 0 && player.bench.length < 5) {
        state.pendingAction = {
          type: "SEARCH_DECK",
          playerId,
          filter: "BASIC_BENCH",
          options: remaining.map((entry) => entry.instanceId),
          slotsRemaining: (pending.slotsRemaining ?? 1) - 1,
        };
        logMessage(state, "Choose another Basic Pokémon for your Bench (optional).");
        return;
      }
    }
    shuffleDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "BASIC_ENERGY_HAND") {
    card.zone = Zone.Hand;
    player.hand.push(card);
    logMessage(state, `${player.name} added ${def.name} to their hand.`);

    const pending = state.pendingAction;
    if (
      pending?.type === "SEARCH_DECK" &&
      pending.filter === "BASIC_ENERGY_HAND" &&
      (pending.slotsRemaining ?? 1) > 1
    ) {
      const remaining = player.deck.filter((entry) => {
        const entryDef = getDefinition(state, entry.definitionId);
        return entryDef && isBasicEnergy(entryDef);
      });
      const pickedIds = [...(pending.options.includes(instanceId) ? [instanceId] : []), instanceId];
      const stillAvailable = remaining.filter((entry) => !pickedIds.includes(entry.instanceId));
      if (stillAvailable.length > 0) {
        state.pendingAction = {
          type: "SEARCH_DECK",
          playerId,
          filter: "BASIC_ENERGY_HAND",
          options: stillAvailable.map((entry) => entry.instanceId),
          slotsRemaining: (pending.slotsRemaining ?? 1) - 1,
        };
        logMessage(state, "Choose another Basic Energy (optional).");
        return;
      }
    }
    shuffleDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "SUPPORTER_HAND") {
    card.zone = Zone.Hand;
    player.hand.push(card);
    logMessage(state, `${player.name} added ${def.name} to their hand.`);
    shuffleDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  card.zone = Zone.Hand;
  player.hand.push(card);
  shuffleDeck(state, playerId);
  logMessage(state, `${player.name} added ${def.name} to their hand.`);
  state.pendingAction = null;
}

export function applyTrainerEffect(
  state: EngineState,
  playerId: PlayerId,
  def: CardDefinition,
): void {
  const player = getPlayer(state, playerId);

  if (matchName(def, "lillie")) {
    const returned = [...player.hand];
    player.hand = [];
    for (const card of returned) {
      card.zone = Zone.Deck;
      player.deck.push(card);
    }
    shuffleDeck(state, playerId);
    const drawCount = player.prizes.length === 6 ? 8 : 6;
    drawCards(state, playerId, drawCount);
    logMessage(
      state,
      `${player.name} shuffled their hand into their deck and drew ${drawCount} cards (Lillie's Determination).`,
    );
    return;
  }

  if (matchName(def, "judge")) {
    applyJudgeEffect(state);
    return;
  }

  if (matchName(def, "boss")) {
    state.pendingAction = { type: "BOSS_ORDERS", playerId };
    logMessage(state, `${player.name} played Boss's Orders — choose an opponent's Benched Pokémon.`);
    return;
  }

  if (matchName(def, "ultra ball")) {
    if (player.hand.length < 2) {
      logMessage(state, "Ultra Ball requires discarding 2 cards — not enough cards in hand.");
      return;
    }
    state.pendingAction = { type: "ULTRA_BALL_DISCARD", playerId, selectedIds: [] };
    logMessage(state, "Ultra Ball: choose 2 cards from your hand to discard.");
    return;
  }

  if (matchName(def, "poké pad") || matchName(def, "poke pad")) {
    const matches = deckPokemonMatching(state, playerId, isPokemonWithoutRuleBox);
    setSearchPending(state, playerId, "POKEMON_NO_RULE_BOX", matches);
    return;
  }

  if (matchName(def, "poffin")) {
    const matches = deckPokemonMatching(
      state,
      playerId,
      (entry) => isBasicPokemon(entry) && getHp(entry) <= 70,
    );
    if (matches.length === 0) {
      shuffleDeck(state, playerId);
      logMessage(state, "No Basic Pokémon with 70 HP or less found in deck.");
      return;
    }
    state.pendingAction = {
      type: "SEARCH_DECK",
      playerId,
      filter: "POFFIN",
      options: matches.map((entry) => entry.instanceId),
      slotsRemaining: 2,
    };
    logMessage(state, "Buddy-Buddy Poffin: choose up to 2 Basic Pokémon (70 HP or less) for your Bench.");
    return;
  }

  if (matchName(def, "night stretcher")) {
    const options = player.discard.filter((card) => {
      const cardDef = getDefinition(state, card.definitionId);
      return cardDef?.supertype === "Pokémon";
    });
    if (options.length === 0) {
      logMessage(state, "No Pokémon in discard pile.");
      return;
    }
    if (options.length === 1) {
      const card = options[0]!;
      const idx = player.discard.indexOf(card);
      player.discard.splice(idx, 1);
      card.zone = Zone.Hand;
      player.hand.push(card);
      logMessage(
        state,
        `${player.name} put ${getDefinitionSafe(state, card.definitionId).name} from discard into their hand.`,
      );
      return;
    }
    state.pendingAction = {
      type: "PICK_DISCARD",
      playerId,
      options: options.map((entry) => entry.instanceId),
    };
    logMessage(state, "Night Stretcher: choose a Pokémon from your discard pile.");
    return;
  }

  if (matchName(def, "crushing hammer")) {
    const heads = flipCoin(state);
    if (!heads) {
      logMessage(state, "Crushing Hammer: tails — no effect.");
      return;
    }
    const opponent = getPlayer(state, getOpponentId(playerId));
    const targets: { pokemonId: string; energyId: string }[] = [];
    for (const pokemon of allPokemonInPlay(opponent)) {
      for (const energy of pokemon.attachedEnergy) {
        targets.push({ pokemonId: pokemon.instanceId, energyId: energy.instanceId });
      }
    }
    if (targets.length === 0) {
      logMessage(state, "Crushing Hammer: heads, but opponent has no Energy attached.");
      return;
    }
    if (targets.length === 1) {
      discardAttachedEnergy(state, getOpponentId(playerId), targets[0]!.pokemonId, targets[0]!.energyId);
      return;
    }
    state.pendingAction = { type: "CRUSHING_HAMMER", playerId, options: targets };
    logMessage(state, "Crushing Hammer: heads — choose an Energy to discard.");
    return;
  }

  if (matchName(def, "rare candy")) {
    if (state.turnNumber === 1 && state.currentPlayerId === state.firstPlayerId) {
      logMessage(state, "Rare Candy cannot be used on your first turn.");
      return;
    }
    const eligible = allPokemonInPlay(player).filter(
      (pokemon) =>
        isBasicPokemon(getDefinitionSafe(state, pokemon.definitionId)) &&
        pokemon.enteredPlayTurn !== state.turnNumber,
    );
    if (eligible.length === 0) {
      logMessage(state, "No eligible Basic Pokémon in play for Rare Candy.");
      return;
    }
    state.pendingAction = { type: "RARE_CANDY", playerId };
    logMessage(state, "Rare Candy: choose a Basic Pokémon in play to evolve.");
    return;
  }

  if (matchName(def, "unfair stamp")) {
    if (state.turnNumber <= 1) {
      logMessage(state, "Unfair Stamp cannot be used on the first turn.");
      return;
    }
    const opponent = getPlayer(state, getOpponentId(playerId));
    if (opponent.prizes.length > 3) {
      logMessage(state, "Unfair Stamp: opponent has more than 3 Prize cards remaining.");
      return;
    }
    const returned = [...opponent.hand];
    opponent.hand = [];
    for (const card of returned) {
      card.zone = Zone.Deck;
      opponent.deck.push(card);
    }
    shuffleDeck(state, getOpponentId(playerId));
    drawCards(state, getOpponentId(playerId), 4);
    logMessage(state, `${opponent.name}'s hand was shuffled into their deck and they drew 4 cards (Unfair Stamp).`);
    return;
  }

  if (matchName(def, "crispin")) {
    applyCrispin(state, playerId);
    return;
  }

  if (matchName(def, "professor")) {
    const returned = [...player.hand];
    player.hand = [];
    for (const card of returned) {
      card.zone = Zone.Deck;
      player.deck.push(card);
    }
    shuffleDeck(state, playerId);
    drawCards(state, playerId, 7);
    return;
  }
}

function applyCrispin(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const energyIndex = player.deck.findIndex((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isBasicEnergy(def);
  });

  if (energyIndex === -1) {
    shuffleDeck(state, playerId);
    logMessage(state, "Crispin: no Basic Energy found in deck.");
    maybeCrispinOptionalDiscard(state, playerId);
    return;
  }

  const energy = player.deck.splice(energyIndex, 1)[0]!;
  const basics = allPokemonInPlay(player).filter((pokemon) =>
    isBasicPokemon(getDefinitionSafe(state, pokemon.definitionId)),
  );

  if (basics.length === 0) {
    energy.zone = Zone.Deck;
    player.deck.push(energy);
    shuffleDeck(state, playerId);
    logMessage(state, "Crispin: no Basic Pokémon in play to attach Energy.");
    maybeCrispinOptionalDiscard(state, playerId);
    return;
  }

  if (basics.length === 1) {
    attachEnergyToPokemon(state, playerId, energy, basics[0]!);
    shuffleDeck(state, playerId);
    maybeCrispinOptionalDiscard(state, playerId);
    return;
  }

  state.pendingAction = { type: "CRISPIN_ATTACH", playerId, energyId: energy.instanceId, targets: basics.map((b) => b.instanceId) };
  state.heldCard = energy;
  logMessage(state, "Crispin: choose a Basic Pokémon to attach the searched Energy.");
}

export function maybeCrispinOptionalDiscard(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  if (player.hand.length === 0) return;
  state.pendingAction = { type: "CRISPIN_DISCARD", playerId };
  logMessage(state, "Crispin: you may discard 1 card to draw 2 (optional).");
}

export function attachEnergyToPokemon(
  state: EngineState,
  playerId: PlayerId,
  energy: CardInstance,
  target: CardInstance,
): void {
  const player = getPlayer(state, playerId);
  const energyDef = getDefinitionSafe(state, energy.definitionId);
  energy.zone = Zone.Active;
  target.attachedEnergy.push(energy);
  logMessage(state, `${player.name} attached ${energyDef.name} to ${getDefinitionSafe(state, target.definitionId).name}.`);
}

export function discardAttachedEnergy(
  state: EngineState,
  ownerId: PlayerId,
  pokemonId: string,
  energyId: string,
  clearPending = true,
): void {
  const player = getPlayer(state, ownerId);
  const pokemon =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon) return;

  const index = pokemon.attachedEnergy.findIndex((entry) => entry.instanceId === energyId);
  if (index === -1) return;
  const energy = pokemon.attachedEnergy.splice(index, 1)[0]!;
  moveToDiscard(player, energy);
  logMessage(
    state,
    `${getDefinitionSafe(state, energy.definitionId).name} was discarded from ${getDefinitionSafe(state, pokemon.definitionId).name}.`,
  );
  if (clearPending) state.pendingAction = null;
}

export function applyRiskyRuinsDamage(state: EngineState, pokemon: CardInstance): void {
  if (!state.stadium) return;
  const stadiumDef = getDefinition(state, state.stadium.definitionId);
  if (!stadiumDef?.name.toLowerCase().includes("risky ruins")) return;
  pokemon.damageCounters += 10;
  logMessage(
    state,
    `${getDefinitionSafe(state, pokemon.definitionId).name} took 10 damage from Risky Ruins.`,
  );
}

export function completeUltraBallDiscard(state: EngineState, playerId: PlayerId): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ULTRA_BALL_DISCARD" || pending.selectedIds.length < 2) return;

  const player = getPlayer(state, playerId);
  for (const id of pending.selectedIds) {
    const index = player.hand.findIndex((entry) => entry.instanceId === id);
    if (index === -1) continue;
    const card = player.hand.splice(index, 1)[0]!;
    moveToDiscard(player, card);
  }

  const matches = player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def?.supertype === "Pokémon";
  });

  if (matches.length === 0) {
    shuffleDeck(state, playerId);
    logMessage(state, "Ultra Ball: no Pokémon found in deck.");
    state.pendingAction = null;
    return;
  }

  if (matches.length === 1) {
    resolveDeckPick(state, playerId, matches[0]!.instanceId, "ANY_POKEMON");
    return;
  }

  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "ANY_POKEMON",
    options: matches.map((entry) => entry.instanceId),
  };
  logMessage(state, "Ultra Ball: choose a Pokémon from your deck.");
}

export function applyRareCandy(
  state: EngineState,
  playerId: PlayerId,
  basicTargetId: string,
): void {
  const player = getPlayer(state, playerId);
  const basic =
    player.active?.instanceId === basicTargetId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === basicTargetId);
  if (!basic) return;

  const basicDef = getDefinitionSafe(state, basic.definitionId);
  if (!isBasicPokemon(basicDef) || basic.enteredPlayTurn === state.turnNumber) {
    logMessage(state, "That Basic Pokémon cannot be evolved with Rare Candy this turn.");
    state.pendingAction = null;
    return;
  }

  const evolution = findRareCandyEvolution(state, playerId, basic);
  if (!evolution) {
    logMessage(state, "No matching Stage 2 card in hand for Rare Candy.");
    state.pendingAction = null;
    return;
  }

  const evoIndex = player.hand.findIndex((entry) => entry.instanceId === evolution.instanceId);
  if (evoIndex === -1) return;
  const evoCard = player.hand.splice(evoIndex, 1)[0]!;
  const evoDef = getDefinitionSafe(state, evoCard.definitionId);

  evoCard.attachedEnergy = [...basic.attachedEnergy];
  evoCard.damageCounters = basic.damageCounters;
  evoCard.enteredPlayTurn = basic.enteredPlayTurn;
  evoCard.zone = basic.zone;
  evoCard.ownerId = playerId;

  if (player.active?.instanceId === basicTargetId) {
    player.active = evoCard;
  } else {
    const benchIndex = player.bench.findIndex((entry) => entry.instanceId === basicTargetId);
    if (benchIndex >= 0) player.bench[benchIndex] = evoCard;
  }

  logMessage(state, `${player.name} evolved ${basicDef.name} to ${evoDef.name} with Rare Candy.`);
  state.pendingAction = null;
}

function findRareCandyEvolution(
  state: EngineState,
  playerId: PlayerId,
  basic: CardInstance,
): CardInstance | null {
  const basicDef = getDefinitionSafe(state, basic.definitionId);
  const player = getPlayer(state, playerId);
  return (
    player.hand.find((card) => {
      const evoDef = getDefinition(state, card.definitionId);
      return evoDef && isStage2(evoDef) && canRareCandyEvolveInto(state, basicDef, evoDef);
    }) ?? null
  );
}
