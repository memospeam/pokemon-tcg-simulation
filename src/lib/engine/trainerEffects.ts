import {
  getHp,
  isBasicEnergy,
  isBasicPokemon,
  isEnergyCard,
  isEvolutionPokemon,
  isMegaEvolutionEx,
  isPokemonWithoutRuleBox,
  isStage2,
  isSupporter,
  isTool,
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
import { flipCoin, logMessage, shufflePlayerDeck } from "./helpers";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  moveToDiscard,
  removeFromHand,
  type EngineState,
  type PendingAction,
} from "./types";
import type { ParsedEffect } from "./effects/types";
import { applyRiskyRuinsOnBenchPlay } from "./effects/stadiumEffects";
import { transferPokemonStateOntoEvolution } from "./effects/toolEffects";
import {
  applyTrainerMetaKind,
  canPlayTrainerMetaKind,
  continueMultiPickDeckToHand,
} from "./effects/trainerMetaEffects";
import {
  applyTrainerBatch3Kind,
  canPlayTrainerBatch3Kind,
} from "./effects/trainerBatch3Effects";
import {
  applyTrainerBatch10Kind,
  canPlayTrainerBatch10Kind,
  startSalvatoreEvolve,
} from "./effects/trainerBatch10Effects";
import {
  applyTrainerBatch5Kind,
  canPlayTrainerBatch5Kind,
} from "./effects/trainerBatch5Effects";
import {
  applyTrainerBatch7Kind,
  canPlayTrainerBatch7Kind,
} from "./effects/trainerBatch7Effects";
import {
  applyTrainerBatch9Kind,
  canPlayTrainerBatch9Kind,
} from "./effects/trainerBatch9Effects";
import { resolveBasicPsychicBenchPick } from "./effects/specialEnergyEffects";
import { isTrainerKindImplemented } from "./effects/trainerCoverage";
import { parseTrainerText } from "./effects/trainerText";
import type { TrainerPlayCheck } from "./effects/trainerPlayCheck";

export type { TrainerPlayCheck } from "./effects/trainerPlayCheck";

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function matchesTrainer(def: CardDefinition, ...patterns: string[]): boolean {
  const name = normalizeName(def.name);
  return patterns.some((pattern) => name === pattern || name.includes(pattern));
}

function isEnergySwitch(def: CardDefinition): boolean {
  return matchesTrainer(def, "energy switch");
}

function isSwitchItem(def: CardDefinition): boolean {
  return matchesTrainer(def, "switch") && !isEnergySwitch(def);
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

function deckEnergyMatching(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isEnergyCard(def);
  });
}

function deckEvolutionMatching(state: EngineState, playerId: PlayerId): CardInstance[] {
  return deckPokemonMatching(state, playerId, isEvolutionPokemon);
}

function deckTrainerMatching(
  state: EngineState,
  playerId: PlayerId,
  predicate: (def: CardDefinition) => boolean,
): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def?.supertype === "Trainer" && predicate(def);
  });
}

function addSearchedCardToHand(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  label: string,
): CardInstance | null {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return null;

  const card = player.deck.splice(index, 1)[0]!;
  const def = getDefinitionSafe(state, card.definitionId);
  card.zone = Zone.Hand;
  player.hand.push(card);
  logMessage(state, `${player.name} revealed ${def.name} and put it into their hand (${label}).`);
  return card;
}

function finishHildaSearch(state: EngineState, playerId: PlayerId): void {
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, "Hilda: shuffled deck.");
}

function startHildaEnergyStep(state: EngineState, playerId: PlayerId): void {
  const energies = deckEnergyMatching(state, playerId);
  if (energies.length === 0) {
    finishHildaSearch(state, playerId);
    return;
  }
  if (energies.length === 1) {
    addSearchedCardToHand(state, playerId, energies[0]!.instanceId, "Hilda");
    finishHildaSearch(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "HILDA",
    playerId,
    step: "ENERGY",
    options: energies.map((entry) => entry.instanceId),
  };
  logMessage(state, "Hilda: choose an Energy card from your deck.");
}

export function resolveHildaPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "HILDA" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;

  addSearchedCardToHand(state, playerId, instanceId, "Hilda");

  if (pending.step === "EVOLUTION") {
    startHildaEnergyStep(state, playerId);
    return;
  }

  finishHildaSearch(state, playerId);
}

function applyHilda(state: EngineState, playerId: PlayerId): void {
  const evolutions = deckEvolutionMatching(state, playerId);
  const energies = deckEnergyMatching(state, playerId);

  if (evolutions.length === 0 && energies.length === 0) {
    finishHildaSearch(state, playerId);
    return;
  }

  if (evolutions.length === 0) {
    logMessage(state, "Hilda: no Evolution Pokémon found in deck — searching for Energy only.");
    startHildaEnergyStep(state, playerId);
    return;
  }

  if (evolutions.length === 1) {
    addSearchedCardToHand(state, playerId, evolutions[0]!.instanceId, "Hilda");
    startHildaEnergyStep(state, playerId);
    return;
  }

  state.pendingAction = {
    type: "HILDA",
    playerId,
    step: "EVOLUTION",
    options: evolutions.map((entry) => entry.instanceId),
  };
  logMessage(state, "Hilda: choose an Evolution Pokémon from your deck.");
}

function discardPokemonInPile(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.discard.filter((card) => {
    const cardDef = getDefinition(state, card.definitionId);
    return cardDef?.supertype === "Pokémon";
  });
}

function rareCandyEligibleBasics(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).filter(
    (pokemon) =>
      isBasicPokemon(getDefinitionSafe(state, pokemon.definitionId)) &&
      pokemon.enteredPlayTurn !== state.turnNumber,
  );
}

function hasRareCandyTarget(state: EngineState, playerId: PlayerId): boolean {
  return rareCandyEligibleBasics(state, playerId).some((basic) => findRareCandyEvolution(state, playerId, basic));
}

function pokemonWithBasicEnergy(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).filter((pokemon) =>
    pokemon.attachedEnergy.some((energy) => {
      const def = getDefinition(state, energy.definitionId);
      return def && isBasicEnergy(def);
    }),
  );
}

function canEnergySwitch(state: EngineState, playerId: PlayerId): boolean {
  const player = getPlayer(state, playerId);
  const inPlay = allPokemonInPlay(player);
  if (inPlay.length < 2) return false;
  return pokemonWithBasicEnergy(state, playerId).some((source) =>
    inPlay.some((target) => target.instanceId !== source.instanceId),
  );
}

function opponentEnergyTargets(state: EngineState, playerId: PlayerId): { pokemonId: string; energyId: string }[] {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const targets: { pokemonId: string; energyId: string }[] = [];
  for (const pokemon of allPokemonInPlay(opponent)) {
    for (const energy of pokemon.attachedEnergy) {
      targets.push({ pokemonId: pokemon.instanceId, energyId: energy.instanceId });
    }
  }
  return targets;
}

function opponentPokemonWithEnergy(state: EngineState, playerId: PlayerId): CardInstance[] {
  const opponent = getPlayer(state, getOpponentId(playerId));
  return allPokemonInPlay(opponent).filter((pokemon) => pokemon.attachedEnergy.length > 0);
}

function canPlayTrainerKind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));

  switch (kind) {
    case "trainer_boss_orders":
      if (opponent.bench.length === 0) {
        return { ok: false, reason: "Boss's Orders requires an opponent's Benched Pokémon." };
      }
      return { ok: true };
    case "trainer_ultra_ball":
      if (player.hand.length < 3) {
        return { ok: false, reason: "Ultra Ball requires discarding 2 cards from your hand." };
      }
      return { ok: true };
    case "trainer_rare_candy":
      if (state.turnNumber === 1 && state.currentPlayerId === state.firstPlayerId) {
        return { ok: false, reason: "Rare Candy cannot be used on your first turn." };
      }
      if (!hasRareCandyTarget(state, playerId)) {
        return {
          ok: false,
          reason: "No eligible Basic Pokémon and matching Stage 2 in hand for Rare Candy.",
        };
      }
      return { ok: true };
    case "trainer_night_stretcher":
      if (
        discardPokemonInPile(state, playerId).length === 0 &&
        !player.discard.some((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)))
      ) {
        return { ok: false, reason: "Night Stretcher requires a Pokémon or Basic Energy in your discard pile." };
      }
      return { ok: true };
    case "trainer_search_no_rule_box":
      if (deckPokemonMatching(state, playerId, isPokemonWithoutRuleBox).length === 0) {
        return { ok: false, reason: "No Pokémon without a Rule Box found in your deck." };
      }
      return { ok: true };
    case "trainer_poffin":
      if (
        deckPokemonMatching(state, playerId, (entry) => isBasicPokemon(entry) && getHp(entry) <= 70)
          .length === 0
      ) {
        return { ok: false, reason: "No Basic Pokémon with 70 HP or less found in deck." };
      }
      return { ok: true };
    case "trainer_unfair_stamp":
      if (!state.ownPokemonKnockedOutOpponentLastTurn[playerId]) {
        return { ok: false, reason: "Unfair Stamp: none of your Pokémon were Knocked Out during your opponent's last turn." };
      }
      return { ok: true };
    case "trainer_special_red_card": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      if (opponent.prizes.length > 3) {
        return { ok: false, reason: "Special Red Card: opponent must have 3 or fewer Prize cards remaining." };
      }
      return { ok: true };
    }
    case "trainer_switch_active_bench":
      if (!player.active || player.bench.length === 0) {
        return { ok: false, reason: "Switch requires an Active Pokémon and a Benched Pokémon." };
      }
      return { ok: true };
    case "trainer_energy_switch":
      if (!canEnergySwitch(state, playerId)) {
        return {
          ok: false,
          reason: "Energy Switch requires 2 Pokémon in play and Basic Energy to move.",
        };
      }
      return { ok: true };
    case "trainer_enhanced_hammer":
      if (opponentEnergyTargets(state, playerId).length === 0) {
        return { ok: false, reason: "Enhanced Hammer: opponent has no Energy attached." };
      }
      return { ok: true };
    case "trainer_hilda":
      if (
        deckEvolutionMatching(state, playerId).length === 0 &&
        deckEnergyMatching(state, playerId).length === 0
      ) {
        return {
          ok: false,
          reason: "Hilda: no Evolution Pokémon or Energy cards found in your deck.",
        };
      }
      return { ok: true };
    case "trainer_pokegear": {
      const pokegearCheck = canPlayTrainerBatch5Kind(state, playerId, "trainer_pokegear");
      if (!pokegearCheck.ok) return pokegearCheck;
      return { ok: true };
    }
    case "trainer_wallys_compassion": {
      const megaTarget = allPokemonInPlay(player).some((mon) => {
        const monDef = getDefinitionSafe(state, mon.definitionId);
        return isMegaEvolutionEx(monDef);
      });
      if (!megaTarget) {
        return { ok: false, reason: "Wally's Compassion requires a Mega Evolution Pokémon ex in play." };
      }
      return { ok: true };
    }
    default: {
      const batch10Check = canPlayTrainerBatch10Kind(state, playerId, kind);
      if (!batch10Check.ok) return batch10Check;
      const batch9Check = canPlayTrainerBatch9Kind(state, playerId, kind);
      if (!batch9Check.ok) return batch9Check;
      const batch7Check = canPlayTrainerBatch7Kind(state, playerId, kind);
      if (!batch7Check.ok) return batch7Check;
      const batch5Check = canPlayTrainerBatch5Kind(state, playerId, kind);
      if (!batch5Check.ok) return batch5Check;
      const batch3Check = canPlayTrainerBatch3Kind(state, playerId, kind);
      if (!batch3Check.ok) return batch3Check;
      const metaCheck = canPlayTrainerMetaKind(state, playerId, kind);
      if (!metaCheck.ok) return metaCheck;
      return { ok: true };
    }
  }
}

function applyTrainerByKind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  const player = getPlayer(state, playerId);

  switch (effect.kind) {
    case "trainer_shuffle_hand_draw": {
      const returned = [...player.hand];
      player.hand = [];
      for (const card of returned) {
        card.zone = Zone.Deck;
        player.deck.push(card);
      }
      shufflePlayerDeck(state, playerId);
      const drawCount =
        effect.sixPrizeDraw !== undefined && player.prizes.length === 6
          ? effect.sixPrizeDraw
          : effect.baseDraw;
      drawCards(state, playerId, drawCount);
      logMessage(
        state,
        `${player.name} shuffled their hand into their deck and drew ${drawCount} cards.`,
      );
      return;
    }
    case "trainer_discard_hand_draw": {
      const returned = [...player.hand];
      player.hand = [];
      for (const card of returned) {
        card.zone = Zone.Deck;
        player.deck.push(card);
      }
      shufflePlayerDeck(state, playerId);
      drawCards(state, playerId, effect.drawCount);
      logMessage(
        state,
        `${player.name} discarded their hand and drew ${effect.drawCount} cards.`,
      );
      return;
    }
    case "trainer_judge":
      applyJudgeEffect(state);
      return;
    case "trainer_iono":
      applyIono(state, playerId);
      return;
    case "trainer_boss_orders":
      state.pendingAction = { type: "BOSS_ORDERS", playerId };
      logMessage(state, `${player.name} played Boss's Orders — choose an opponent's Benched Pokémon.`);
      return;
    case "trainer_ultra_ball":
      state.pendingAction = { type: "ULTRA_BALL_DISCARD", playerId, selectedIds: [] };
      logMessage(state, "Ultra Ball: choose 2 cards from your hand to discard.");
      return;
    case "trainer_search_no_rule_box": {
      const matches = deckPokemonMatching(state, playerId, isPokemonWithoutRuleBox);
      setSearchPending(state, playerId, "POKEMON_NO_RULE_BOX", matches);
      return;
    }
    case "trainer_poffin": {
      const matches = deckPokemonMatching(
        state,
        playerId,
        (entry) => isBasicPokemon(entry) && getHp(entry) <= effect.maxHp,
      );
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId,
        filter: "POFFIN",
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: effect.count,
      };
      logMessage(
        state,
        `Buddy-Buddy Poffin: choose up to ${effect.count} Basic Pokémon (${effect.maxHp} HP or less) for your Bench.`,
      );
      return;
    }
    case "trainer_night_stretcher":
      applyNightStretcher(state, playerId, effect.count);
      return;
    case "trainer_crushing_hammer":
      applyCrushingHammer(state, playerId);
      return;
    case "trainer_enhanced_hammer":
      applyEnhancedHammer(state, playerId);
      return;
    case "trainer_rare_candy":
      state.pendingAction = { type: "RARE_CANDY", playerId };
      logMessage(state, "Rare Candy: choose a Basic Pokémon in play to evolve.");
      return;
    case "trainer_unfair_stamp":
      applyUnfairStamp(state, playerId);
      return;
    case "trainer_special_red_card":
      applySpecialRedCard(state, playerId);
      return;
    case "trainer_crispin":
      applyCrispin(state, playerId);
      return;
    case "trainer_crispin_sv":
      applyTrainerBatch10Kind(state, playerId, effect);
      return;
    case "trainer_hilda":
      applyHilda(state, playerId);
      return;
    case "trainer_pokegear":
      applyTrainerBatch5Kind(state, playerId, { kind: "trainer_pokegear" });
      return;
    case "trainer_wallys_compassion":
      applyWallysCompassionEffect(state, playerId);
      return;
    case "trainer_energy_switch":
      applyEnergySwitch(state, playerId);
      return;
    case "trainer_switch_active_bench":
      state.pendingAction = { type: "SWITCH_WITH_BENCH", playerId };
      logMessage(state, "Switch: choose a Benched Pokémon to swap with your Active Pokémon.");
      return;
    default:
      applyTrainerBatch10Kind(state, playerId, effect);
      applyTrainerBatch9Kind(state, playerId, effect);
      applyTrainerBatch7Kind(state, playerId, effect);
      applyTrainerBatch5Kind(state, playerId, effect);
      applyTrainerBatch3Kind(state, playerId, effect);
      applyTrainerMetaKind(state, playerId, effect);
      return;
  }
}

function applyNightStretcher(state: EngineState, playerId: PlayerId, maxCount: number): void {
  const player = getPlayer(state, playerId);
  const pokemonOptions = discardPokemonInPile(state, playerId);
  // CRI Night Stretcher (count: 1) allows retrieving Pokémon OR Basic Energy
  const energyOptions =
    maxCount === 1
      ? player.discard.filter((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)))
      : [];
  const options = [...pokemonOptions, ...energyOptions];
  if (options.length === 0) {
    logMessage(state, "Night Stretcher: no eligible card in discard.");
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
    slotsRemaining: maxCount,
  };
  logMessage(
    state,
    maxCount === 1
      ? "Night Stretcher: choose a Pokémon or Basic Energy from your discard pile."
      : `Night Stretcher: choose up to ${maxCount} Pokémon from your discard pile.`,
  );
}

function applyCrushingHammer(state: EngineState, playerId: PlayerId): void {
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
}

function applySpecialRedCard(state: EngineState, playerId: PlayerId): void {
  const opponentId = getOpponentId(playerId);
  const opponent = getPlayer(state, opponentId);
  const returned = [...opponent.hand];
  if (returned.length === 0) {
    logMessage(state, "Special Red Card: opponent's hand was empty.");
    return;
  }
  opponent.hand = [];
  for (const card of returned) {
    card.zone = Zone.Deck;
    opponent.deck.push(card);
  }
  drawCards(state, opponentId, 3);
  logMessage(
    state,
    `Special Red Card: opponent put ${returned.length} card(s) on the bottom of their deck and drew 3 cards.`,
  );
}

function applyUnfairStamp(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  // Both players shuffle their hands into their decks
  for (const card of [...player.hand]) {
    card.zone = Zone.Deck;
    player.deck.push(card);
  }
  player.hand = [];
  shufflePlayerDeck(state, playerId);
  for (const card of [...opponent.hand]) {
    card.zone = Zone.Deck;
    opponent.deck.push(card);
  }
  opponent.hand = [];
  shufflePlayerDeck(state, getOpponentId(playerId));
  // Player draws 5, opponent draws 2
  drawCards(state, playerId, 5);
  drawCards(state, getOpponentId(playerId), 2);
  logMessage(
    state,
    `Unfair Stamp: both players shuffled their hands. ${player.name} drew 5 cards, ${opponent.name} drew 2 cards.`,
  );
}

function applyWallysCompassionEffect(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  // Only Mega Evolution Pokémon ex are valid targets
  const options = allPokemonInPlay(player).filter((mon) =>
    isMegaEvolutionEx(getDefinitionSafe(state, mon.definitionId)),
  );
  if (options.length === 0) {
    logMessage(state, "Wally's Compassion: no Mega Evolution Pokémon ex in play.");
    return;
  }
  if (options.length === 1) {
    applyWallysCompassion(state, playerId, options[0]!.instanceId);
    return;
  }
  state.pendingAction = {
    type: "WALLYS_COMPASSION",
    playerId,
    options: options.map((entry) => entry.instanceId),
  };
  logMessage(state, "Wally's Compassion: choose a Mega Evolution Pokémon ex to heal all damage from.");
}

function executeParsedTrainerEffects(
  state: EngineState,
  playerId: PlayerId,
  effects: ParsedEffect[],
): void {
  for (const effect of effects) {
    if (!isTrainerKindImplemented(effect.kind)) continue;
    applyTrainerByKind(state, playerId, effect);
  }
}

export function canPlayTrainerEffect(
  state: EngineState,
  playerId: PlayerId,
  def: CardDefinition,
): TrainerPlayCheck {
  if (isTool(def)) {
    return { ok: false, reason: "Attach Tools to a Pokémon in play using Attach Tool." };
  }

  const parsed = parseTrainerText(def);
  const parsedKinds = parsed.effects.filter((effect) => isTrainerKindImplemented(effect.kind));
  if (parsedKinds.length > 0) {
    for (const effect of parsedKinds) {
      const check = canPlayTrainerKind(state, playerId, effect.kind);
      if (!check.ok) return check;
    }
    return { ok: true };
  }

  return canPlayLegacyTrainerEffect(state, playerId, def);
}

function canPlayLegacyTrainerEffect(
  state: EngineState,
  playerId: PlayerId,
  def: CardDefinition,
): TrainerPlayCheck {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));

  if (matchesTrainer(def, "boss's orders", "boss")) {
    if (opponent.bench.length === 0) {
      return { ok: false, reason: "Boss's Orders requires an opponent's Benched Pokémon." };
    }
  }

  if (matchesTrainer(def, "ultra ball")) {
    if (player.hand.length < 3) {
      return { ok: false, reason: "Ultra Ball requires discarding 2 cards from your hand." };
    }
  }

  if (matchesTrainer(def, "rare candy")) {
    if (state.turnNumber === 1 && state.currentPlayerId === state.firstPlayerId) {
      return { ok: false, reason: "Rare Candy cannot be used on your first turn." };
    }
    if (!hasRareCandyTarget(state, playerId)) {
      return { ok: false, reason: "No eligible Basic Pokémon and matching Stage 2 in hand for Rare Candy." };
    }
  }

  if (matchesTrainer(def, "night stretcher")) {
    if (discardPokemonInPile(state, playerId).length === 0) {
      return { ok: false, reason: "Night Stretcher requires a Pokémon in your discard pile." };
    }
  }

  if (matchesTrainer(def, "poké pad", "poke pad")) {
    if (deckPokemonMatching(state, playerId, isPokemonWithoutRuleBox).length === 0) {
      return { ok: false, reason: "No Pokémon without a Rule Box found in your deck." };
    }
  }

  if (matchesTrainer(def, "buddy-buddy poffin", "poffin")) {
    if (
      deckPokemonMatching(state, playerId, (entry) => isBasicPokemon(entry) && getHp(entry) <= 70).length === 0
    ) {
      return { ok: false, reason: "No Basic Pokémon with 70 HP or less found in deck." };
    }
  }

  if (matchesTrainer(def, "unfair stamp")) {
    if (!state.ownPokemonKnockedOutOpponentLastTurn[playerId]) {
      return { ok: false, reason: "Unfair Stamp: none of your Pokémon were Knocked Out during your opponent's last turn." };
    }
  }

  if (matchesTrainer(def, "special red card")) {
    const opponent = getPlayer(state, getOpponentId(playerId));
    if (opponent.prizes.length > 3) {
      return { ok: false, reason: "Special Red Card: opponent must have 3 or fewer Prize cards remaining." };
    }
  }

  if (isSwitchItem(def)) {
    if (!player.active || player.bench.length === 0) {
      return { ok: false, reason: "Switch requires an Active Pokémon and a Benched Pokémon." };
    }
  }

  if (isEnergySwitch(def)) {
    if (!canEnergySwitch(state, playerId)) {
      return { ok: false, reason: "Energy Switch requires 2 Pokémon in play and Basic Energy to move." };
    }
  }

  if (matchesTrainer(def, "enhanced hammer")) {
    if (opponentEnergyTargets(state, playerId).length === 0) {
      return { ok: false, reason: "Enhanced Hammer: opponent has no Energy attached." };
    }
  }

  if (matchesTrainer(def, "hilda")) {
    const hasEvolution = deckEvolutionMatching(state, playerId).length > 0;
    const hasEnergy = deckEnergyMatching(state, playerId).length > 0;
    if (!hasEvolution && !hasEnergy) {
      return { ok: false, reason: "Hilda: no Evolution Pokémon or Energy cards found in your deck." };
    }
  }

  if (matchesTrainer(def, "pokégear 3.0", "pokegear 3.0")) {
    const pokegearCheck = canPlayTrainerBatch5Kind(state, playerId, "trainer_pokegear");
    if (!pokegearCheck.ok) return pokegearCheck;
  }

  if (matchesTrainer(def, "wally's compassion")) {
    const hasMega = allPokemonInPlay(player).some((mon) => {
      const monDef = getDefinitionSafe(state, mon.definitionId);
      return isMegaEvolutionEx(monDef);
    });
    if (!hasMega) {
      return { ok: false, reason: "Wally's Compassion requires a Mega Evolution Pokémon ex in play." };
    }
  }

  return { ok: true };
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
      shufflePlayerDeck(state, playerId);
      state.pendingAction = null;
      return;
    }
    card.zone = Zone.Bench;
    card.ownerId = playerId;
    card.enteredPlayTurn = state.turnNumber;
    player.bench.push(card);
    applyRiskyRuinsDamage(state, card);
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
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "BASIC_BENCH") {
    if (player.bench.length >= 5) {
      player.deck.unshift(card);
      logMessage(state, "Bench is full — cannot place more Pokémon.");
      shufflePlayerDeck(state, playerId);
      state.pendingAction = null;
      return;
    }
    card.zone = Zone.Bench;
    card.ownerId = playerId;
    card.enteredPlayTurn = state.turnNumber;
    player.bench.push(card);
    applyRiskyRuinsDamage(state, card);
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
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "BASIC_PSYCHIC_BENCH") {
    player.deck.unshift(card);
    resolveBasicPsychicBenchPick(state, playerId, instanceId);
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
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "POKEGEAR_TOP7") {
    card.zone = Zone.Hand;
    player.hand.push(card);
    logMessage(state, `${player.name} revealed ${def.name} and put it into their hand (Pokégear 3.0).`);
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "SUPPORTER_HAND") {
    card.zone = Zone.Hand;
    player.hand.push(card);
    logMessage(state, `${player.name} added ${def.name} to their hand.`);

    const pending = state.pendingAction;
    if (
      pending?.type === "SEARCH_DECK" &&
      pending.filter === "SUPPORTER_HAND" &&
      (pending.slotsRemaining ?? 1) > 1
    ) {
      const remaining = deckTrainerMatching(state, playerId, isSupporter);
      if (remaining.length > 0) {
        state.pendingAction = {
          type: "SEARCH_DECK",
          playerId,
          filter: "SUPPORTER_HAND",
          options: remaining.map((entry) => entry.instanceId),
          slotsRemaining: (pending.slotsRemaining ?? 1) - 1,
        };
        logMessage(state, "Choose another Supporter card (optional).");
        return;
      }
    }
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  if (filter === "SALVATORE_EVOLUTION") {
    startSalvatoreEvolve(state, playerId, instanceId);
    return;
  }

  if (
    filter === "TEAM_ROCKET_BASIC_HAND" ||
    filter === "POKEMON_EX_HAND" ||
    filter === "MEGA_EVOLUTION_EX_HAND" ||
    filter === "ANY_TRAINER_HAND" ||
    filter === "TEAM_ROCKET_SUPPORTER_HAND" ||
    filter === "TOOL_HAND" ||
    filter === "TYPED_POKEMON_MAX_HP_HAND"
  ) {
    card.zone = Zone.Hand;
    player.hand.push(card);
    logMessage(state, `${player.name} added ${def.name} to their hand.`);
    continueMultiPickDeckToHand(state, playerId, instanceId, filter);
    return;
  }

  if (filter === "NAMED_POKEMON_BENCH") {
    if (player.bench.length >= 5) {
      player.deck.unshift(card);
      logMessage(state, "Bench is full — cannot place more Pokémon.");
      shufflePlayerDeck(state, playerId);
      state.pendingAction = null;
      return;
    }
    card.zone = Zone.Bench;
    card.ownerId = playerId;
    card.enteredPlayTurn = state.turnNumber;
    player.bench.push(card);
    applyRiskyRuinsOnBenchPlay(state, card, playerId);
    logMessage(state, `${player.name} placed ${def.name} on the Bench.`);

    const pending = state.pendingAction;
    const nameFilter = pending?.type === "SEARCH_DECK" ? pending.searchMeta?.nameFilter?.toLowerCase() : undefined;
    if (
      pending?.type === "SEARCH_DECK" &&
      pending.filter === "NAMED_POKEMON_BENCH" &&
      (pending.slotsRemaining ?? 1) > 1 &&
      player.bench.length < 5
    ) {
      const remaining = player.deck.filter((entry) => {
        const entryDef = getDefinition(state, entry.definitionId);
        return (
          entryDef?.supertype === "Pokémon" &&
          (!nameFilter || entryDef.name.toLowerCase().includes(nameFilter))
        );
      });
      if (remaining.length > 0) {
        state.pendingAction = {
          type: "SEARCH_DECK",
          playerId,
          filter: "NAMED_POKEMON_BENCH",
          options: remaining.map((entry) => entry.instanceId),
          slotsRemaining: (pending.slotsRemaining ?? 1) - 1,
          searchMeta: pending.searchMeta,
        };
        logMessage(state, "Choose another matching Pokémon for your Bench (optional).");
        return;
      }
    }
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }

  card.zone = Zone.Hand;
  player.hand.push(card);
  shufflePlayerDeck(state, playerId);
  logMessage(state, `${player.name} added ${def.name} to their hand.`);
  state.pendingAction = null;
}

export function applyTrainerEffect(
  state: EngineState,
  playerId: PlayerId,
  def: CardDefinition,
): void {
  const parsed = parseTrainerText(def);
  const parsedKinds = parsed.effects.filter((effect) => isTrainerKindImplemented(effect.kind));
  if (parsedKinds.length > 0) {
    executeParsedTrainerEffects(state, playerId, parsedKinds);
    return;
  }

  applyLegacyTrainerEffect(state, playerId, def);
}

function applyLegacyTrainerEffect(
  state: EngineState,
  playerId: PlayerId,
  def: CardDefinition,
): void {
  const player = getPlayer(state, playerId);

  if (matchesTrainer(def, "lillie's determination")) {
    const returned = [...player.hand];
    player.hand = [];
    for (const card of returned) {
      card.zone = Zone.Deck;
      player.deck.push(card);
    }
    shufflePlayerDeck(state, playerId);
    const drawCount = player.prizes.length === 6 ? 8 : 6;
    drawCards(state, playerId, drawCount);
    logMessage(
      state,
      `${player.name} shuffled their hand into their deck and drew ${drawCount} cards (Lillie's Determination).`,
    );
    return;
  }

  if (matchesTrainer(def, "judge")) {
    applyJudgeEffect(state);
    return;
  }

  if (matchesTrainer(def, "iono")) {
    applyIono(state, playerId);
    return;
  }

  if (matchesTrainer(def, "boss's orders", "boss")) {
    state.pendingAction = { type: "BOSS_ORDERS", playerId };
    logMessage(state, `${player.name} played Boss's Orders — choose an opponent's Benched Pokémon.`);
    return;
  }

  if (matchesTrainer(def, "ultra ball")) {
    state.pendingAction = { type: "ULTRA_BALL_DISCARD", playerId, selectedIds: [] };
    logMessage(state, "Ultra Ball: choose 2 cards from your hand to discard.");
    return;
  }

  if (matchesTrainer(def, "poké pad", "poke pad")) {
    const matches = deckPokemonMatching(state, playerId, isPokemonWithoutRuleBox);
    setSearchPending(state, playerId, "POKEMON_NO_RULE_BOX", matches);
    return;
  }

  if (matchesTrainer(def, "buddy-buddy poffin", "poffin")) {
    const matches = deckPokemonMatching(
      state,
      playerId,
      (entry) => isBasicPokemon(entry) && getHp(entry) <= 70,
    );
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

  if (matchesTrainer(def, "night stretcher")) {
    const options = discardPokemonInPile(state, playerId);
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
      slotsRemaining: 3,
    };
    logMessage(state, "Night Stretcher: choose up to 3 Pokémon from your discard pile.");
    return;
  }

  if (matchesTrainer(def, "crushing hammer")) {
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

  if (matchesTrainer(def, "enhanced hammer")) {
    applyEnhancedHammer(state, playerId);
    return;
  }

  if (matchesTrainer(def, "rare candy")) {
    state.pendingAction = { type: "RARE_CANDY", playerId };
    logMessage(state, "Rare Candy: choose a Basic Pokémon in play to evolve.");
    return;
  }

  if (matchesTrainer(def, "unfair stamp")) {
    applyUnfairStamp(state, playerId);
    return;
  }

  if (matchesTrainer(def, "special red card")) {
    applySpecialRedCard(state, playerId);
    return;
  }

  if (matchesTrainer(def, "crispin")) {
    applyCrispin(state, playerId);
    return;
  }

  if (matchesTrainer(def, "professor's research")) {
    const returned = [...player.hand];
    player.hand = [];
    for (const card of returned) {
      card.zone = Zone.Deck;
      player.deck.push(card);
    }
    shufflePlayerDeck(state, playerId);
    drawCards(state, playerId, 7);
    logMessage(state, `${player.name} discarded their hand and drew 7 cards (Professor's Research).`);
    return;
  }

  if (isEnergySwitch(def)) {
    applyEnergySwitch(state, playerId);
    return;
  }

  if (isSwitchItem(def)) {
    state.pendingAction = { type: "SWITCH_WITH_BENCH", playerId };
    logMessage(state, "Switch: choose a Benched Pokémon to swap with your Active Pokémon.");
    return;
  }

  if (matchesTrainer(def, "hilda")) {
    applyHilda(state, playerId);
    return;
  }

  if (matchesTrainer(def, "pokégear 3.0", "pokegear 3.0")) {
    applyTrainerBatch5Kind(state, playerId, { kind: "trainer_pokegear" });
    return;
  }

  if (matchesTrainer(def, "wally's compassion")) {
    applyWallysCompassionEffect(state, playerId);
    return;
  }
}

function applyEnhancedHammer(state: EngineState, playerId: PlayerId): void {
  const opponentId = getOpponentId(playerId);
  const candidates = opponentPokemonWithEnergy(state, playerId);
  if (candidates.length === 0) {
    logMessage(state, "Enhanced Hammer: opponent has no Energy attached.");
    return;
  }

  if (candidates.length === 1) {
    const pokemon = candidates[0]!;
    discardEnhancedHammerEnergy(state, opponentId, pokemon.instanceId, 2);
    return;
  }

  state.pendingAction = {
    type: "ENHANCED_HAMMER",
    playerId,
    step: "POKEMON",
    discardRemaining: 2,
    options: [],
  };
  logMessage(state, "Enhanced Hammer: choose an opponent's Pokémon.");
}

function discardEnhancedHammerEnergy(
  state: EngineState,
  ownerId: PlayerId,
  pokemonId: string,
  count: number,
): void {
  const player = getPlayer(state, ownerId);
  const pokemon =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon || pokemon.attachedEnergy.length === 0) {
    state.pendingAction = null;
    return;
  }

  const toDiscard = Math.min(count, pokemon.attachedEnergy.length);
  for (let i = 0; i < toDiscard; i += 1) {
    const energyId = pokemon.attachedEnergy[0]!.instanceId;
    discardAttachedEnergy(state, ownerId, pokemonId, energyId, false);
  }
  state.pendingAction = null;
  logMessage(state, `Enhanced Hammer discarded ${toDiscard} Energy.`);
}

export function resolveEnhancedHammerPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ENHANCED_HAMMER" || pending.playerId !== playerId || pending.step !== "POKEMON") {
    return;
  }

  const opponentId = getOpponentId(playerId);
  const opponent = getPlayer(state, opponentId);
  const pokemon =
    opponent.active?.instanceId === pokemonId
      ? opponent.active
      : opponent.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon || pokemon.attachedEnergy.length === 0) return;

  if (pokemon.attachedEnergy.length === 1 || pending.discardRemaining === 1) {
    discardEnhancedHammerEnergy(state, opponentId, pokemonId, pending.discardRemaining);
    return;
  }

  state.pendingAction = {
    type: "ENHANCED_HAMMER",
    playerId,
    step: "ENERGY",
    pokemonId,
    discardRemaining: pending.discardRemaining,
    options: pokemon.attachedEnergy.map((energy) => ({
      pokemonId,
      energyId: energy.instanceId,
    })),
  };
  logMessage(state, "Enhanced Hammer: choose Energy to discard.");
}

export function resolveEnhancedHammerEnergy(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  energyId: string,
): void {
  const pending = state.pendingAction;
  if (
    pending?.type !== "ENHANCED_HAMMER" ||
    pending.playerId !== playerId ||
    pending.step !== "ENERGY" ||
    pending.pokemonId !== pokemonId
  ) {
    return;
  }

  const opponentId = getOpponentId(playerId);
  discardAttachedEnergy(state, opponentId, pokemonId, energyId, false);
  const remaining = pending.discardRemaining - 1;
  if (remaining <= 0) {
    state.pendingAction = null;
    logMessage(state, "Enhanced Hammer finished discarding Energy.");
    return;
  }

  const opponent = getPlayer(state, opponentId);
  const pokemon =
    opponent.active?.instanceId === pokemonId
      ? opponent.active
      : opponent.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon || pokemon.attachedEnergy.length === 0) {
    state.pendingAction = null;
    return;
  }

  if (pokemon.attachedEnergy.length === 1) {
    discardEnhancedHammerEnergy(state, opponentId, pokemonId, remaining);
    return;
  }

  state.pendingAction = {
    ...pending,
    discardRemaining: remaining,
    options: pokemon.attachedEnergy.map((energy) => ({
      pokemonId,
      energyId: energy.instanceId,
    })),
  };
  logMessage(state, "Enhanced Hammer: choose another Energy to discard.");
}

function findFirstBasicEnergy(state: EngineState, pokemon: CardInstance): CardInstance | null {
  return (
    pokemon.attachedEnergy.find((energy) => {
      const def = getDefinition(state, energy.definitionId);
      return def && isBasicEnergy(def);
    }) ?? null
  );
}

function moveBasicEnergyBetweenPokemon(
  state: EngineState,
  source: CardInstance,
  target: CardInstance,
  energyId: string,
): void {
  const index = source.attachedEnergy.findIndex((entry) => entry.instanceId === energyId);
  if (index === -1) return;
  const energy = source.attachedEnergy.splice(index, 1)[0]!;
  energy.zone = target.zone;
  target.attachedEnergy.push(energy);
  logMessage(
    state,
    `Moved ${getDefinitionSafe(state, energy.definitionId).name} from ${getDefinitionSafe(state, source.definitionId).name} to ${getDefinitionSafe(state, target.definitionId).name}.`,
  );
}

function applyEnergySwitch(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const sources = pokemonWithBasicEnergy(state, playerId).filter((source) =>
    allPokemonInPlay(player).some((target) => target.instanceId !== source.instanceId),
  );

  if (sources.length === 1) {
    const source = sources[0]!;
    const targets = allPokemonInPlay(player).filter((target) => target.instanceId !== source.instanceId);
    if (targets.length === 1) {
      const energy = findFirstBasicEnergy(state, source);
      if (energy) {
        moveBasicEnergyBetweenPokemon(state, source, targets[0]!, energy.instanceId);
        return;
      }
    }
    state.pendingAction = {
      type: "ENERGY_SWITCH",
      playerId,
      step: "TARGET",
      sourceId: source.instanceId,
      options: targets.map((target) => target.instanceId),
    };
    logMessage(state, "Energy Switch: choose a Pokémon to move the Basic Energy to.");
    return;
  }

  state.pendingAction = {
    type: "ENERGY_SWITCH",
    playerId,
    step: "SOURCE",
    options: sources.map((source) => source.instanceId),
  };
  logMessage(state, "Energy Switch: choose a Pokémon to move Basic Energy from.");
}

export function resolveEnergySwitchPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ENERGY_SWITCH" || pending.playerId !== playerId) return;

  const player = getPlayer(state, playerId);

  if (pending.step === "SOURCE") {
    const source =
      player.active?.instanceId === pokemonId
        ? player.active
        : player.bench.find((entry) => entry.instanceId === pokemonId);
    if (!source || !findFirstBasicEnergy(state, source)) return;

    const targets = allPokemonInPlay(player).filter((target) => target.instanceId !== source.instanceId);
    if (targets.length === 1) {
      const energy = findFirstBasicEnergy(state, source);
      if (energy) {
        moveBasicEnergyBetweenPokemon(state, source, targets[0]!, energy.instanceId);
        state.pendingAction = null;
      }
      return;
    }

    state.pendingAction = {
      type: "ENERGY_SWITCH",
      playerId,
      step: "TARGET",
      sourceId: source.instanceId,
      options: targets.map((target) => target.instanceId),
    };
    logMessage(state, "Energy Switch: choose a Pokémon to move the Basic Energy to.");
    return;
  }

  if (pending.step === "TARGET" && pending.sourceId) {
    const source =
      player.active?.instanceId === pending.sourceId
        ? player.active
        : player.bench.find((entry) => entry.instanceId === pending.sourceId);
    const target =
      player.active?.instanceId === pokemonId
        ? player.active
        : player.bench.find((entry) => entry.instanceId === pokemonId);
    if (!source || !target || source.instanceId === target.instanceId) return;

    const energy = findFirstBasicEnergy(state, source);
    if (!energy) return;
    moveBasicEnergyBetweenPokemon(state, source, target, energy.instanceId);
    state.pendingAction = null;
  }
}

export function applyWallysCompassion(state: EngineState, playerId: PlayerId, pokemonId: string): void {
  const player = getPlayer(state, playerId);
  const pokemon =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon) return;

  const def = getDefinitionSafe(state, pokemon.definitionId);
  const hadDamage = pokemon.damageCounters > 0;

  // Heal ALL damage (not just 60)
  pokemon.damageCounters = 0;
  logMessage(state, `${def.name} healed all damage (Wally's Compassion).`);

  // If any damage was healed, put all attached Energy into the player's hand
  if (hadDamage && pokemon.attachedEnergy.length > 0) {
    for (const energy of pokemon.attachedEnergy) {
      energy.zone = Zone.Hand;
      player.hand.push(energy);
    }
    pokemon.attachedEnergy = [];
    logMessage(state, `All Energy attached to ${def.name} was put into ${player.name}'s hand.`);
  }

  // Pokémon stays in play — do NOT shuffle it into the deck
  state.pendingAction = null;
}

function applyCrispin(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const energyIndex = player.deck.findIndex((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isBasicEnergy(def);
  });

  if (energyIndex === -1) {
    shufflePlayerDeck(state, playerId);
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
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Crispin: no Basic Pokémon in play to attach Energy.");
    maybeCrispinOptionalDiscard(state, playerId);
    return;
  }

  if (basics.length === 1) {
    attachEnergyToPokemon(state, playerId, energy, basics[0]!);
    shufflePlayerDeck(state, playerId);
    maybeCrispinOptionalDiscard(state, playerId);
    return;
  }

  state.pendingAction = {
    type: "CRISPIN_ATTACH",
    playerId,
    energyId: energy.instanceId,
    targets: basics.map((b) => b.instanceId),
  };
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
  applyRiskyRuinsOnBenchPlay(state, pokemon, pokemon.ownerId);
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
    shufflePlayerDeck(state, playerId);
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

  transferPokemonStateOntoEvolution(basic, evoCard, playerId);
  // Stage 2 from Rare Candy just entered play this turn (can't be
  // re-evolved on the same turn — symmetric with normal evolution).
  evoCard.enteredPlayTurn = state.turnNumber;

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

function putHandCardOnDeckBottom(state: EngineState, playerId: PlayerId, instanceId: string): boolean {
  const player = getPlayer(state, playerId);
  const card = removeFromHand(player, instanceId);
  if (!card) return false;
  card.zone = Zone.Deck;
  player.deck.push(card);
  logMessage(
    state,
    `${player.name} put ${getDefinitionSafe(state, card.definitionId).name} on the bottom of their deck.`,
  );
  return true;
}

function finishIonoDraws(state: EngineState): void {
  for (const id of [PlayerId.P1, PlayerId.P2]) {
    shufflePlayerDeck(state, id);
  }
  for (const id of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, id);
    const opponent = getPlayer(state, getOpponentId(id));
    const drawCount = player.prizes.length > opponent.prizes.length ? 3 : 1;
    drawCards(state, id, drawCount);
  }
  state.pendingAction = null;
  logMessage(state, "Iono: both players shuffled their decks and drew cards.");
}

function beginIonoHandBottom(state: EngineState, targetPlayerId: PlayerId): void {
  const player = getPlayer(state, targetPlayerId);
  if (player.hand.length === 0) {
    if (targetPlayerId === PlayerId.P1) {
      beginIonoHandBottom(state, PlayerId.P2);
      return;
    }
    finishIonoDraws(state);
    return;
  }
  if (player.hand.length === 1) {
    putHandCardOnDeckBottom(state, targetPlayerId, player.hand[0]!.instanceId);
    if (targetPlayerId === PlayerId.P1) {
      beginIonoHandBottom(state, PlayerId.P2);
      return;
    }
    finishIonoDraws(state);
    return;
  }
  state.pendingAction = { type: "IONO_HAND_BOTTOM", playerId: targetPlayerId };
  logMessage(
    state,
    `${player.name} puts a card from their hand on the bottom of their deck (Iono).`,
  );
}

export function applyIono(state: EngineState, playerId: PlayerId): void {
  void playerId;
  beginIonoHandBottom(state, PlayerId.P1);
}

export function continueIonoHandBottom(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "IONO_HAND_BOTTOM" || pending.playerId !== playerId) return;
  if (!putHandCardOnDeckBottom(state, playerId, instanceId)) return;
  if (playerId === PlayerId.P1) {
    beginIonoHandBottom(state, PlayerId.P2);
    return;
  }
  finishIonoDraws(state);
}

export function continueNightStretcherPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "PICK_DISCARD" || pending.playerId !== playerId) return;

  const player = getPlayer(state, playerId);
  const index = player.discard.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.discard.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  logMessage(
    state,
    `${player.name} put ${getDefinitionSafe(state, card.definitionId).name} from discard into their hand.`,
  );

  const remainingSlots = (pending.slotsRemaining ?? 1) - 1;
  const remaining = discardPokemonInPile(state, playerId);
  if (remainingSlots > 0 && remaining.length > 0) {
    state.pendingAction = {
      type: "PICK_DISCARD",
      playerId,
      options: remaining.map((entry) => entry.instanceId),
      slotsRemaining: remainingSlots,
    };
    logMessage(state, "Night Stretcher: choose another Pokémon (optional).");
    return;
  }

  state.pendingAction = null;
}
