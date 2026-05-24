import { isBasicPokemon, isAceSpec, isItemTrainer, isStadium, isSupporter, isTeamRocketPokemon, isTool } from "../models/definition";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import type { CardInstance } from "../models/instance";
import {
  canAttackThisTurn,
  canEvolveInto,
  canEvolvePokemonThisTurn,
  canPlaySupporterThisTurn,
  checkMulliganNeeded,
  checkWinCondition,
  countPrizeCards,
  createInitialGame,
  drawCards,
  drawOpeningHands,
  getDefinitionSafe,
  setupPrizes,
} from "./rules";
import { shufflePlayerDeck } from "./helpers";
import {
  assignBenchDamageCounter,
  chooseBenchDamage,
  chooseOpponentPokemonDamage,
  confirmDrawUntilHand,
  executeEffects,
  parseAbilityText,
  resolveReconDirectivePick,
  resolveSwitchWithBench,
  resolveSwitchTypedBenchToActive,
  continueRecoverToBenchPick,
  resolveMoveEnergyToBench,
  resolveChooseOpponentDamage,
  resolveAttachHandEnergyToPokemon,
  resolveSearchEvolutionPick,
  resolveBenchKnockouts,
  resolveChooseBlockedAttack,
  selectMoveDamageSource,
  selectMoveDamageTarget,
  selectRedistributeOpponentSource,
  selectRedistributeOpponentTarget,
} from "./effects";
import { transferPokemonStateOntoEvolution, canAttachToolToPokemon, attachToolToPokemon, discardPokemonAttachments } from "./effects/toolEffects";
import {
  canUseGrandTree,
  resolveGrandTreeBasic,
  resolveGrandTreeStage1,
  resolveGrandTreeStage2,
  skipGrandTreeStage2,
  startGrandTreeFlow,
} from "./effects/grandTreeEffects";
import { logStadiumOnPlay, getMaxBenchSize, canUseLumioseCity, getLumioseDeckOptions } from "./effects/stadiumEffects";
import { markMovedFromBenchToActive } from "./effects/pokemonZoneHelpers";
import {
  canPlayToolFromHand,
  canPlayTrainerCardFromHand,
  getAceSpecPlayBlockReason,
  getItemPlayBlockReason,
  getToolPlayBlockReason,
} from "./effects/playRestrictions";
import { parseTrainerText } from "./effects/trainerText";
import {
  activatePendingModifiersForTurnStart,
  canPokemonAttack,
  canPokemonRetreat,
  clearModifiersWhenTurnEnds,
} from "./effects/modifiers";
import { canPokemonAttackWithPassives } from "./effects/passiveRules";
import {
  applyAttackDamagePhase,
  applyCopiedBenchAttack,
  applyFestivalGroundsBonusIfEligible,
  finishDiscardEnergyForAttack,
  finishDiscardSupportersForAttack,
  isAttackBlockedThisTurn,
  listDiscardableEnergy,
  listDiscardableNamedSupporters,
  resolveDiscardHandSupporterForAttack,
  resolveDiscardOwnEnergyForAttack,
  startAttackIfCopyPending,
  startAttackIfDiscardPending,
  canStartAttack,
} from "./effects/attackFlow";
import {
  abilityRequiresKnockOutSelf,
  canUseAbilityNow,
  getExecutableAbilityEffects,
  handCardMatchesBasicEnergyType,
  hasActivatableAbility,
  markAbilityUsed,
} from "./effects/abilities";
import {
  applyKnockOutSelfAfterAbility,
  getModifiedPrizeCount,
  onBenchPlay,
  onEnergyAttached,
  onEvolvedFromHand,
  onKnockOut,
  onOpponentEvolve,
  onRetreat,
  runPokemonCheckup,
} from "./effects/abilityHooks";
import {
  applyRareCandy,
  applyRiskyRuinsDamage,
  applyTrainerEffect,
  applyWallysCompassion,
  attachEnergyToPokemon,
  canPlayTrainerEffect,
  completeUltraBallDiscard,
  continueIonoHandBottom,
  continueNightStretcherPick,
  discardAttachedEnergy,
  maybeCrispinOptionalDiscard,
  resolveDeckPick,
  resolveEnergySwitchPokemon,
  resolveEnhancedHammerEnergy,
  resolveEnhancedHammerPokemon,
  resolveHildaPick,
} from "./trainerEffects";
import {
  resolveCiphermaniacPick,
  resolveColressPick,
  resolveDawnPick,
  resolveFightingGongPick,
  resolveGiovanniOpponentBench,
  resolveGiovanniOwnBench,
  resolveNsPpUpEnergy,
  resolveNsPpUpTarget,
  continueToolScrapperPick,
} from "./effects/trainerMetaEffects";
import {
  applyLumioseCitySearch,
  applyTrFactoryDraw,
  continueSacredAshDiscardPick,
  onTeamRocketSupporterPlayed,
  resolveBrockMode,
  resolveBrockPick,
  resolveLanasAidPick,
  resolveRosaEnergy,
  resolveRosaTarget,
  resolveSurferBench,
} from "./effects/trainerBatch3Effects";
import {
  continueBugCatchingPick,
  continueMiracleHeadsetPick,
  continueRotoStickPick,
  continueSecretBoxDiscard,
  continueSecretBoxSearch,
  finishBugCatchingSet,
  finishMiracleHeadset,
  finishRotoStick,
} from "./effects/trainerBatch5Effects";
import {
  resolvePrimeCatcherOpponentBench,
  resolvePrimeCatcherOwnBench,
} from "./effects/trainerBatch7Effects";
import {
  canAttachSpecialEnergyToPokemon,
  discardIgnitionEnergyAtEndOfTurn,
  onSpecialEnergyAttachedFromHand,
  purgeInvalidAttachedSpecialEnergy,
} from "./effects/specialEnergyEffects";
import { isTeraPokemon } from "../models/definition";
import { canAffordAttack, canAffordRetreat, payRetreatCost } from "./energy";
import { createRng } from "./rng";
import {
  allPokemonInPlay,
  emptyTurnFlags,
  getDefinition,
  getOpponentId,
  getPlayer,
  isKnockedOut,
  moveToDiscard,
  removeFromHand,
  type EngineState,
  type GameAction,
} from "./types";

function log(state: EngineState, message: string): void {
  state.log.push(message);
}

function finishIfWinner(state: EngineState): void {
  const winner = checkWinCondition(state);
  if (winner) {
    state.winnerId = winner;
    state.phase = GamePhase.Finished;
    log(state, `${getPlayer(state, winner).name} wins the game!`);
  }
}

function advanceMulliganAfterPlayer(state: EngineState, playerId: PlayerId): void {
  if (playerId === PlayerId.P1) {
    state.pendingMulliganPlayerId = PlayerId.P2;
    if (!checkMulliganNeeded(state, PlayerId.P2)) {
      state.pendingMulliganPlayerId = null;
      state.phase = GamePhase.PlaceActive;
      log(state, "Mulligan phase complete. Place your Active Pokémon.");
    }
    return;
  }

  state.pendingMulliganPlayerId = null;
  state.phase = GamePhase.PlaceActive;
  log(state, "Mulligan phase complete. Place your Active Pokémon.");
}

function advanceMulligan(state: EngineState): void {
  if (state.pendingMulliganPlayerId === PlayerId.P1) {
    if (checkMulliganNeeded(state, PlayerId.P1)) return;
    advanceMulliganAfterPlayer(state, PlayerId.P1);
    return;
  }

  if (state.pendingMulliganPlayerId === PlayerId.P2) {
    if (checkMulliganNeeded(state, PlayerId.P2)) return;
    advanceMulliganAfterPlayer(state, PlayerId.P2);
  }
}

function handleSetupStart(state: EngineState, seed?: number): EngineState {
  if (state.phase !== GamePhase.Setup) return state;
  let next = structuredClone(state);
  if (seed !== undefined) next.rngSeed = seed;
  next = drawOpeningHands(next);
  advanceMulligan(next);
  return next;
}

function handleMulligan(state: EngineState, playerId: PlayerId): EngineState {
  if (state.phase !== GamePhase.Mulligan || state.pendingMulliganPlayerId !== playerId) {
    return state;
  }
  const next = structuredClone(state);
  const player = getPlayer(next, playerId);
  if (!checkMulliganNeeded(next, playerId)) {
    advanceMulliganAfterPlayer(next, playerId);
    return next;
  }

  const returned = [...player.hand];
  player.hand = [];
  for (const card of returned) {
    card.zone = Zone.Deck;
    player.deck.push(card);
  }
  const rng = createRng(next.rngSeed + returned.length + player.deck.length);
  player.deck = rng.shuffle(player.deck);

  for (let i = 0; i < 7; i += 1) {
    const card = player.deck.shift();
    if (card) {
      card.zone = Zone.Hand;
      player.hand.push(card);
    }
  }

  log(next, `${player.name} mulligans.`);
  if (!checkMulliganNeeded(next, playerId)) {
    advanceMulliganAfterPlayer(next, playerId);
  }
  return next;
}

function handlePlaceActive(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  if (state.phase !== GamePhase.PlaceActive && state.phase !== GamePhase.PlaceBench) return state;
  const player = getPlayer(state, playerId);
  if (player.active) return state;
  const card = removeFromHand(player, instanceId);
  if (!card) return state;
  const def = getDefinitionSafe(state, card.definitionId);
  if (!isBasicPokemon(def)) return state;

  player.active = card;
  card.zone = Zone.Active;
  card.enteredPlayTurn = state.turnNumber;
  log(state, `${player.name} placed ${def.name} as Active Pokémon.`);

  if (getPlayer(state, PlayerId.P1).active && getPlayer(state, PlayerId.P2).active) {
    state.phase = GamePhase.PlaceBench;
    log(state, "Optional: place Basic Pokémon to bench, then start the game.");
  }
  return state;
}

function handlePlaceBench(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  if (state.phase !== GamePhase.PlaceBench) return state;
  return playBasicToBench(state, playerId, instanceId);
}

function playBasicToBench(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): EngineState {
  const player = getPlayer(state, playerId);
  if (player.bench.length >= getMaxBenchSize(state, playerId)) return state;
  const card = removeFromHand(player, instanceId);
  if (!card) return state;
  const def = getDefinitionSafe(state, card.definitionId);
  if (!isBasicPokemon(def)) return state;
  card.zone = Zone.Bench;
  card.ownerId = playerId;
  card.enteredPlayTurn = state.turnNumber;
  player.bench.push(card);
  log(state, `${player.name} placed ${def.name} on the bench.`);
  if (state.phase === GamePhase.Active) {
    applyRiskyRuinsDamage(state, card);
    onBenchPlay(state, playerId, card);
  }
  return state;
}

function handlePlayBasicToBench(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  return playBasicToBench(state, playerId, instanceId);
}

function startGameIfReady(state: EngineState): EngineState {
  const next = structuredClone(state);
  if (
    getPlayer(next, PlayerId.P1).active &&
    getPlayer(next, PlayerId.P2).active &&
    next.phase === GamePhase.PlaceBench
  ) {
    let withPrizes = setupPrizes(next);
    withPrizes.phase = GamePhase.Active;
    withPrizes.turnNumber = 1;
    withPrizes.currentPlayerId = withPrizes.firstPlayerId;
    withPrizes.turnFlags = emptyTurnFlags();
    log(withPrizes, "Game started!");
    return withPrizes;
  }
  return next;
}

function handleDraw(state: EngineState, playerId: PlayerId): EngineState {
  const next = structuredClone(state);
  const player = getPlayer(next, playerId);
  const card = player.deck.shift();
  if (!card) {
    next.winnerId = getOpponentId(playerId);
    next.phase = GamePhase.Finished;
    log(next, `${player.name} cannot draw. Deck out!`);
    return next;
  }
  card.zone = Zone.Hand;
  player.hand.push(card);
  log(next, `${player.name} draws a card.`);
  return next;
}

function handleAttachEnergy(
  state: EngineState,
  playerId: PlayerId,
  energyId: string,
  targetId: string,
): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.turnFlags.energyAttached) return state;
  const next = structuredClone(state);
  const player = getPlayer(next, playerId);
  const energy = removeFromHand(player, energyId);
  if (!energy) return state;
  const energyDef = getDefinitionSafe(next, energy.definitionId);
  if (energyDef.supertype !== "Energy") return state;

  const target =
    player.active?.instanceId === targetId
      ? player.active
      : player.bench.find((card) => card.instanceId === targetId);
  if (!target) return state;

  const attachCheck = canAttachSpecialEnergyToPokemon(next, energyDef, target);
  if (!attachCheck.ok) {
    player.hand.push(energy);
    energy.zone = Zone.Hand;
    log(next, attachCheck.reason);
    return next;
  }

  energy.zone = Zone.Active;
  target.attachedEnergy.push(energy);
  next.turnFlags.energyAttached = true;
  log(next, `${player.name} attached ${energyDef.name} to ${getDefinitionSafe(next, target.definitionId).name}.`);
  onEnergyAttached(next, playerId, target);
  onSpecialEnergyAttachedFromHand(next, playerId, energy, target);
  return next;
}

function handleAttachTool(
  state: EngineState,
  playerId: PlayerId,
  toolId: string,
  targetId: string,
): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction) return state;
  const toolBlockReason = getToolPlayBlockReason(state, playerId);
  if (toolBlockReason) {
    log(state, toolBlockReason);
    return state;
  }
  const player = getPlayer(state, playerId);
  const tool = removeFromHand(player, toolId);
  if (!tool) return state;
  const toolDef = getDefinitionSafe(state, tool.definitionId);
  if (!isTool(toolDef)) {
    player.hand.push(tool);
    return state;
  }

  const target =
    player.active?.instanceId === targetId
      ? player.active
      : player.bench.find((card) => card.instanceId === targetId);
  if (!target || !canAttachToolToPokemon(state, playerId, toolDef, target)) {
    player.hand.push(tool);
    return state;
  }

  if (!attachToolToPokemon(state, playerId, tool, target)) {
    player.hand.push(tool);
    return state;
  }
  return state;
}

function handlePlayTrainer(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction) return state;
  const player = getPlayer(state, playerId);
  const card = player.hand.find((entry) => entry.instanceId === instanceId);
  if (!card) return state;
  const def = getDefinitionSafe(state, card.definitionId);
  if (def.supertype !== "Trainer") return state;
  if (isSupporter(def) && state.turnFlags.supporterPlayed) {
    return state;
  }
  const parsedForPlay = parseTrainerText(def);
  const isProton =
    isSupporter(def) &&
    parsedForPlay.effects.some((effect) => effect.kind === "trainer_proton");
  if (isSupporter(def) && !canPlaySupporterThisTurn(state, playerId) && !isProton) {
    log(state, "The player who goes first cannot play Supporter cards on their first turn.");
    return state;
  }
  const itemBlockReason = getItemPlayBlockReason(state, playerId);
  if (isItemTrainer(def) && itemBlockReason) {
    log(state, itemBlockReason);
    return state;
  }
  if (isItemTrainer(def) && isAceSpec(def)) {
    const aceBlockReason = getAceSpecPlayBlockReason(state, playerId);
    if (aceBlockReason) {
      log(state, aceBlockReason);
      return state;
    }
  }
  if (isTool(def)) {
    log(state, "Attach Tools using the Attach Tool action on a Pokémon in play.");
    return state;
  }

  const playCheck = canPlayTrainerEffect(state, playerId, def);
  if (!playCheck.ok) {
    log(state, playCheck.reason);
    return state;
  }

  const removed = removeFromHand(player, instanceId);
  if (!removed) return state;

  if (isStadium(def)) {
    if (state.stadium) {
      moveToDiscard(getPlayer(state, state.stadiumOwnerId ?? playerId), state.stadium);
    }
    state.stadium = removed;
    state.stadiumOwnerId = playerId;
    removed.zone = Zone.Stadium;
    log(state, `${player.name} played Stadium ${def.name}.`);
    logStadiumOnPlay(state, def);
  } else {
    moveToDiscard(player, removed);
    log(state, `${player.name} played ${def.name}.`);
    applyTrainerEffect(state, playerId, def);
  }

  if (isSupporter(def)) state.turnFlags.supporterPlayed = true;
  if (isSupporter(def)) onTeamRocketSupporterPlayed(state, def);
  return state;
}

function handleEvolve(
  state: EngineState,
  playerId: PlayerId,
  evolutionId: string,
  targetId: string,
): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  const player = getPlayer(state, playerId);
  const evolution = removeFromHand(player, evolutionId);
  if (!evolution) return state;
  const evoDef = getDefinitionSafe(state, evolution.definitionId);

  const replaceOnTarget = (target: typeof player.active) => {
    if (!target || target.instanceId !== targetId) return false;
    if (!canEvolvePokemonThisTurn(state, target)) return false;
    const targetDef = getDefinitionSafe(state, target.definitionId);
    if (!canEvolveInto(targetDef, evoDef)) return false;
    transferPokemonStateOntoEvolution(target, evolution, playerId);
    return true;
  };

  if (player.active && replaceOnTarget(player.active)) {
    player.active = evolution;
    purgeInvalidAttachedSpecialEnergy(state, evolution);
    log(state, `${player.name} evolved to ${evoDef.name}.`);
    onEvolvedFromHand(state, playerId, evolution);
    onOpponentEvolve(state, playerId, evolution);
    return state;
  }

  const benchIndex = player.bench.findIndex((card) => card.instanceId === targetId);
  if (benchIndex >= 0 && replaceOnTarget(player.bench[benchIndex])) {
    player.bench[benchIndex] = evolution;
    purgeInvalidAttachedSpecialEnergy(state, evolution);
    log(state, `${player.name} evolved bench Pokémon to ${evoDef.name}.`);
    onEvolvedFromHand(state, playerId, evolution);
    onOpponentEvolve(state, playerId, evolution);
    return state;
  }

  player.hand.push(evolution);
  return state;
}

function finishAttackAfterDamagePhase(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
  result: ReturnType<typeof applyAttackDamagePhase>,
): EngineState {
  if (result === "knockout") {
    applyFestivalGroundsBonusIfEligible(state, playerId, attackName);
    if (!state.turnFlags.bonusAttackAvailable) {
      state.turnFlags.attacked = true;
    }
    return handleKnockout(state, getOpponentId(playerId));
  }
  if (result === "pending") return state;
  if (state.turnFlags.bonusAttackAvailable) {
    return finishAttackAndEffects(state, playerId);
  }
  state.turnFlags.attacked = true;
  return finishAttackAndEffects(state, playerId);
}

function handleChooseBenchAttack(
  state: EngineState,
  playerId: PlayerId,
  benchPokemonId: string,
  attackName: string,
): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "COPY_BENCH_ATTACK" || pending.playerId !== playerId) return state;
  const match = pending.options.find(
    (entry) => entry.benchPokemonId === benchPokemonId && entry.attackName === attackName,
  );
  if (!match) return state;
  const result = applyCopiedBenchAttack(
    state,
    playerId,
    benchPokemonId,
    attackName,
    pending.wrapperAttackName,
  );
  return finishAttackAfterDamagePhase(state, playerId, pending.wrapperAttackName, result);
}

function handleResumeAttackDamage(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
  extraBonusDamage: number,
): EngineState {
  const result = applyAttackDamagePhase(state, playerId, attackName, extraBonusDamage);
  return finishAttackAfterDamagePhase(state, playerId, attackName, result);
}

function handleDiscardOwnEnergyForAttack(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  energyId: string,
): EngineState {
  const result = resolveDiscardOwnEnergyForAttack(state, playerId, pokemonId, energyId);
  if (result === "failed") return state;
  if (result === "ready") {
    const payload = finishDiscardEnergyForAttack(state, playerId);
    if (!payload) return state;
    return handleResumeAttackDamage(state, playerId, payload.attackName, payload.bonusDamage);
  }
  return state;
}

function handleDiscardHandSupporterForAttack(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): EngineState {
  if (resolveDiscardHandSupporterForAttack(state, playerId, instanceId) === "failed") {
    return state;
  }
  return state;
}

function handleChooseBlockedAttack(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
): EngineState {
  if (resolveChooseBlockedAttack(state, playerId, attackName) === "failed") {
    return state;
  }
  return finishAttackAndEffects(state, playerId);
}

function handleAttachHandEnergyToPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  energyId: string,
): EngineState {
  if (resolveAttachHandEnergyToPokemon(state, playerId, pokemonId, energyId) === "failed") {
    return state;
  }
  return state;
}

function handleChooseOpponentDamage(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): EngineState {
  const result = resolveChooseOpponentDamage(state, playerId, targetId);
  if (result === "failed") return state;
  if (result === "pending") return state;
  return finishAttackAndEffects(state, playerId);
}

function handleMoveEnergyToBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  const result = resolveMoveEnergyToBench(state, playerId, benchInstanceId);
  if (result === "failed") return state;
  return finishAttackAndEffects(state, playerId);
}

function handleSwitchWithBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  if (state.pendingAction?.type === "SWITCH_TYPED_BENCH") {
    const result = resolveSwitchTypedBenchToActive(state, playerId, benchInstanceId);
    if (result === "failed") return state;
    resolveBenchKnockouts(state);
    finishIfWinner(state);
    return state;
  }

  const result = resolveSwitchWithBench(state, playerId, benchInstanceId);
  if (result === "failed") return state;
  return finishAttackAndEffects(state, playerId);
}

function handleSwitchOpponentActive(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  if (state.pendingAction?.type !== "BOSS_ORDERS" || state.pendingAction.playerId !== playerId) {
    return state;
  }
  const opponent = getPlayer(state, getOpponentId(playerId));
  const benchIndex = opponent.bench.findIndex((card) => card.instanceId === benchInstanceId);
  if (benchIndex === -1 || !opponent.active) return state;

  const incoming = opponent.bench.splice(benchIndex, 1)[0]!;
  const outgoing = opponent.active;
  outgoing.zone = Zone.Bench;
  opponent.bench.push(outgoing);
  incoming.zone = Zone.Active;
  opponent.active = incoming;
  state.pendingAction = null;
  log(
    state,
    `${getPlayer(state, playerId).name} switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
  return state;
}

function handleKnockout(state: EngineState, defenderId: PlayerId): EngineState {
  const attackerId = getOpponentId(defenderId);
  const defender = getPlayer(state, defenderId);
  const attacker = getPlayer(state, attackerId);
  const knockedOut = defender.active;
  if (!knockedOut) return state;

  const def = getDefinitionSafe(state, knockedOut.definitionId);
  if (isTeamRocketPokemon(def)) {
    state.teamRocketKnockedOutSinceMyLastTurn[defenderId] = true;
  }
  state.ownPokemonKnockedOutOpponentLastTurn[defenderId] = true;
  const basePrize = countPrizeCards(def);
  const prizeCount = getModifiedPrizeCount(state, knockedOut, attackerId, basePrize);
  let extraPrizes = 0;
  if (
    state.turnFlags.briarExtraPrizeOnTeraKo &&
    state.turnFlags.attacked &&
    attacker.active &&
    isTeraPokemon(getDefinitionSafe(state, attacker.active.definitionId))
  ) {
    extraPrizes = 1;
    log(state, "Briar: took 1 extra Prize card.");
  }
  onKnockOut(state, knockedOut, attackerId);
  for (let i = 0; i < prizeCount + extraPrizes; i += 1) {
    const prize = attacker.prizes.shift();
    if (prize) {
      prize.zone = Zone.Hand;
      attacker.hand.push(prize);
    }
  }

  discardPokemonAttachments(state, defender, knockedOut);
  moveToDiscard(defender, knockedOut);
  defender.active = null;

  log(state, `${def.name} was Knocked Out! ${attacker.name} took ${prizeCount + extraPrizes} prize card(s).`);

  if (defender.bench.length > 0) {
    state.pendingAction = { type: "PROMOTE", playerId: defenderId };
    log(state, `${defender.name} must promote a benched Pokémon.`);
  } else {
    finishIfWinner(state);
  }
  return state;
}

function attachAbilityKnockOutSource(state: EngineState, pokemonId: string): void {
  const pending = state.pendingAction;
  if (!pending) return;
  if (pending.type === "CHOOSE_OPPONENT_POKEMON_DAMAGE") {
    state.pendingAction = { ...pending, knockOutSourceId: pokemonId };
    return;
  }
  if (pending.type === "CHOOSE_BENCH_DAMAGE") {
    state.pendingAction = { ...pending, knockOutSourceId: pokemonId };
  }
}

function finishAbilitySelfKnockOut(
  state: EngineState,
  playerId: PlayerId,
  pokemon: CardInstance,
): void {
  applyKnockOutSelfAfterAbility(state, pokemon);
  const player = getPlayer(state, playerId);
  if (player.active?.instanceId === pokemon.instanceId && isKnockedOut(state, player.active)) {
    handleKnockout(state, playerId);
  }
}

function handleRetreat(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction || state.turnFlags.retreated) return state;

  const player = getPlayer(state, playerId);
  if (!player.active) return state;
  if (!canPokemonRetreat(player.active)) {
    log(state, "Active Pokémon can't retreat this turn.");
    return state;
  }

  const benchIndex = player.bench.findIndex((card) => card.instanceId === benchInstanceId);
  if (benchIndex === -1) return state;
  if (!canAffordRetreat(state, player.active)) return state;

  if (!payRetreatCost(state, player, player.active)) return state;

  const incoming = player.bench.splice(benchIndex, 1)[0]!;
  const outgoing = player.active;
  outgoing.zone = Zone.Bench;
  player.bench.push(outgoing);
  incoming.zone = Zone.Active;
  player.active = incoming;
  state.turnFlags.retreated = true;
  markMovedFromBenchToActive(state, incoming.instanceId);

  log(
    state,
    `${player.name} retreated ${getDefinitionSafe(state, outgoing.definitionId).name} and sent out ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
  onRetreat(state, playerId, outgoing);
  return state;
}

function handlePromoteBench(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const player = getPlayer(state, playerId);
  if (player.active) return state;
  const index = player.bench.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return state;
  const promoted = player.bench.splice(index, 1)[0];
  promoted.zone = Zone.Active;
  player.active = promoted;
  if (state.pendingAction?.type === "PROMOTE" && state.pendingAction.playerId === playerId) {
    state.pendingAction = null;
  }
  log(state, `${player.name} promoted ${getDefinitionSafe(state, promoted.definitionId).name} to Active.`);
  finishIfWinner(state);
  return tryAutoEndTurnIfAttacked(state);
}

function finishAttackAndEffects(state: EngineState, playerId: PlayerId): EngineState {
  resolveBenchKnockouts(state);
  const opponent = getPlayer(state, getOpponentId(playerId));
  if (opponent.active && isKnockedOut(state, opponent.active)) {
    return handleKnockout(state, getOpponentId(playerId));
  }
  finishIfWinner(state);
  return tryAutoEndTurnIfAttacked(state);
}

function tryAutoEndTurnIfAttacked(state: EngineState): EngineState {
  if (state.phase !== GamePhase.Active) return state;
  if (!state.turnFlags.attacked) return state;
  if (state.pendingAction) return state;
  if (state.winnerId) return state;
  return handleEndTurn(state);
}

function handleAttack(state: EngineState, playerId: PlayerId, attackName: string): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.turnFlags.attacked || !canAttackThisTurn(state)) return state;
  if (state.pendingAction) return state;
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  if (!player.active || !opponent.active) return state;

  const attackerDef = getDefinitionSafe(state, player.active.definitionId);
  const attack = attackerDef.attacks?.find((entry) => entry.name === attackName);
  if (!attack || !canAffordAttack(state, player.active, attack)) return state;
  if (!canPokemonAttackWithPassives(state, player.active, canPokemonAttack(player.active))) {
    log(state, "This Pokémon can't attack this turn.");
    return state;
  }
  if (!canStartAttack(state, playerId, attackName)) {
    const active = player.active;
    if (active && isAttackBlockedThisTurn(active, attackName)) {
      log(state, `${attackName} can't be used this turn.`);
    } else {
      log(state, "Can't use this attack during your first turn when going second.");
    }
    return state;
  }

  if (startAttackIfCopyPending(state, playerId, attackName)) {
    return state;
  }

  if (startAttackIfDiscardPending(state, playerId, attackName)) {
    return state;
  }

  if (state.turnFlags.bonusAttackAvailable) {
    state.turnFlags.bonusAttackAvailable = false;
  }

  const result = applyAttackDamagePhase(state, playerId, attackName, 0);
  return finishAttackAfterDamagePhase(state, playerId, attackName, result);
}

function finishAbilityExecution(
  state: EngineState,
  playerId: PlayerId,
  pokemon: CardInstance,
  abilityName: string,
): EngineState {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  const ability = def.abilities?.find((entry) => entry.name === abilityName);
  if (!ability) return state;
  const parsed = parseAbilityText(ability);
  markAbilityUsed(state, pokemon, abilityName, parsed);
  log(state, `${def.name} used ${abilityName}.`);

  const ctx = {
    playerId,
    sourcePokemon: pokemon,
    opponentId: getOpponentId(playerId),
  };
  const executable = getExecutableAbilityEffects(parsed.effects);
  const result = executeEffects(state, ctx, executable);
  if (result === "pending") {
    if (abilityRequiresKnockOutSelf(parsed.effects)) {
      attachAbilityKnockOutSource(state, pokemon.instanceId);
    }
    return state;
  }
  if (abilityRequiresKnockOutSelf(parsed.effects)) {
    finishAbilitySelfKnockOut(state, playerId, pokemon);
  }
  resolveBenchKnockouts(state);
  finishIfWinner(state);
  return state;
}

function handleUseAbility(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  abilityName: string,
): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction) return state;

  const player = getPlayer(state, playerId);
  const pokemon = allPokemonInPlay(player).find((entry) => entry.instanceId === pokemonId);
  if (!pokemon) return state;

  const def = getDefinitionSafe(state, pokemon.definitionId);
  const ability = def.abilities?.find((entry) => entry.name === abilityName);
  if (!ability) return state;

  const parsed = parseAbilityText(ability);
  if (!canUseAbilityNow(state, pokemon, parsed)) return state;

  if (parsed.conditions.some((condition) => condition.type === "discard_from_hand_to_use")) {
    state.pendingAction = {
      type: "ABILITY_DISCARD_HAND",
      playerId,
      pokemonId,
      abilityName,
    };
    log(state, `${def.name}: discard a card from your hand to use ${abilityName}.`);
    return state;
  }

  const handEnergyReq = parsed.effects.find((effect) => effect.kind === "require_hand_energy_in_active");
  if (handEnergyReq && "energyType" in handEnergyReq) {
    state.pendingAction = {
      type: "ABILITY_DISCARD_HAND_ENERGY",
      playerId,
      pokemonId,
      abilityName,
      energyType: handEnergyReq.energyType,
    };
    log(
      state,
      `${def.name}: discard a Basic ${handEnergyReq.energyType} Energy from your hand to use ${abilityName}.`,
    );
    return state;
  }

  return finishAbilityExecution(state, playerId, pokemon, abilityName);
}

function handleAssignBenchDamage(state: EngineState, playerId: PlayerId, targetId: string): EngineState {
  const pending = state.pendingAction;
  const attackName =
    pending?.type === "DISTRIBUTE_BENCH_DAMAGE" ? pending.attackName : undefined;
  const result = assignBenchDamageCounter(state, playerId, targetId);
  if (result === "failed") return state;
  if (result === "pending") return state;
  if (attackName) {
    return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
  }
  return finishAttackAndEffects(state, playerId);
}

function handleChooseBenchDamageTarget(state: EngineState, playerId: PlayerId, targetId: string): EngineState {
  const pending = state.pendingAction;
  const attackName = pending?.type === "CHOOSE_BENCH_DAMAGE" ? pending.attackName : undefined;
  const knockOutSourceId =
    pending?.type === "CHOOSE_BENCH_DAMAGE" ? pending.knockOutSourceId : undefined;
  const result = chooseBenchDamage(state, playerId, targetId);
  if (result === "failed") return state;
  if (knockOutSourceId) {
    const player = getPlayer(state, playerId);
    const source = allPokemonInPlay(player).find((entry) => entry.instanceId === knockOutSourceId);
    if (source) finishAbilitySelfKnockOut(state, playerId, source);
  }
  resolveBenchKnockouts(state);
  finishIfWinner(state);
  if (attackName) {
    return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
  }
  return state;
}

function handleChooseOpponentPokemonDamageTarget(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): EngineState {
  const pending = state.pendingAction;
  const attackName =
    pending?.type === "CHOOSE_OPPONENT_POKEMON_DAMAGE" ? pending.attackName : undefined;
  const knockOutSourceId =
    pending?.type === "CHOOSE_OPPONENT_POKEMON_DAMAGE" ? pending.knockOutSourceId : undefined;
  const result = chooseOpponentPokemonDamage(state, playerId, targetId);
  if (result === "failed") return state;
  if (knockOutSourceId) {
    const player = getPlayer(state, playerId);
    const source = allPokemonInPlay(player).find((entry) => entry.instanceId === knockOutSourceId);
    if (source) finishAbilitySelfKnockOut(state, playerId, source);
  }
  resolveBenchKnockouts(state);
  finishIfWinner(state);
  if (attackName) {
    return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
  }
  return state;
}

function handleMoveDamageSource(state: EngineState, playerId: PlayerId, sourceId: string): EngineState {
  if (selectMoveDamageSource(state, playerId, sourceId) === "failed") return state;
  return state;
}

function handleMoveDamageTarget(state: EngineState, playerId: PlayerId, targetId: string): EngineState {
  const pending = state.pendingAction;
  const attackName = pending?.type === "MOVE_DAMAGE" ? pending.attackName : undefined;
  if (selectMoveDamageTarget(state, playerId, targetId) === "failed") return state;
  resolveBenchKnockouts(state);
  finishIfWinner(state);
  if (attackName) {
    return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
  }
  return tryAutoEndTurnIfAttacked(state);
}

function handleSelectRedistributeSource(state: EngineState, playerId: PlayerId, sourceId: string): EngineState {
  if (selectRedistributeOpponentSource(state, playerId, sourceId) === "failed") return state;
  return state;
}

function handleSelectRedistributeTarget(state: EngineState, playerId: PlayerId, targetId: string): EngineState {
  const pending = state.pendingAction;
  const attackName =
    pending?.type === "REDISTRIBUTE_OPPONENT_COUNTERS" ? pending.attackName : undefined;
  if (selectRedistributeOpponentTarget(state, playerId, targetId) === "failed") return state;
  resolveBenchKnockouts(state);
  finishIfWinner(state);
  if (state.pendingAction === null && attackName) {
    return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
  }
  if (state.pendingAction === null && state.turnFlags.attacked) {
    return finishAttackAndEffects(state, playerId);
  }
  return state;
}

function handleConfirmDrawUntilHand(state: EngineState, playerId: PlayerId): EngineState {
  const pending = state.pendingAction;
  const attackName = pending?.type === "DRAW_UNTIL_HAND" ? pending.attackName : undefined;
  if (confirmDrawUntilHand(state, playerId) === "failed") return state;
  if (attackName) {
    return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
  }
  if (state.turnFlags.attacked) {
    return finishAttackAndEffects(state, playerId);
  }
  return state;
}

function handleSelectHandDiscard(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (
    (pending?.type === "ABILITY_DISCARD_HAND" || pending?.type === "ABILITY_DISCARD_HAND_ENERGY") &&
    pending.playerId === playerId
  ) {
    const player = getPlayer(state, playerId);
    const pokemon = allPokemonInPlay(player).find((entry) => entry.instanceId === pending.pokemonId);
    if (!pokemon) return state;
    const card = player.hand.find((entry) => entry.instanceId === instanceId);
    if (!card) return state;
    if (
      pending.type === "ABILITY_DISCARD_HAND_ENERGY" &&
      !handCardMatchesBasicEnergyType(state, card, pending.energyType)
    ) {
      return state;
    }
    removeFromHand(player, instanceId);
    moveToDiscard(player, card);
    state.pendingAction = null;
    return finishAbilityExecution(state, playerId, pokemon, pending.abilityName);
  }

  if (pending?.type !== "ULTRA_BALL_DISCARD" || pending.playerId !== playerId) return state;
  if (pending.selectedIds.includes(instanceId)) return state;

  const player = getPlayer(state, playerId);
  if (!player.hand.some((card) => card.instanceId === instanceId)) return state;

  pending.selectedIds.push(instanceId);
  if (pending.selectedIds.length >= 2) {
    completeUltraBallDiscard(state, playerId);
  } else {
    log(state, "Ultra Ball: choose another card to discard.");
  }
  return state;
}

function handlePickDeckCard(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type === "RECON_DIRECTIVE" && pending.playerId === playerId) {
    if (resolveReconDirectivePick(state, playerId, instanceId) === "failed") return state;
    return state;
  }
  if (pending?.type === "HILDA" && pending.playerId === playerId) {
    if (!pending.options.includes(instanceId)) return state;
    resolveHildaPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type === "DAWN" && pending.playerId === playerId) {
    if (!pending.options.includes(instanceId)) return state;
    resolveDawnPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type === "COLRESS" && pending.playerId === playerId) {
    if (!pending.options.includes(instanceId)) return state;
    resolveColressPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type === "CIPHERMANIAC" && pending.playerId === playerId) {
    if (!pending.options.includes(instanceId)) return state;
    resolveCiphermaniacPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type === "FIGHTING_GONG" && pending.playerId === playerId) {
    if (!pending.options.includes(instanceId)) return state;
    resolveFightingGongPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type === "BROCKS_SCOUTING" && pending.playerId === playerId && pending.step !== "MODE") {
    if (!pending.options.includes(instanceId)) return state;
    resolveBrockPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type === "SEARCH_EVOLUTION" && pending.playerId === playerId) {
    const attackName = pending.attackName;
    if (resolveSearchEvolutionPick(state, playerId, instanceId) === "failed") return state;
    if (attackName) {
      return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
    }
    return state;
  }
  if (pending?.type !== "SEARCH_DECK" || pending.playerId !== playerId) return state;
  if (!pending.options.includes(instanceId)) return state;
  resolveDeckPick(state, playerId, instanceId, pending.filter);
  if (state.pendingAction === null && state.turnFlags.attacked) {
    return finishAttackAndEffects(state, playerId);
  }
  return state;
}

function handleIonoSelectHand(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "IONO_HAND_BOTTOM" || pending.playerId !== playerId) return state;
  continueIonoHandBottom(state, playerId, instanceId);
  return state;
}

function handlePickDiscardPokemon(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type === "LANAS_AID" && pending.playerId === playerId) {
    if (!pending.options.includes(instanceId)) return state;
    resolveLanasAidPick(state, playerId, instanceId);
    return state;
  }
  if (pending?.type !== "PICK_DISCARD" || pending.playerId !== playerId) return state;
  if (!pending.options.includes(instanceId)) return state;

  if (pending.shuffleToDeck) {
    continueSacredAshDiscardPick(state, playerId, instanceId);
    return state;
  }

  const wasAttack = state.turnFlags.attacked;
  if (pending.toBench) {
    continueRecoverToBenchPick(state, playerId, instanceId);
  } else {
    continueNightStretcherPick(state, playerId, instanceId);
  }
  if (state.pendingAction === null && wasAttack) {
    return finishAttackAndEffects(state, playerId);
  }
  return state;
}

function handleSelectRareCandyBasic(state: EngineState, playerId: PlayerId, targetId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "RARE_CANDY" || pending.playerId !== playerId) return state;
  applyRareCandy(state, playerId, targetId);
  return state;
}

function handleSelectCrispinTarget(state: EngineState, playerId: PlayerId, pokemonId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "CRISPIN_ATTACH" || pending.playerId !== playerId) return state;
  if (!pending.targets.includes(pokemonId) || !state.heldCard) return state;

  const player = getPlayer(state, playerId);
  const target =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!target) return state;

  attachEnergyToPokemon(state, playerId, state.heldCard, target);
  state.heldCard = null;
  state.pendingAction = null;
  shuffleDeckAfterCrispin(state, playerId);
  return state;
}

function shuffleDeckAfterCrispin(state: EngineState, playerId: PlayerId): void {
  shufflePlayerDeck(state, playerId);
  maybeCrispinOptionalDiscard(state, playerId);
}

function handleCrispinOptionalDiscard(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "CRISPIN_DISCARD" || pending.playerId !== playerId) return state;
  const player = getPlayer(state, playerId);
  const card = removeFromHand(player, instanceId);
  if (!card) return state;
  moveToDiscard(player, card);
  drawCards(state, playerId, 2);
  state.pendingAction = null;
  return state;
}

function handleSkipOptional(state: EngineState, playerId: PlayerId): EngineState {
  if (
    !state.pendingAction &&
    state.turnFlags.trFactoryDrawAvailable &&
    state.currentPlayerId === playerId
  ) {
    state.turnFlags.trFactoryDrawAvailable = false;
    log(state, "Skipped Team Rocket's Factory draw.");
    return state;
  }

  const pending = state.pendingAction;
  if (!pending || pending.playerId !== playerId) return state;

  if (pending.type === "CRISPIN_DISCARD") {
    state.pendingAction = null;
    log(state, "Optional effect skipped.");
    return state;
  }

  if (pending.type === "PICK_DISCARD" && pending.shuffleToDeck) {
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    log(state, "Sacred Ash: finished choosing Pokémon.");
    return state;
  }

  if (pending.type === "SWITCH_WITH_BENCH" && pending.optional) {
    state.pendingAction = null;
    log(state, "Optional switch skipped.");
    if (state.turnFlags.attacked) {
      return finishAttackAndEffects(state, playerId);
    }
    return state;
  }

  if (pending.type === "REDISTRIBUTE_OPPONENT_COUNTERS" && pending.optional) {
    const attackName = pending.attackName;
    state.pendingAction = null;
    log(state, "Optional redistribution skipped.");
    if (attackName) {
      return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
    }
    return state;
  }

  if (pending.type === "DRAW_UNTIL_HAND" && pending.optional) {
    const attackName = pending.attackName;
    state.pendingAction = null;
    log(state, "Optional draw skipped.");
    if (attackName) {
      return finishAttackAfterDamagePhase(state, playerId, attackName, "complete");
    }
    if (state.turnFlags.attacked) {
      return finishAttackAndEffects(state, playerId);
    }
    return state;
  }

  if (pending.type === "PICK_DISCARD" && pending.slotsRemaining !== undefined) {
    state.pendingAction = null;
    log(state, pending.toBench ? "Finished choosing Pokémon for Bench." : "Night Stretcher: finished choosing Pokémon.");
    if (state.turnFlags.attacked) {
      return finishAttackAndEffects(state, playerId);
    }
    return state;
  }

  if (pending.type === "SEARCH_DECK" && pending.slotsRemaining !== undefined) {
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    log(state, "Optional search skipped.");
    return state;
  }

  if (pending.type === "DISCARD_BASIC_ENERGY_FOR_DAMAGE") {
    const payload = finishDiscardEnergyForAttack(state, playerId);
    if (!payload) return state;
    return handleResumeAttackDamage(state, playerId, payload.attackName, payload.bonusDamage);
  }

  if (pending.type === "DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE") {
    const payload = finishDiscardSupportersForAttack(state, playerId);
    if (!payload) return state;
    return handleResumeAttackDamage(state, playerId, payload.attackName, payload.bonusDamage);
  }

  if (pending.type === "GRAND_TREE" && pending.step === "STAGE2") {
    skipGrandTreeStage2(state, playerId);
    return state;
  }

  if (pending.type === "ROTO_STICK") {
    finishRotoStick(state, playerId);
    return state;
  }

  if (pending.type === "MIRACLE_HEADSET") {
    finishMiracleHeadset(state, playerId);
    return state;
  }

  if (pending.type === "BUG_CATCHING_SET") {
    finishBugCatchingSet(state, playerId);
    return state;
  }

  return state;
}

function handleDiscardOpponentEnergy(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  energyId: string,
): EngineState {
  const pending = state.pendingAction;
  if (pending?.type === "CRUSHING_HAMMER" && pending.playerId === playerId) {
    const match = pending.options.find(
      (entry) => entry.pokemonId === pokemonId && entry.energyId === energyId,
    );
    if (!match) return state;
    discardAttachedEnergy(state, getOpponentId(playerId), pokemonId, energyId);
    return state;
  }
  if (pending?.type === "ENHANCED_HAMMER" && pending.playerId === playerId && pending.step === "ENERGY") {
    resolveEnhancedHammerEnergy(state, playerId, pokemonId, energyId);
    return state;
  }
  return state;
}

function handleSelectEnhancedHammerPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
): EngineState {
  resolveEnhancedHammerPokemon(state, playerId, pokemonId);
  return state;
}

function handleSelectEnergySwitchPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
): EngineState {
  resolveEnergySwitchPokemon(state, playerId, pokemonId);
  return state;
}

function handleSelectWallysPokemon(state: EngineState, playerId: PlayerId, pokemonId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "WALLYS_COMPASSION" || pending.playerId !== playerId) return state;
  if (!pending.options.includes(pokemonId)) return state;
  applyWallysCompassion(state, playerId, pokemonId);
  return state;
}

function canPlayTrainerCard(state: EngineState, playerId: PlayerId, def: ReturnType<typeof getDefinitionSafe>): boolean {
  if (isSupporter(def) && !canPlaySupporterThisTurn(state, playerId)) {
    return false;
  }
  if (!canPlayTrainerCardFromHand(state, playerId, def)) {
    return false;
  }
  if (isTool(def)) {
    return false;
  }
  return canPlayTrainerEffect(state, playerId, def).ok;
}

function handleSelectToolScrapper(
  state: EngineState,
  playerId: PlayerId,
  toolInstanceId: string,
): EngineState {
  continueToolScrapperPick(state, playerId, toolInstanceId);
  return state;
}

function handleUseGrandTree(state: EngineState, playerId: PlayerId): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction) return state;
  if (!canUseGrandTree(state, playerId)) return state;
  startGrandTreeFlow(state, playerId);
  return state;
}

function handleSelectGrandTreeBasic(state: EngineState, playerId: PlayerId, targetId: string): EngineState {
  resolveGrandTreeBasic(state, playerId, targetId);
  return state;
}

function handleSelectGrandTreeStage1(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  resolveGrandTreeStage1(state, playerId, instanceId);
  return state;
}

function handleSelectGrandTreeStage2(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  resolveGrandTreeStage2(state, playerId, instanceId);
  return state;
}

function handleSelectRotoStick(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  continueRotoStickPick(state, playerId, instanceId);
  return state;
}

function handleSelectMiracleHeadset(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  continueMiracleHeadsetPick(state, playerId, instanceId);
  return state;
}

function handleSelectBugCatching(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  continueBugCatchingPick(state, playerId, instanceId);
  return state;
}

function handleSelectSecretBoxDiscard(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  continueSecretBoxDiscard(state, playerId, instanceId);
  return state;
}

function handleSelectSecretBoxSearch(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  continueSecretBoxSearch(state, playerId, instanceId);
  return state;
}

function handleSkipGrandTreeStage2(state: EngineState, playerId: PlayerId): EngineState {
  skipGrandTreeStage2(state, playerId);
  return state;
}

function handleSelectPrimeCatcherBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "PRIME_CATCHER" || pending.playerId !== playerId) return state;
  if (!pending.options.includes(benchInstanceId)) return state;
  if (pending.step === "OPPONENT_BENCH") {
    resolvePrimeCatcherOpponentBench(state, playerId, benchInstanceId);
  } else if (pending.step === "OWN_BENCH") {
    resolvePrimeCatcherOwnBench(state, playerId, benchInstanceId);
  }
  return state;
}

function handleSelectGiovanniBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "GIOVANNI" || pending.playerId !== playerId) return state;
  if (!pending.options.includes(benchInstanceId)) return state;
  if (pending.step === "OWN_BENCH") {
    resolveGiovanniOwnBench(state, playerId, benchInstanceId);
  } else if (pending.step === "OPPONENT_BENCH") {
    resolveGiovanniOpponentBench(state, playerId, benchInstanceId);
  }
  return state;
}

function handleSelectNsPpUpEnergy(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "N_PP_UP" || pending.playerId !== playerId || pending.step !== "ENERGY") return state;
  if (!pending.options.includes(instanceId)) return state;
  resolveNsPpUpEnergy(state, playerId, instanceId);
  return state;
}

function handleSelectNsPpUpTarget(state: EngineState, playerId: PlayerId, pokemonId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "N_PP_UP" || pending.playerId !== playerId || pending.step !== "TARGET") return state;
  if (!pending.options.includes(pokemonId)) return state;
  resolveNsPpUpTarget(state, playerId, pokemonId);
  return state;
}

function handleSelectBrockMode(
  state: EngineState,
  playerId: PlayerId,
  mode: "basic" | "evolution",
): EngineState {
  resolveBrockMode(state, playerId, mode);
  return state;
}

function handleSelectSurferBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): EngineState {
  resolveSurferBench(state, playerId, benchInstanceId);
  return state;
}

function handleSelectRosaTarget(state: EngineState, playerId: PlayerId, pokemonId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "ROSAS_ENCOURAGEMENT" || pending.playerId !== playerId || pending.step !== "TARGET") {
    return state;
  }
  if (!pending.options.includes(pokemonId)) return state;
  resolveRosaTarget(state, playerId, pokemonId);
  return state;
}

function handleSelectRosaEnergy(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  const pending = state.pendingAction;
  if (pending?.type !== "ROSAS_ENCOURAGEMENT" || pending.playerId !== playerId || pending.step !== "ENERGY") {
    return state;
  }
  if (!pending.options.includes(instanceId)) return state;
  resolveRosaEnergy(state, playerId, instanceId);
  return state;
}

function handleUseLumioseCity(state: EngineState, playerId: PlayerId, instanceId: string): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction) return state;
  if (!canUseLumioseCity(state, playerId)) return state;
  applyLumioseCitySearch(state, playerId, instanceId);
  return handleEndTurn(state);
}

function handleUseTrFactoryDraw(state: EngineState, playerId: PlayerId): EngineState {
  if (state.phase !== GamePhase.Active || state.currentPlayerId !== playerId) return state;
  if (state.pendingAction) return state;
  applyTrFactoryDraw(state, playerId);
  return state;
}

function handleEndTurn(state: EngineState): EngineState {
  if (state.phase !== GamePhase.Active) return state;
  if (state.pendingAction) {
    log(state, "Resolve the pending action before ending your turn.");
    return state;
  }
  const previous = state.currentPlayerId;
  if (state.itemPlayBlockedForPlayerId === previous) {
    state.itemPlayBlockedForPlayerId = null;
  }
  state.teamRocketKnockedOutSinceMyLastTurn[previous] = false;
  state.ownPokemonKnockedOutOpponentLastTurn[previous] = false;
  clearModifiersWhenTurnEnds(state, previous);
  discardIgnitionEnergyAtEndOfTurn(state, previous);
  runPokemonCheckup(state);
  state.currentPlayerId = getOpponentId(previous);
  state.turnNumber += 1;
  state.turnFlags = emptyTurnFlags();
  activatePendingModifiersForTurnStart(state, state.currentPlayerId);
  state.viewingPlayerId = state.currentPlayerId;
  log(state, `${getPlayer(state, previous).name} ended their turn.`);

  const drawingPlayer = getPlayer(state, state.currentPlayerId);
  if (!(state.turnNumber === 2 && state.currentPlayerId === state.firstPlayerId)) {
    drawCards(state, state.currentPlayerId, 1);
  }

  if (drawingPlayer.active === null && drawingPlayer.bench.length === 0) {
    state.winnerId = getOpponentId(state.currentPlayerId);
    state.phase = GamePhase.Finished;
    log(state, `${drawingPlayer.name} has no Pokémon in play.`);
  }

  finishIfWinner(state);
  return state;
}

export function gameReducer(state: EngineState, action: GameAction): EngineState {
  const nextState = structuredClone(state);
  nextState.actionLog.push(action);

  switch (action.type) {
    case "SETUP_START":
      return handleSetupStart(nextState, action.seed);
    case "MULLIGAN":
      return handleMulligan(nextState, action.playerId);
    case "PLACE_ACTIVE":
      return handlePlaceActive(nextState, action.playerId, action.instanceId);
    case "PLACE_BENCH":
      return handlePlaceBench(nextState, action.playerId, action.instanceId);
    case "PLAY_BASIC_TO_BENCH":
      return handlePlayBasicToBench(nextState, action.playerId, action.instanceId);
    case "DRAW":
      return handleDraw(nextState, action.playerId);
    case "ATTACH_ENERGY":
      return handleAttachEnergy(nextState, action.playerId, action.energyId, action.targetId);
    case "ATTACH_TOOL":
      return handleAttachTool(nextState, action.playerId, action.toolId, action.targetId);
    case "PLAY_TRAINER":
      return handlePlayTrainer(nextState, action.playerId, action.instanceId);
    case "EVOLVE":
      return handleEvolve(nextState, action.playerId, action.evolutionId, action.targetId);
    case "ATTACK":
      return handleAttack(nextState, action.playerId, action.attackName);
    case "RETREAT":
      return handleRetreat(nextState, action.playerId, action.benchInstanceId);
    case "PROMOTE_BENCH":
      return handlePromoteBench(nextState, action.playerId, action.instanceId);
    case "SWITCH_OPPONENT_ACTIVE":
      return handleSwitchOpponentActive(nextState, action.playerId, action.benchInstanceId);
    case "SWITCH_WITH_BENCH":
      return handleSwitchWithBench(nextState, action.playerId, action.benchInstanceId);
    case "MOVE_ENERGY_TO_BENCH":
      return handleMoveEnergyToBench(nextState, action.playerId, action.benchInstanceId);
    case "CHOOSE_OPPONENT_DAMAGE":
      return handleChooseOpponentDamage(nextState, action.playerId, action.targetId);
    case "SELECT_HAND_DISCARD":
      return handleSelectHandDiscard(nextState, action.playerId, action.instanceId);
    case "IONO_SELECT_HAND":
      return handleIonoSelectHand(nextState, action.playerId, action.instanceId);
    case "PICK_DECK_CARD":
      return handlePickDeckCard(nextState, action.playerId, action.instanceId);
    case "PICK_DISCARD_POKEMON":
      return handlePickDiscardPokemon(nextState, action.playerId, action.instanceId);
    case "SELECT_RARE_CANDY_BASIC":
      return handleSelectRareCandyBasic(nextState, action.playerId, action.targetId);
    case "SELECT_CRISPIN_TARGET":
      return handleSelectCrispinTarget(nextState, action.playerId, action.pokemonId);
    case "DISCARD_OPPONENT_ENERGY":
      return handleDiscardOpponentEnergy(nextState, action.playerId, action.pokemonId, action.energyId);
    case "SELECT_ENHANCED_HAMMER_POKEMON":
      return handleSelectEnhancedHammerPokemon(nextState, action.playerId, action.pokemonId);
    case "SELECT_ENERGY_SWITCH_POKEMON":
      return handleSelectEnergySwitchPokemon(nextState, action.playerId, action.pokemonId);
    case "SELECT_WALLYS_POKEMON":
      return handleSelectWallysPokemon(nextState, action.playerId, action.pokemonId);
    case "SELECT_CIPHERMANIAC_CARD":
      return handlePickDeckCard(nextState, action.playerId, action.instanceId);
    case "SELECT_FIGHTING_GONG":
      return handlePickDeckCard(nextState, action.playerId, action.instanceId);
    case "SELECT_GIOVANNI_BENCH":
      return handleSelectGiovanniBench(nextState, action.playerId, action.benchInstanceId);
    case "SELECT_PRIME_CATCHER_BENCH":
      return handleSelectPrimeCatcherBench(nextState, action.playerId, action.benchInstanceId);
    case "SELECT_N_PP_UP_ENERGY":
      return handleSelectNsPpUpEnergy(nextState, action.playerId, action.instanceId);
    case "SELECT_N_PP_UP_TARGET":
      return handleSelectNsPpUpTarget(nextState, action.playerId, action.pokemonId);
    case "SELECT_TOOL_SCRAPPER":
      return handleSelectToolScrapper(nextState, action.playerId, action.toolInstanceId);
    case "SELECT_ROTO_STICK":
      return handleSelectRotoStick(nextState, action.playerId, action.instanceId);
    case "SELECT_MIRACLE_HEADSET":
      return handleSelectMiracleHeadset(nextState, action.playerId, action.instanceId);
    case "SELECT_BUG_CATCHING":
      return handleSelectBugCatching(nextState, action.playerId, action.instanceId);
    case "SELECT_SECRET_BOX_DISCARD":
      return handleSelectSecretBoxDiscard(nextState, action.playerId, action.instanceId);
    case "SELECT_SECRET_BOX_SEARCH":
      return handleSelectSecretBoxSearch(nextState, action.playerId, action.instanceId);
    case "SELECT_BROCK_MODE":
      return handleSelectBrockMode(nextState, action.playerId, action.mode);
    case "SELECT_SURFER_BENCH":
      return handleSelectSurferBench(nextState, action.playerId, action.benchInstanceId);
    case "SELECT_ROSA_TARGET":
      return handleSelectRosaTarget(nextState, action.playerId, action.pokemonId);
    case "SELECT_ROSA_ENERGY":
      return handleSelectRosaEnergy(nextState, action.playerId, action.instanceId);
    case "USE_LUMIOSE_CITY":
      return handleUseLumioseCity(nextState, action.playerId, action.instanceId);
    case "USE_TR_FACTORY_DRAW":
      return handleUseTrFactoryDraw(nextState, action.playerId);
    case "USE_GRAND_TREE":
      return handleUseGrandTree(nextState, action.playerId);
    case "SELECT_GRAND_TREE_BASIC":
      return handleSelectGrandTreeBasic(nextState, action.playerId, action.targetId);
    case "SELECT_GRAND_TREE_STAGE1":
      return handleSelectGrandTreeStage1(nextState, action.playerId, action.instanceId);
    case "SELECT_GRAND_TREE_STAGE2":
      return handleSelectGrandTreeStage2(nextState, action.playerId, action.instanceId);
    case "SKIP_GRAND_TREE_STAGE2":
      return handleSkipGrandTreeStage2(nextState, action.playerId);
    case "CRISPIN_OPTIONAL_DISCARD":
      return handleCrispinOptionalDiscard(nextState, action.playerId, action.instanceId);
    case "SKIP_OPTIONAL":
      return handleSkipOptional(nextState, action.playerId);
    case "USE_ABILITY":
      return handleUseAbility(nextState, action.playerId, action.pokemonId, action.abilityName);
    case "ASSIGN_BENCH_DAMAGE":
      return handleAssignBenchDamage(nextState, action.playerId, action.targetId);
    case "CHOOSE_BENCH_DAMAGE_TARGET":
      return handleChooseBenchDamageTarget(nextState, action.playerId, action.targetId);
    case "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET":
      return handleChooseOpponentPokemonDamageTarget(nextState, action.playerId, action.targetId);
    case "MOVE_DAMAGE_SOURCE":
      return handleMoveDamageSource(nextState, action.playerId, action.sourceId);
    case "MOVE_DAMAGE_TARGET":
      return handleMoveDamageTarget(nextState, action.playerId, action.targetId);
    case "SELECT_REDISTRIBUTE_SOURCE":
      return handleSelectRedistributeSource(nextState, action.playerId, action.sourceId);
    case "SELECT_REDISTRIBUTE_TARGET":
      return handleSelectRedistributeTarget(nextState, action.playerId, action.targetId);
    case "CONFIRM_DRAW_UNTIL_HAND":
      return handleConfirmDrawUntilHand(nextState, action.playerId);
    case "DISCARD_OWN_ENERGY_FOR_ATTACK":
      return handleDiscardOwnEnergyForAttack(
        nextState,
        action.playerId,
        action.pokemonId,
        action.energyId,
      );
    case "DISCARD_HAND_SUPPORTER_FOR_ATTACK":
      return handleDiscardHandSupporterForAttack(nextState, action.playerId, action.instanceId);
    case "CHOOSE_BLOCKED_ATTACK":
      return handleChooseBlockedAttack(nextState, action.playerId, action.attackName);
    case "ATTACH_HAND_ENERGY_TO_POKEMON":
      return handleAttachHandEnergyToPokemon(
        nextState,
        action.playerId,
        action.pokemonId,
        action.energyId,
      );
    case "RESUME_ATTACK":
      return handleResumeAttackDamage(
        nextState,
        action.playerId,
        action.attackName,
        action.extraBonusDamage,
      );
    case "CHOOSE_BENCH_ATTACK":
      return handleChooseBenchAttack(
        nextState,
        action.playerId,
        action.benchPokemonId,
        action.attackName,
      );
    case "END_TURN":
      return handleEndTurn(nextState);
    case "CONCEDE":
      nextState.winnerId = getOpponentId(action.playerId);
      nextState.phase = GamePhase.Finished;
      log(nextState, `${getPlayer(nextState, action.playerId).name} conceded.`);
      return nextState;
    case "SWITCH_VIEW":
      nextState.viewingPlayerId = action.playerId;
      return nextState;
    default:
      return state;
  }
}

export function beginGame(input: Parameters<typeof createInitialGame>[0]): EngineState {
  const initial = createInitialGame(input);
  return gameReducer(initial, { type: "SETUP_START", seed: input.seed });
}

export function canStartActiveGame(state: EngineState): boolean {
  return (
    state.phase === GamePhase.PlaceBench &&
    !!getPlayer(state, PlayerId.P1).active &&
    !!getPlayer(state, PlayerId.P2).active
  );
}

export function startActiveGame(state: EngineState): EngineState {
  if (!canStartActiveGame(state)) return state;
  return startGameIfReady(state);
}

export function getLegalActions(state: EngineState): GameAction[] {
  const actions: GameAction[] = [];
  const current = state.currentPlayerId;
  const player = getPlayer(state, current);

  if (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
    if (checkMulliganNeeded(state, state.pendingMulliganPlayerId)) {
      actions.push({ type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
    }
  }

  if (state.phase === GamePhase.PlaceActive) {
    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      const setupPlayer = getPlayer(state, playerId);
      if (setupPlayer.active) continue;
      for (const card of setupPlayer.hand) {
        const def = getDefinition(state, card.definitionId);
        if (def && isBasicPokemon(def)) {
          actions.push({ type: "PLACE_ACTIVE", playerId, instanceId: card.instanceId });
        }
      }
    }
  }

  if (state.phase === GamePhase.PlaceBench) {
    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      const setupPlayer = getPlayer(state, playerId);
      if (setupPlayer.bench.length >= 5) continue;
      for (const card of setupPlayer.hand) {
        const def = getDefinition(state, card.definitionId);
        if (def && isBasicPokemon(def)) {
          actions.push({ type: "PLACE_BENCH", playerId, instanceId: card.instanceId });
        }
      }
    }
  }

  if (state.phase === GamePhase.Active) {
    if (state.pendingAction?.type === "PROMOTE") {
      const promotePlayer = getPlayer(state, state.pendingAction.playerId);
      for (const bench of promotePlayer.bench) {
        actions.push({
          type: "PROMOTE_BENCH",
          playerId: state.pendingAction.playerId,
          instanceId: bench.instanceId,
        });
      }
    } else if (state.currentPlayerId === current) {
      if (state.pendingAction) {
        appendPendingActions(state, actions, current);
      } else {
        appendActiveTurnActions(state, actions, current, player);
      }

      if (!state.pendingAction) {
        actions.push({ type: "END_TURN" });
      }
      actions.push({ type: "CONCEDE", playerId: current });
    }
  }

  actions.push({ type: "SWITCH_VIEW", playerId: getOpponentId(state.viewingPlayerId) });
  return actions;
}

function appendPendingActions(state: EngineState, actions: GameAction[], current: PlayerId): void {
  const pending = state.pendingAction;
  if (!pending) return;

  switch (pending.type) {
    case "BOSS_ORDERS": {
      if (pending.playerId !== current) break;
      const opponent = getPlayer(state, getOpponentId(current));
      for (const bench of opponent.bench) {
        actions.push({
          type: "SWITCH_OPPONENT_ACTIVE",
          playerId: current,
          benchInstanceId: bench.instanceId,
        });
      }
      break;
    }
    case "IONO_HAND_BOTTOM": {
      const picker = getPlayer(state, pending.playerId);
      for (const card of picker.hand) {
        actions.push({
          type: "IONO_SELECT_HAND",
          playerId: pending.playerId,
          instanceId: card.instanceId,
        });
      }
      break;
    }
    case "PROMOTE": {
      break;
    }
    case "SWITCH_WITH_BENCH": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const bench of player.bench) {
        actions.push({
          type: "SWITCH_WITH_BENCH",
          playerId: current,
          benchInstanceId: bench.instanceId,
        });
      }
      if (pending.optional) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "SWITCH_TYPED_BENCH": {
      if (pending.playerId !== current) break;
      for (const benchInstanceId of pending.options) {
        actions.push({
          type: "SWITCH_WITH_BENCH",
          playerId: current,
          benchInstanceId,
        });
      }
      break;
    }
    case "DAMAGE_TWO_OPPONENT": {
      if (pending.playerId !== current) break;
      const opponent = getPlayer(state, getOpponentId(current));
      const candidates = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ].filter((pokemon) => !pending.pickedIds.includes(pokemon.instanceId));
      for (const pokemon of candidates) {
        actions.push({
          type: "CHOOSE_OPPONENT_DAMAGE",
          playerId: current,
          targetId: pokemon.instanceId,
        });
      }
      break;
    }
    case "MOVE_ENERGY_TO_BENCH": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const bench of player.bench) {
        actions.push({
          type: "MOVE_ENERGY_TO_BENCH",
          playerId: current,
          benchInstanceId: bench.instanceId,
        });
      }
      break;
    }
    case "ULTRA_BALL_DISCARD": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const card of player.hand) {
        if (!pending.selectedIds.includes(card.instanceId)) {
          actions.push({ type: "SELECT_HAND_DISCARD", playerId: current, instanceId: card.instanceId });
        }
      }
      break;
    }
    case "SEARCH_DECK": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DECK_CARD", playerId: current, instanceId });
      }
      if (pending.slotsRemaining !== undefined && pending.slotsRemaining > 1) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "RECON_DIRECTIVE": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DECK_CARD", playerId: current, instanceId });
      }
      break;
    }
    case "PICK_DISCARD": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DISCARD_POKEMON", playerId: current, instanceId });
      }
      if (pending.slotsRemaining !== undefined && pending.slotsRemaining < 3) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "ENERGY_SWITCH": {
      if (pending.playerId !== current) break;
      for (const pokemonId of pending.options) {
        actions.push({ type: "SELECT_ENERGY_SWITCH_POKEMON", playerId: current, pokemonId });
      }
      break;
    }
    case "ENHANCED_HAMMER": {
      if (pending.playerId !== current) break;
      if (pending.step === "POKEMON") {
        const opponent = getPlayer(state, getOpponentId(current));
        for (const pokemon of allPokemonInPlay(opponent)) {
          if (pokemon.attachedEnergy.length > 0) {
            actions.push({
              type: "SELECT_ENHANCED_HAMMER_POKEMON",
              playerId: current,
              pokemonId: pokemon.instanceId,
            });
          }
        }
      } else {
        for (const option of pending.options) {
          actions.push({
            type: "DISCARD_OPPONENT_ENERGY",
            playerId: current,
            pokemonId: option.pokemonId,
            energyId: option.energyId,
          });
        }
      }
      break;
    }
    case "WALLYS_COMPASSION": {
      if (pending.playerId !== current) break;
      for (const pokemonId of pending.options) {
        actions.push({ type: "SELECT_WALLYS_POKEMON", playerId: current, pokemonId });
      }
      break;
    }
    case "HILDA": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DECK_CARD", playerId: current, instanceId });
      }
      break;
    }
    case "DAWN":
    case "COLRESS": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DECK_CARD", playerId: current, instanceId });
      }
      break;
    }
    case "CIPHERMANIAC": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "SELECT_CIPHERMANIAC_CARD", playerId: current, instanceId });
      }
      break;
    }
    case "FIGHTING_GONG": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "SELECT_FIGHTING_GONG", playerId: current, instanceId });
      }
      break;
    }
    case "GIOVANNI": {
      if (pending.playerId !== current) break;
      for (const benchInstanceId of pending.options) {
        actions.push({ type: "SELECT_GIOVANNI_BENCH", playerId: current, benchInstanceId });
      }
      break;
    }
    case "PRIME_CATCHER": {
      if (pending.playerId !== current) break;
      for (const benchInstanceId of pending.options) {
        actions.push({ type: "SELECT_PRIME_CATCHER_BENCH", playerId: current, benchInstanceId });
      }
      break;
    }
    case "N_PP_UP": {
      if (pending.playerId !== current) break;
      if (pending.step === "ENERGY") {
        for (const instanceId of pending.options) {
          actions.push({ type: "SELECT_N_PP_UP_ENERGY", playerId: current, instanceId });
        }
      } else {
        for (const pokemonId of pending.options) {
          actions.push({ type: "SELECT_N_PP_UP_TARGET", playerId: current, pokemonId });
        }
      }
      break;
    }
    case "LANAS_AID": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DISCARD_POKEMON", playerId: current, instanceId });
      }
      if (pending.pickedIds.length < 3) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "BROCKS_SCOUTING": {
      if (pending.playerId !== current) break;
      if (pending.step === "MODE") {
        actions.push({ type: "SELECT_BROCK_MODE", playerId: current, mode: "basic" });
        actions.push({ type: "SELECT_BROCK_MODE", playerId: current, mode: "evolution" });
      } else {
        for (const instanceId of pending.options) {
          actions.push({ type: "PICK_DECK_CARD", playerId: current, instanceId });
        }
        if (pending.step === "BASIC" && (pending.pickedIds?.length ?? 0) < 2) {
          actions.push({ type: "SKIP_OPTIONAL", playerId: current });
        }
      }
      break;
    }
    case "ROSAS_ENCOURAGEMENT": {
      if (pending.playerId !== current) break;
      if (pending.step === "TARGET") {
        for (const pokemonId of pending.options) {
          actions.push({ type: "SELECT_ROSA_TARGET", playerId: current, pokemonId });
        }
      } else {
        for (const instanceId of pending.options) {
          actions.push({ type: "SELECT_ROSA_ENERGY", playerId: current, instanceId });
        }
        if ((pending.pickedEnergyIds?.length ?? 0) < 2) {
          actions.push({ type: "SKIP_OPTIONAL", playerId: current });
        }
      }
      break;
    }
    case "SURFER": {
      if (pending.playerId !== current) break;
      for (const benchInstanceId of pending.options) {
        actions.push({ type: "SELECT_SURFER_BENCH", playerId: current, benchInstanceId });
      }
      break;
    }
    case "TOOL_SCRAPPER": {
      if (pending.playerId !== current) break;
      for (const toolInstanceId of pending.options) {
        actions.push({ type: "SELECT_TOOL_SCRAPPER", playerId: current, toolInstanceId });
      }
      if (pending.discardRemaining > 1) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "GRAND_TREE": {
      if (pending.playerId !== current) break;
      if (pending.step === "BASIC") {
        for (const targetId of pending.options) {
          actions.push({ type: "SELECT_GRAND_TREE_BASIC", playerId: current, targetId });
        }
      } else if (pending.step === "STAGE1") {
        for (const instanceId of pending.options) {
          actions.push({ type: "SELECT_GRAND_TREE_STAGE1", playerId: current, instanceId });
        }
      } else {
        for (const instanceId of pending.options) {
          actions.push({ type: "SELECT_GRAND_TREE_STAGE2", playerId: current, instanceId });
        }
        actions.push({ type: "SKIP_GRAND_TREE_STAGE2", playerId: current });
      }
      break;
    }
    case "ROTO_STICK": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "SELECT_ROTO_STICK", playerId: current, instanceId });
      }
      actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      break;
    }
    case "MIRACLE_HEADSET": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "SELECT_MIRACLE_HEADSET", playerId: current, instanceId });
      }
      if (pending.pickedIds.length < pending.maxPicks) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "BUG_CATCHING_SET": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "SELECT_BUG_CATCHING", playerId: current, instanceId });
      }
      if (pending.pickedIds.length < pending.maxPicks) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "SECRET_BOX": {
      if (pending.playerId !== current) break;
      if (pending.step === "DISCARD") {
        for (const instanceId of pending.options) {
          actions.push({ type: "SELECT_SECRET_BOX_DISCARD", playerId: current, instanceId });
        }
      } else {
        for (const instanceId of pending.options) {
          actions.push({ type: "SELECT_SECRET_BOX_SEARCH", playerId: current, instanceId });
        }
      }
      break;
    }
    case "RARE_CANDY": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const pokemon of allPokemonInPlay(player)) {
        const def = getDefinition(state, pokemon.definitionId);
        if (def && isBasicPokemon(def) && pokemon.enteredPlayTurn !== state.turnNumber) {
          actions.push({ type: "SELECT_RARE_CANDY_BASIC", playerId: current, targetId: pokemon.instanceId });
        }
      }
      break;
    }
    case "CRUSHING_HAMMER": {
      if (pending.playerId !== current) break;
      for (const option of pending.options) {
        actions.push({
          type: "DISCARD_OPPONENT_ENERGY",
          playerId: current,
          pokemonId: option.pokemonId,
          energyId: option.energyId,
        });
      }
      break;
    }
    case "CRISPIN_ATTACH": {
      if (pending.playerId !== current) break;
      for (const pokemonId of pending.targets) {
        actions.push({ type: "SELECT_CRISPIN_TARGET", playerId: current, pokemonId });
      }
      break;
    }
    case "CRISPIN_DISCARD": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const card of player.hand) {
        actions.push({ type: "CRISPIN_OPTIONAL_DISCARD", playerId: current, instanceId: card.instanceId });
      }
      actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      break;
    }
    case "DISTRIBUTE_BENCH_DAMAGE": {
      if (pending.playerId !== current) break;
      const opponent = getPlayer(state, getOpponentId(current));
      for (const bench of opponent.bench) {
        actions.push({ type: "ASSIGN_BENCH_DAMAGE", playerId: current, targetId: bench.instanceId });
      }
      break;
    }
    case "CHOOSE_BENCH_DAMAGE": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "CHOOSE_BENCH_DAMAGE_TARGET", playerId: current, targetId: instanceId });
      }
      break;
    }
    case "CHOOSE_OPPONENT_POKEMON_DAMAGE": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({
          type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET",
          playerId: current,
          targetId: instanceId,
        });
      }
      break;
    }
    case "MOVE_DAMAGE": {
      if (pending.playerId !== current) break;
      if (pending.step === "SOURCE") {
        const owner = getPlayer(state, current);
        for (const pokemon of allPokemonInPlay(owner)) {
          if (pokemon.damageCounters > 0) {
            actions.push({ type: "MOVE_DAMAGE_SOURCE", playerId: current, sourceId: pokemon.instanceId });
          }
        }
      } else if (pending.step === "TARGET") {
        const targetPlayerId = pending.targetSide === "opponent" ? getOpponentId(current) : current;
        const targetPlayer = getPlayer(state, targetPlayerId);
        for (const pokemon of allPokemonInPlay(targetPlayer)) {
          actions.push({ type: "MOVE_DAMAGE_TARGET", playerId: current, targetId: pokemon.instanceId });
        }
      }
      break;
    }
    case "REDISTRIBUTE_OPPONENT_COUNTERS": {
      if (pending.playerId !== current) break;
      if (pending.step === "SOURCE") {
        const opponent = getPlayer(state, getOpponentId(current));
        for (const pokemon of allPokemonInPlay(opponent)) {
          if (pokemon.damageCounters > 0) {
            actions.push({
              type: "SELECT_REDISTRIBUTE_SOURCE",
              playerId: current,
              sourceId: pokemon.instanceId,
            });
          }
        }
        if (pending.optional) {
          actions.push({ type: "SKIP_OPTIONAL", playerId: current });
        }
      } else if (pending.step === "TARGET" && pending.sourceId) {
        const opponent = getPlayer(state, getOpponentId(current));
        for (const pokemon of allPokemonInPlay(opponent)) {
          if (pokemon.instanceId !== pending.sourceId) {
            actions.push({
              type: "SELECT_REDISTRIBUTE_TARGET",
              playerId: current,
              targetId: pokemon.instanceId,
            });
          }
        }
      }
      break;
    }
    case "DRAW_UNTIL_HAND": {
      if (pending.playerId !== current) break;
      actions.push({ type: "CONFIRM_DRAW_UNTIL_HAND", playerId: current });
      if (pending.optional) {
        actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      }
      break;
    }
    case "DISCARD_BASIC_ENERGY_FOR_DAMAGE": {
      if (pending.playerId !== current) break;
      for (const option of listDiscardableEnergy(state, current, pending.fromBenchOnly, {
        energyType: pending.energyType,
        activeOnly: pending.activeOnly,
      })) {
        actions.push({
          type: "DISCARD_OWN_ENERGY_FOR_ATTACK",
          playerId: current,
          pokemonId: option.pokemonId,
          energyId: option.energyId,
        });
      }
      actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      break;
    }
    case "DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE": {
      if (pending.playerId !== current) break;
      for (const card of listDiscardableNamedSupporters(state, current, pending.nameFilter)) {
        actions.push({
          type: "DISCARD_HAND_SUPPORTER_FOR_ATTACK",
          playerId: current,
          instanceId: card.instanceId,
        });
      }
      actions.push({ type: "SKIP_OPTIONAL", playerId: current });
      break;
    }
    case "CHOOSE_BLOCKED_ATTACK": {
      if (pending.playerId !== current) break;
      for (const attackName of pending.options) {
        actions.push({ type: "CHOOSE_BLOCKED_ATTACK", playerId: current, attackName });
      }
      break;
    }
    case "SEARCH_EVOLUTION": {
      if (pending.playerId !== current) break;
      for (const instanceId of pending.options) {
        actions.push({ type: "PICK_DECK_CARD", playerId: current, instanceId });
      }
      break;
    }
    case "ATTACH_HAND_ENERGY": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const card of player.hand) {
        const def = getDefinition(state, card.definitionId);
        if (def?.supertype !== "Energy") continue;
        const type = pending.energyType.toLowerCase();
        const matchesType =
          def.name.toLowerCase().includes(type) ||
          def.types?.some((entry) => entry.toLowerCase() === type);
        if (!matchesType) continue;
        for (const targetId of pending.targetIds) {
          actions.push({
            type: "ATTACH_HAND_ENERGY_TO_POKEMON",
            playerId: current,
            pokemonId: targetId,
            energyId: card.instanceId,
          });
        }
      }
      break;
    }
    case "COPY_BENCH_ATTACK": {
      if (pending.playerId !== current) break;
      for (const option of pending.options) {
        actions.push({
          type: "CHOOSE_BENCH_ATTACK",
          playerId: current,
          benchPokemonId: option.benchPokemonId,
          attackName: option.attackName,
        });
      }
      break;
    }
    case "ABILITY_DISCARD_HAND": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const card of player.hand) {
        actions.push({ type: "SELECT_HAND_DISCARD", playerId: current, instanceId: card.instanceId });
      }
      break;
    }
    case "ABILITY_DISCARD_HAND_ENERGY": {
      if (pending.playerId !== current) break;
      const player = getPlayer(state, current);
      for (const card of player.hand) {
        if (!handCardMatchesBasicEnergyType(state, card, pending.energyType)) continue;
        actions.push({ type: "SELECT_HAND_DISCARD", playerId: current, instanceId: card.instanceId });
      }
      break;
    }
  }
}

function appendActiveTurnActions(
  state: EngineState,
  actions: GameAction[],
  current: PlayerId,
  player: ReturnType<typeof getPlayer>,
): void {
  if (!state.turnFlags.energyAttached) {
    for (const card of player.hand) {
      const def = getDefinition(state, card.definitionId);
      if (def?.supertype !== "Energy") continue;
      for (const target of allPokemonInPlay(player)) {
        actions.push({
          type: "ATTACH_ENERGY",
          playerId: current,
          energyId: card.instanceId,
          targetId: target.instanceId,
        });
      }
    }
  }

  if (player.bench.length < getMaxBenchSize(state, current)) {
    for (const card of player.hand) {
      const def = getDefinition(state, card.definitionId);
      if (def && isBasicPokemon(def)) {
        actions.push({
          type: "PLAY_BASIC_TO_BENCH",
          playerId: current,
          instanceId: card.instanceId,
        });
      }
    }
  }

  for (const card of player.hand) {
    const def = getDefinition(state, card.definitionId);
    if (def?.supertype === "Pokémon" && !isBasicPokemon(def)) {
      for (const target of allPokemonInPlay(player)) {
        if (!canEvolvePokemonThisTurn(state, target)) continue;
        const targetDef = getDefinition(state, target.definitionId);
        if (targetDef && def && canEvolveInto(targetDef, def)) {
          actions.push({
            type: "EVOLVE",
            playerId: current,
            evolutionId: card.instanceId,
            targetId: target.instanceId,
          });
        }
      }
    }
  }

  for (const card of player.hand) {
    const def = getDefinition(state, card.definitionId);
    if (def?.supertype === "Trainer" && canPlayTrainerCard(state, current, def)) {
      if (!isSupporter(def) || !state.turnFlags.supporterPlayed) {
        actions.push({ type: "PLAY_TRAINER", playerId: current, instanceId: card.instanceId });
      }
    }
  }

  for (const card of player.hand) {
    const def = getDefinition(state, card.definitionId);
    if (!def || !isTool(def)) continue;
    if (!canPlayToolFromHand(state, current)) continue;
    for (const target of allPokemonInPlay(player)) {
      if (!canAttachToolToPokemon(state, current, def, target)) continue;
      actions.push({
        type: "ATTACH_TOOL",
        playerId: current,
        toolId: card.instanceId,
        targetId: target.instanceId,
      });
    }
  }

  for (const pokemon of allPokemonInPlay(player)) {
    const def = getDefinition(state, pokemon.definitionId);
    for (const ability of def?.abilities ?? []) {
      const parsed = parseAbilityText(ability);
      if (!hasActivatableAbility(parsed)) continue;
      if (!canUseAbilityNow(state, pokemon, parsed)) continue;
      actions.push({
        type: "USE_ABILITY",
        playerId: current,
        pokemonId: pokemon.instanceId,
        abilityName: ability.name,
      });
    }
  }

  if (
    player.active &&
    !state.turnFlags.attacked &&
    canAttackThisTurn(state) &&
    canPokemonAttackWithPassives(state, player.active, canPokemonAttack(player.active))
  ) {
    const def = getDefinition(state, player.active.definitionId);
    for (const attack of def?.attacks ?? []) {
      if (canAffordAttack(state, player.active, attack)) {
        actions.push({ type: "ATTACK", playerId: current, attackName: attack.name });
      }
    }
  }

  if (
    !state.turnFlags.retreated &&
    player.active &&
    player.bench.length > 0 &&
    canAffordRetreat(state, player.active) &&
    canPokemonRetreat(player.active)
  ) {
    for (const bench of player.bench) {
      actions.push({ type: "RETREAT", playerId: current, benchInstanceId: bench.instanceId });
    }
  }

  if (canUseLumioseCity(state, current)) {
    for (const card of getLumioseDeckOptions(state, current)) {
      actions.push({ type: "USE_LUMIOSE_CITY", playerId: current, instanceId: card.instanceId });
    }
  }

  if (canUseGrandTree(state, current)) {
    actions.push({ type: "USE_GRAND_TREE", playerId: current });
  }

  if (state.turnFlags.trFactoryDrawAvailable) {
    actions.push({ type: "USE_TR_FACTORY_DRAW", playerId: current });
    actions.push({ type: "SKIP_OPTIONAL", playerId: current });
  }

  if (!player.active || state.pendingAction?.type === "PROMOTE") {
    const promotePlayerId =
      state.pendingAction?.type === "PROMOTE" ? state.pendingAction.playerId : current;
    const promotePlayer = getPlayer(state, promotePlayerId);
    for (const bench of promotePlayer.bench) {
      actions.push({ type: "PROMOTE_BENCH", playerId: promotePlayerId, instanceId: bench.instanceId });
    }
  }
}

export { createInitialGame };
