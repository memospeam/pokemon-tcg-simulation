import { isBasicPokemon, isStage1, isStage2 } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { canEvolveInto, getDefinitionSafe, normalizePokemonName } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { allPokemonInPlay, getPlayer, type EngineState } from "../types";
import { canEvolvePokemonThisTurn } from "../rules";
import { getStadiumKind } from "./stadiumEffects";
import { transferPokemonStateOntoEvolution } from "./toolEffects";

export function canUseGrandTree(state: EngineState, playerId: import("../../models/enums").PlayerId): boolean {
  if (getStadiumKind(state) !== "grand_tree") return false;
  if (state.turnFlags.stadiumOncePerTurnUsed) return false;
  if (state.pendingAction) return false;
  return getGrandTreeEligibleBasics(state, playerId).length > 0;
}

export function getGrandTreeEligibleBasics(state: EngineState, playerId: import("../../models/enums").PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).filter((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    if (!isBasicPokemon(def)) return false;
    if (!canEvolvePokemonThisTurn(state, pokemon)) return false;
    return player.deck.some((card) => {
      const evoDef = getDefinitionSafe(state, card.definitionId);
      return isStage1(evoDef) && canEvolveInto(def, evoDef);
    });
  });
}

export function getGrandTreeStage1Options(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  basic: CardInstance,
): CardInstance[] {
  const basicDef = getDefinitionSafe(state, basic.definitionId);
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const evoDef = getDefinitionSafe(state, card.definitionId);
    return isStage1(evoDef) && canEvolveInto(basicDef, evoDef);
  });
}

/** Mirrors the heuristic AI's Stage 2 floor without deck-archetype context. */
const GRAND_TREE_STAGE2_MIN_SCORE = 70;

function scoreGrandTreeStage2Option(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  stage1: CardInstance,
  candidate: CardInstance,
): number {
  const def = getDefinitionSafe(state, candidate.definitionId);
  if (!isStage2(def)) return 0;

  const player = getPlayer(state, playerId);
  const stage1Name = normalizePokemonName(getDefinitionSafe(state, stage1.definitionId).name);
  const name = def.name.toLowerCase();

  let score = 90;
  if (def.evolvesFrom) {
    const pre = normalizePokemonName(def.evolvesFrom);
    const preInPlay = allPokemonInPlay(player).some(
      (pokemon) =>
        normalizePokemonName(getDefinitionSafe(state, pokemon.definitionId).name) === pre,
    );
    if (pre === stage1Name || preInPlay) score += 30;
    else score -= 25;
  }

  let copies = 0;
  for (const pokemon of allPokemonInPlay(player)) {
    const pokemonName = getDefinitionSafe(state, pokemon.definitionId).name.toLowerCase();
    if (pokemonName === name) copies += 1;
  }
  score -= 20 * Math.max(0, copies - 1);

  return score;
}

function bestGrandTreeStage2Score(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  stage1: CardInstance,
  options: CardInstance[],
): number {
  if (options.length === 0) return 0;
  return Math.max(...options.map((card) => scoreGrandTreeStage2Option(state, playerId, stage1, card)));
}

export function getGrandTreeStage2Options(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  stage1: CardInstance,
): CardInstance[] {
  const stage1Def = getDefinitionSafe(state, stage1.definitionId);
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const evoDef = getDefinitionSafe(state, card.definitionId);
    return isStage2(evoDef) && canEvolveInto(stage1Def, evoDef);
  });
}

export function startGrandTreeFlow(state: EngineState, playerId: import("../../models/enums").PlayerId): void {
  const basics = getGrandTreeEligibleBasics(state, playerId);
  if (basics.length === 0) return;
  state.pendingAction = {
    type: "GRAND_TREE",
    playerId,
    step: "BASIC",
    options: basics.map((pokemon) => pokemon.instanceId),
  };
  logMessage(state, "Grand Tree: choose a Basic Pokémon to evolve from your deck.");
}

export function resolveGrandTreeBasic(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  basicTargetId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "GRAND_TREE" || pending.playerId !== playerId || pending.step !== "BASIC") return;
  if (!pending.options.includes(basicTargetId)) return;

  const player = getPlayer(state, playerId);
  const basic =
    player.active?.instanceId === basicTargetId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === basicTargetId);
  if (!basic) return;

  const stage1Options = getGrandTreeStage1Options(state, playerId, basic);
  if (stage1Options.length === 0) {
    state.pendingAction = null;
    return;
  }

  state.pendingAction = {
    type: "GRAND_TREE",
    playerId,
    step: "STAGE1",
    basicTargetId,
    options: stage1Options.map((card) => card.instanceId),
  };
  logMessage(state, "Grand Tree: choose a Stage 1 Pokémon from your deck.");
}

function replacePokemonInPlay(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  targetId: string,
  replacement: CardInstance,
): void {
  const player = getPlayer(state, playerId);
  if (player.active?.instanceId === targetId) {
    player.active = replacement;
    return;
  }
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === targetId);
  if (benchIndex >= 0) player.bench[benchIndex] = replacement;
}

function evolveFromDeckOntoTarget(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  targetId: string,
  evolutionInstanceId: string,
): CardInstance | null {
  const player = getPlayer(state, playerId);
  const deckIndex = player.deck.findIndex((card) => card.instanceId === evolutionInstanceId);
  if (deckIndex === -1) return null;

  const target =
    player.active?.instanceId === targetId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === targetId);
  if (!target) return null;

  const evolution = player.deck.splice(deckIndex, 1)[0]!;
  const evoDef = getDefinitionSafe(state, evolution.definitionId);
  const targetDef = getDefinitionSafe(state, target.definitionId);
  if (!canEvolveInto(targetDef, evoDef)) {
    player.deck.push(evolution);
    return null;
  }

  transferPokemonStateOntoEvolution(state, target, evolution, playerId);
  replacePokemonInPlay(state, playerId, targetId, evolution);
  logMessage(state, `${player.name} evolved to ${evoDef.name} with Grand Tree.`);
  return evolution;
}

export function resolveGrandTreeStage1(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  evolutionInstanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "GRAND_TREE" || pending.playerId !== playerId || pending.step !== "STAGE1") return;
  if (!pending.basicTargetId || !pending.options.includes(evolutionInstanceId)) return;

  const stage1 = evolveFromDeckOntoTarget(state, playerId, pending.basicTargetId, evolutionInstanceId);
  if (!stage1) {
    state.pendingAction = null;
    return;
  }

  const stage2Options = getGrandTreeStage2Options(state, playerId, stage1);
  if (stage2Options.length === 0) {
    finishGrandTree(state, playerId);
    return;
  }
  if (bestGrandTreeStage2Score(state, playerId, stage1, stage2Options) < GRAND_TREE_STAGE2_MIN_SCORE) {
    finishGrandTree(state, playerId);
    return;
  }

  state.pendingAction = {
    type: "GRAND_TREE",
    playerId,
    step: "STAGE2",
    stage1TargetId: stage1.instanceId,
    options: stage2Options.map((card) => card.instanceId),
  };
  logMessage(state, "Grand Tree: you may choose a Stage 2 Pokémon from your deck (or skip).");
}

export function resolveGrandTreeStage2(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  evolutionInstanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "GRAND_TREE" || pending.playerId !== playerId || pending.step !== "STAGE2") return;
  if (!pending.stage1TargetId || !pending.options.includes(evolutionInstanceId)) return;

  evolveFromDeckOntoTarget(state, playerId, pending.stage1TargetId, evolutionInstanceId);
  finishGrandTree(state, playerId);
}

export function skipGrandTreeStage2(state: EngineState, playerId: import("../../models/enums").PlayerId): void {
  const pending = state.pendingAction;
  if (pending?.type !== "GRAND_TREE" || pending.playerId !== playerId || pending.step !== "STAGE2") return;
  finishGrandTree(state, playerId);
}

function finishGrandTree(state: EngineState, playerId: import("../../models/enums").PlayerId): void {
  shufflePlayerDeck(state, playerId);
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(state, "Grand Tree: shuffled deck.");
}
