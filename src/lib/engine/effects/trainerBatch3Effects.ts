import {
  isBasicEnergy,
  isBasicPokemon,
  isEvolutionPokemon,
  isPokemonWithoutRuleBox,
  isStage2,
  isSupporter,
  isTeamRocketSupporter,
} from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { drawCards, getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  moveToDiscard,
  type EngineState,
} from "../types";
import type { ParsedEffect } from "./types";
import { attachEnergyToPokemon, discardAttachedEnergy } from "../trainerEffects";
import { placePokemonFromDiscardToBench } from "./pokemonZoneHelpers";
import { applyRiskyRuinsOnBenchPlay, getMaxBenchSize, getStadiumKind } from "./stadiumEffects";
import {
  addFromDeckToHand,
  deckMatching,
  switchActiveWithBench,
} from "./trainerDeckHelpers";
import type { TrainerPlayCheck } from "./trainerPlayCheck";

export type { TrainerPlayCheck } from "./trainerPlayCheck";

function discardPokemonMatching(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.discard.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return def?.supertype === "Pokémon";
  });
}

function lanaAidEligible(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.discard.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    if (!def) return false;
    if (isBasicEnergy(def)) return true;
    return def.supertype === "Pokémon" && isPokemonWithoutRuleBox(def);
  });
}

function drawUntilHand(state: EngineState, playerId: PlayerId, target: number): void {
  const player = getPlayer(state, playerId);
  while (player.hand.length < target && player.deck.length > 0) {
    const card = player.deck.shift()!;
    card.zone = Zone.Hand;
    player.hand.push(card);
  }
  logMessage(state, `${player.name} drew until they had ${player.hand.length} cards in hand.`);
}

export function applyPremiumPowerPro(state: EngineState, amount: number): void {
  state.turnFlags.fightingActiveDamageBonus = (state.turnFlags.fightingActiveDamageBonus ?? 0) + amount;
  logMessage(state, `Premium Power Pro: Fighting Pokémon's attacks do ${amount} more damage to Active this turn.`);
}

export function applyBlackBeltTraining(state: EngineState, amount: number): void {
  state.turnFlags.activeExDamageBonus = (state.turnFlags.activeExDamageBonus ?? 0) + amount;
  logMessage(state, `Black Belt's Training: attacks do ${amount} more damage to opponent's Active ex this turn.`);
}

export function applyBriar(state: EngineState): void {
  state.turnFlags.briarExtraPrizeOnTeraKo = true;
  logMessage(state, "Briar: Tera Pokémon KOs may take an extra Prize this turn.");
}

export function applyLanasAid(state: EngineState, playerId: PlayerId, count: number): void {
  const options = lanaAidEligible(state, playerId);
  if (options.length === 0) {
    logMessage(state, "Lana's Aid: no eligible cards in discard.");
    return;
  }
  if (options.length <= count) {
    const player = getPlayer(state, playerId);
    for (const card of options) {
      const idx = player.discard.indexOf(card);
      if (idx === -1) continue;
      player.discard.splice(idx, 1);
      card.zone = Zone.Hand;
      player.hand.push(card);
    }
    logMessage(state, "Lana's Aid: returned cards from discard to hand.");
    return;
  }
  state.pendingAction = {
    type: "LANAS_AID",
    playerId,
    pickedIds: [],
    options: options.map((entry) => entry.instanceId),
  };
  logMessage(state, `Lana's Aid: choose up to ${count} cards from your discard pile.`);
}

export function resolveLanasAidPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "LANAS_AID" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.discard.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.discard.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  pending.pickedIds.push(instanceId);
  const remaining = lanaAidEligible(state, playerId).filter((entry) => !pending.pickedIds.includes(entry.instanceId));
  if (pending.pickedIds.length < 3 && remaining.length > 0) {
    state.pendingAction = {
      ...pending,
      options: remaining.map((entry) => entry.instanceId),
    };
    logMessage(state, "Lana's Aid: choose another card (optional).");
    return;
  }
  state.pendingAction = null;
}

export function applyBrocksScouting(state: EngineState, playerId: PlayerId): void {
  const basics = deckMatching(state, playerId, isBasicPokemon);
  const evolutions = deckMatching(state, playerId, isEvolutionPokemon);
  if (basics.length === 0 && evolutions.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Brock's Scouting: no matching Pokémon in deck.");
    return;
  }
  if (basics.length > 0 && evolutions.length > 0) {
    state.pendingAction = { type: "BROCKS_SCOUTING", playerId, step: "MODE", options: [] };
    logMessage(state, "Brock's Scouting: choose up to 2 Basic Pokémon or 1 Evolution Pokémon.");
    return;
  }
  if (evolutions.length > 0) {
    startBrockEvolutionPick(state, playerId, evolutions);
    return;
  }
  startBrockBasicPick(state, playerId, basics);
}

function startBrockBasicPick(state: EngineState, playerId: PlayerId, basics: CardInstance[]): void {
  if (basics.length <= 2) {
    for (const card of basics) addFromDeckToHand(state, playerId, card.instanceId, "Brock's Scouting");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "BROCKS_SCOUTING",
    playerId,
    step: "BASIC",
    pickedIds: [],
    options: basics.map((entry) => entry.instanceId),
  };
  logMessage(state, "Brock's Scouting: choose up to 2 Basic Pokémon.");
}

function startBrockEvolutionPick(state: EngineState, playerId: PlayerId, evolutions: CardInstance[]): void {
  if (evolutions.length === 1) {
    addFromDeckToHand(state, playerId, evolutions[0]!.instanceId, "Brock's Scouting");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "BROCKS_SCOUTING",
    playerId,
    step: "EVOLUTION",
    options: evolutions.map((entry) => entry.instanceId),
  };
  logMessage(state, "Brock's Scouting: choose an Evolution Pokémon.");
}

export function resolveBrockMode(state: EngineState, playerId: PlayerId, mode: "basic" | "evolution"): void {
  const pending = state.pendingAction;
  if (pending?.type !== "BROCKS_SCOUTING" || pending.playerId !== playerId || pending.step !== "MODE") return;
  if (mode === "basic") startBrockBasicPick(state, playerId, deckMatching(state, playerId, isBasicPokemon));
  else startBrockEvolutionPick(state, playerId, deckMatching(state, playerId, isEvolutionPokemon));
}

export function resolveBrockPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "BROCKS_SCOUTING" || pending.playerId !== playerId) return;
  if (pending.step === "EVOLUTION") {
    if (!pending.options.includes(instanceId)) return;
    addFromDeckToHand(state, playerId, instanceId, "Brock's Scouting");
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    return;
  }
  if (pending.step !== "BASIC") return;
  if (!pending.options.includes(instanceId)) return;
  addFromDeckToHand(state, playerId, instanceId, "Brock's Scouting");
  const pickedIds = [...(pending.pickedIds ?? []), instanceId];
  const remaining = deckMatching(state, playerId, isBasicPokemon).filter((entry) => !pickedIds.includes(entry.instanceId));
  if (pickedIds.length < 2 && remaining.length > 0) {
    state.pendingAction = {
      type: "BROCKS_SCOUTING",
      playerId,
      step: "BASIC",
      pickedIds,
      options: remaining.map((entry) => entry.instanceId),
    };
    logMessage(state, "Brock's Scouting: choose another Basic Pokémon (optional).");
    return;
  }
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
}

export function applyRosasEncouragement(state: EngineState, playerId: PlayerId, maxEnergy: number): void {
  const player = getPlayer(state, playerId);
  const targets = allPokemonInPlay(player).filter((pokemon) =>
    isStage2(getDefinitionSafe(state, pokemon.definitionId)),
  );
  const energies = player.discard.filter((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)));
  if (targets.length === 0 || energies.length === 0) {
    logMessage(state, "Rosa's Encouragement: need Stage 2 Pokémon in play and Basic Energy in discard.");
    return;
  }
  if (targets.length === 1 && energies.length <= maxEnergy) {
    const target = targets[0]!;
    for (const energy of energies.slice(0, maxEnergy)) {
      const idx = player.discard.indexOf(energy);
      if (idx === -1) continue;
      player.discard.splice(idx, 1);
      attachEnergyToPokemon(state, playerId, energy, target);
    }
    return;
  }
  state.pendingAction = {
    type: "ROSAS_ENCOURAGEMENT",
    playerId,
    step: "TARGET",
    pickedEnergyIds: [],
    options: targets.map((entry) => entry.instanceId),
  };
  logMessage(state, "Rosa's Encouragement: choose a Stage 2 Pokémon.");
}

export function resolveRosaTarget(state: EngineState, playerId: PlayerId, pokemonId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ROSAS_ENCOURAGEMENT" || pending.playerId !== playerId || pending.step !== "TARGET") {
    return;
  }
  if (!pending.options.includes(pokemonId)) return;
  const player = getPlayer(state, playerId);
  const energies = player.discard.filter((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)));
  if (energies.length === 1) {
    const target = allPokemonInPlay(player).find((entry) => entry.instanceId === pokemonId);
    if (!target) return;
    const energy = energies[0]!;
    const idx = player.discard.indexOf(energy);
    player.discard.splice(idx, 1);
    attachEnergyToPokemon(state, playerId, energy, target);
    state.pendingAction = null;
    return;
  }
  state.pendingAction = {
    type: "ROSAS_ENCOURAGEMENT",
    playerId,
    step: "ENERGY",
    targetId: pokemonId,
    pickedEnergyIds: [],
    options: energies.map((entry) => entry.instanceId),
  };
  logMessage(state, "Rosa's Encouragement: choose Basic Energy from discard.");
}

export function resolveRosaEnergy(state: EngineState, playerId: PlayerId, energyId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ROSAS_ENCOURAGEMENT" || pending.playerId !== playerId || pending.step !== "ENERGY") {
    return;
  }
  if (!pending.options.includes(energyId) || !pending.targetId) return;
  const player = getPlayer(state, playerId);
  const target = allPokemonInPlay(player).find((entry) => entry.instanceId === pending.targetId);
  if (!target) return;
  const index = player.discard.findIndex((card) => card.instanceId === energyId);
  if (index === -1) return;
  const energy = player.discard.splice(index, 1)[0]!;
  attachEnergyToPokemon(state, playerId, energy, target);
  const picked = [...(pending.pickedEnergyIds ?? []), energyId];
  const remaining = player.discard.filter(
    (card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)) && !picked.includes(card.instanceId),
  );
  if (picked.length < 2 && remaining.length > 0) {
    state.pendingAction = {
      ...pending,
      pickedEnergyIds: picked,
      options: remaining.map((entry) => entry.instanceId),
    };
    logMessage(state, "Rosa's Encouragement: attach another Energy (optional).");
    return;
  }
  state.pendingAction = null;
}

export function applySurfer(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  if (!player.active || player.bench.length === 0) {
    logMessage(state, "Surfer: need an Active Pokémon and a Benched Pokémon.");
    return;
  }
  if (player.bench.length === 1) {
    switchActiveWithBench(state, playerId, player.bench[0]!.instanceId);
    drawUntilHand(state, playerId, 5);
    return;
  }
  state.pendingAction = {
    type: "SURFER",
    playerId,
    options: player.bench.map((entry) => entry.instanceId),
  };
  logMessage(state, "Surfer: choose a Benched Pokémon to switch with Active.");
}

export function resolveSurferBench(state: EngineState, playerId: PlayerId, benchId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "SURFER" || pending.playerId !== playerId) return;
  if (!pending.options.includes(benchId)) return;
  if (!switchActiveWithBench(state, playerId, benchId)) return;
  drawUntilHand(state, playerId, 5);
  state.pendingAction = null;
}

export function applySacredAsh(state: EngineState, playerId: PlayerId, count: number): void {
  const pokemon = discardPokemonMatching(state, playerId);
  if (pokemon.length === 0) {
    logMessage(state, "Sacred Ash: no Pokémon in discard.");
    return;
  }
  if (pokemon.length <= count) {
    shufflePokemonFromDiscardToDeck(state, playerId, pokemon);
    return;
  }
  state.pendingAction = {
    type: "PICK_DISCARD",
    playerId,
    options: pokemon.map((entry) => entry.instanceId),
    slotsRemaining: count,
    shuffleToDeck: true,
  };
  logMessage(state, `Sacred Ash: choose ${count} Pokémon from your discard pile.`);
}

function shufflePokemonFromDiscardToDeck(
  state: EngineState,
  playerId: PlayerId,
  cards: CardInstance[],
): void {
  const player = getPlayer(state, playerId);
  for (const card of cards) {
    const idx = player.discard.indexOf(card);
    if (idx === -1) continue;
    player.discard.splice(idx, 1);
    card.zone = Zone.Deck;
    card.damageCounters = 0;
    player.deck.push(card);
  }
  shufflePlayerDeck(state, playerId);
  logMessage(state, `Sacred Ash: shuffled ${cards.length} Pokémon into the deck.`);
}

export function applyTeamRocketTransceiver(state: EngineState, playerId: PlayerId): void {
  const matches = deckMatching(
    state,
    playerId,
    (def) => isSupporter(def) && def.name.toLowerCase().includes("team rocket"),
  );
  if (matches.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Team Rocket's Transceiver: no Team Rocket Supporter in deck.");
    return;
  }
  if (matches.length === 1) {
    addFromDeckToHand(state, playerId, matches[0]!.instanceId, "Transceiver");
    shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "TEAM_ROCKET_SUPPORTER_HAND",
    options: matches.map((entry) => entry.instanceId),
  };
  logMessage(state, "Team Rocket's Transceiver: choose a Team Rocket Supporter.");
}

export function applyLumioseCitySearch(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const player = getPlayer(state, playerId);
  if (state.turnFlags.stadiumOncePerTurnUsed) return;
  if (player.bench.length >= getMaxBenchSize(state, playerId)) return;
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.deck.splice(index, 1)[0]!;
  const def = getDefinitionSafe(state, card.definitionId);
  if (!isBasicPokemon(def)) {
    player.deck.splice(index, 0, card);
    return;
  }
  card.zone = Zone.Bench;
  card.ownerId = playerId;
  card.enteredPlayTurn = state.turnNumber;
  player.bench.push(card);
  applyRiskyRuinsOnBenchPlay(state, card, playerId);
  shufflePlayerDeck(state, playerId);
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(state, `${player.name} placed ${def.name} on Bench with Lumiose City — turn ends.`);
}

export function applyTrFactoryDraw(state: EngineState, playerId: PlayerId): void {
  if (!state.turnFlags.trFactoryDrawAvailable) return;
  drawCards(state, playerId, 2);
  state.turnFlags.trFactoryDrawAvailable = false;
  logMessage(state, "Team Rocket's Factory: drew 2 cards.");
}

export function onTeamRocketSupporterPlayed(state: EngineState, def: CardDefinition): void {
  if (!isTeamRocketSupporter(def)) return;
  state.turnFlags.playedTeamRocketSupporter = true;
  if (getStadiumKind(state) === "team_rocket_factory") {
    state.turnFlags.trFactoryDrawAvailable = true;
    logMessage(state, "Team Rocket's Factory: you may draw 2 cards.");
  }
}

export function canPlayTrainerBatch3Kind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));

  switch (kind) {
    case "trainer_rosas_encouragement":
      if (player.prizes.length <= opponent.prizes.length) {
        return { ok: false, reason: "Rosa's Encouragement: you must have more Prize cards than your opponent." };
      }
      if (
        !allPokemonInPlay(player).some((p) => isStage2(getDefinitionSafe(state, p.definitionId))) ||
        !player.discard.some((c) => isBasicEnergy(getDefinitionSafe(state, c.definitionId)))
      ) {
        return { ok: false, reason: "Rosa's Encouragement: need Stage 2 Pokémon and Basic Energy in discard." };
      }
      return { ok: true };
    case "trainer_briar":
      if (opponent.prizes.length !== 2) {
        return { ok: false, reason: "Briar: opponent must have exactly 2 Prize cards remaining." };
      }
      return { ok: true };
    case "trainer_surfer":
      if (!player.active || player.bench.length === 0) {
        return { ok: false, reason: "Surfer: need an Active Pokémon and a Benched Pokémon." };
      }
      return { ok: true };
    case "trainer_sacred_ash":
      if (discardPokemonMatching(state, playerId).length === 0) {
        return { ok: false, reason: "Sacred Ash: no Pokémon in your discard pile." };
      }
      return { ok: true };
    case "trainer_lanas_aid":
      if (lanaAidEligible(state, playerId).length === 0) {
        return { ok: false, reason: "Lana's Aid: no eligible cards in discard." };
      }
      return { ok: true };
    case "trainer_brocks_scouting":
      if (
        deckMatching(state, playerId, isBasicPokemon).length === 0 &&
        deckMatching(state, playerId, isEvolutionPokemon).length === 0
      ) {
        return { ok: false, reason: "Brock's Scouting: no Basic or Evolution Pokémon in deck." };
      }
      return { ok: true };
    case "trainer_team_rocket_transceiver":
      if (
        deckMatching(state, playerId, (d) => isSupporter(d) && d.name.toLowerCase().includes("team rocket")).length ===
        0
      ) {
        return { ok: false, reason: "Transceiver: no Team Rocket Supporter in deck." };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

/** Ruffian: discard a Pokémon Tool and a Special Energy from 1 opponent Pokémon. */
function applyRuffian(state: EngineState, playerId: PlayerId): void {
  const oppId = getOpponentId(playerId);
  const opponent = getPlayer(state, oppId);
  const hasSpecial = (mon: CardInstance) =>
    mon.attachedEnergy.some((e) => !isBasicEnergy(getDefinitionSafe(state, e.definitionId)));
  const targets = allPokemonInPlay(opponent).filter(
    (m) => (m.attachedTools?.length ?? 0) > 0 || hasSpecial(m),
  );
  if (targets.length === 0) {
    logMessage(state, "Ruffian: opponent has no Tool or Special Energy to discard.");
    return;
  }
  // ponytail: pick the most-loaded target (active counts as one of these); good enough vs optimal targeting.
  const target = targets.sort(
    (a, b) =>
      (b.attachedTools?.length ?? 0) + b.attachedEnergy.length -
      ((a.attachedTools?.length ?? 0) + a.attachedEnergy.length),
  )[0]!;
  const tool = (target.attachedTools ?? [])[0];
  if (tool) {
    target.attachedTools = (target.attachedTools ?? []).filter((t) => t !== tool);
    moveToDiscard(opponent, tool);
  }
  const special = target.attachedEnergy.find(
    (e) => !isBasicEnergy(getDefinitionSafe(state, e.definitionId)),
  );
  if (special) discardAttachedEnergy(state, oppId, target.instanceId, special.instanceId, false);
  logMessage(state, `Ruffian: discarded a Tool and a Special Energy from ${getDefinitionSafe(state, target.definitionId).name}.`);
}

/**
 * Transformation Tome.
 * ponytail: the printed card swaps an in-play Basic with a discard Basic,
 * keeping all attached state, and must be played 2 at once. Modelled as
 * "recur one Basic from discard onto the Bench" — the deck's real use is
 * refuelling N's attackers (Zekrom/Zorua) for Night Joker, which need no
 * energy on the Bench. Upgrade to the full swap if attachment transfer matters.
 */
function applyTransformationTome(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  if (player.bench.length >= getMaxBenchSize(state, playerId)) {
    logMessage(state, "Transformation Tome: Bench is full.");
    return;
  }
  const basics = player.discard.filter((c) => isBasicPokemon(getDefinitionSafe(state, c.definitionId)));
  if (basics.length === 0) {
    logMessage(state, "Transformation Tome: no Basic Pokémon in discard.");
    return;
  }
  const pick =
    basics.find((c) => getDefinitionSafe(state, c.definitionId).name.toLowerCase().startsWith("n's")) ??
    basics[0]!;
  const placed = placePokemonFromDiscardToBench(state, playerId, pick.instanceId);
  if (placed) {
    logMessage(state, `Transformation Tome: returned ${getDefinitionSafe(state, placed.definitionId).name} from discard to the Bench.`);
  }
}

export function applyTrainerBatch3Kind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  switch (effect.kind) {
    case "trainer_premium_power_pro":
      applyPremiumPowerPro(state, effect.amount);
      return;
    case "trainer_black_belt_training":
      applyBlackBeltTraining(state, effect.amount);
      return;
    case "trainer_ruffian":
      applyRuffian(state, playerId);
      return;
    case "trainer_transformation_tome":
      applyTransformationTome(state, playerId);
      return;
    case "trainer_lanas_aid":
      applyLanasAid(state, playerId, effect.count);
      return;
    case "trainer_brocks_scouting":
      applyBrocksScouting(state, playerId);
      return;
    case "trainer_rosas_encouragement":
      applyRosasEncouragement(state, playerId, effect.count);
      return;
    case "trainer_briar":
      applyBriar(state);
      return;
    case "trainer_surfer":
      applySurfer(state, playerId);
      return;
    case "trainer_sacred_ash":
      applySacredAsh(state, playerId, effect.count);
      return;
    case "trainer_team_rocket_transceiver":
      applyTeamRocketTransceiver(state, playerId);
      return;
    default:
      return;
  }
}

export function continueSacredAshDiscardPick(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "PICK_DISCARD" || pending.playerId !== playerId) return;
  const player = getPlayer(state, playerId);
  const index = player.discard.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.discard.splice(index, 1)[0]!;
  card.zone = Zone.Deck;
  card.damageCounters = 0;
  player.deck.push(card);

  const remainingSlots = (pending.slotsRemaining ?? 1) - 1;
  const remaining = discardPokemonMatching(state, playerId);
  if (remainingSlots > 0 && remaining.length > 0) {
    state.pendingAction = {
      type: "PICK_DISCARD",
      playerId,
      options: remaining.map((entry) => entry.instanceId),
      slotsRemaining: remainingSlots,
    };
    logMessage(state, "Sacred Ash: choose another Pokémon.");
    return;
  }
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, "Sacred Ash: shuffled chosen Pokémon into the deck.");
}
