import type { BuiltDeck } from "./builder";
import { buildDeckFromText } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import { canAffordAttack } from "../engine/energy";
import { canRareCandyEvolveInto, checkMulliganNeeded } from "../engine/rules";
import { beginGame, gameReducer, getLegalActions, startActiveGame } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { isBasicPokemon, isStage2, isSupporter } from "../models/definition";
import { GamePhase, PlayerId } from "../models/enums";
import { getDefinition, getOpponentId, getPlayer, type EngineState, type GameAction } from "../engine/types";

export interface GameRunResult {
  state: EngineState;
  turnCount: number;
  actionCount: number;
  stalled: boolean;
  winnerId: PlayerId | null;
}

export interface GameRunOptions {
  maxTurns?: number;
  maxActions?: number;
}

export interface MatchSetupOptions {
  seed?: number;
  maxMulligans?: number;
  placeBenchBasics?: boolean;
}

export interface TournamentMatchResult extends GameRunResult {
  setupComplete: boolean;
  resolveErrors: string[];
}

function findBasicInHand(state: EngineState, playerId: PlayerId) {
  return getPlayer(state, playerId).hand.find((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isBasicPokemon(def);
  });
}

export function beginMatchFromBuiltDecks(input: {
  player1Name: string;
  player2Name: string;
  player1Deck: BuiltDeck;
  player2Deck: BuiltDeck;
  seed?: number;
}): EngineState {
  const extraDefinitions = [
    ...input.player1Deck.definitions.values(),
    ...input.player2Deck.definitions.values(),
  ];
  return beginGame({
    player1Name: input.player1Name,
    player2Name: input.player2Name,
    player1Cards: input.player1Deck.cards,
    player2Cards: input.player2Deck.cards,
    extraDefinitions,
    seed: input.seed,
  });
}

export function autoSetupEngineState(
  state: EngineState,
  options: MatchSetupOptions = {},
): EngineState {
  const maxMulligans = options.maxMulligans ?? 30;
  let next = state;
  let mulligans = 0;

  while (next.phase === GamePhase.Mulligan && next.pendingMulliganPlayerId && mulligans < maxMulligans) {
    next = gameReducer(next, { type: "MULLIGAN", playerId: next.pendingMulliganPlayerId });
    mulligans += 1;
  }

  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(next, playerId);
    if (player.active) continue;
    const basic = findBasicInHand(next, playerId);
    if (!basic) continue;
    next = gameReducer(next, {
      type: "PLACE_ACTIVE",
      playerId,
      instanceId: basic.instanceId,
    });
  }

  if (options.placeBenchBasics) {
    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      let safety = 0;
      while (next.phase === GamePhase.PlaceBench && safety < 10) {
        const player = getPlayer(next, playerId);
        if (player.bench.length >= 5) break;
        const basic = findBasicInHand(next, playerId);
        if (!basic) break;
        next = gameReducer(next, {
          type: "PLACE_BENCH",
          playerId,
          instanceId: basic.instanceId,
        });
        safety += 1;
      }
    }
  }

  return startActiveGame(next);
}

export function runMatchFromBuiltDecks(
  input: {
    player1Name: string;
    player2Name: string;
    player1Deck: BuiltDeck;
    player2Deck: BuiltDeck;
    seed?: number;
  },
  setupOptions: MatchSetupOptions = {},
  runOptions: GameRunOptions = {},
): TournamentMatchResult {
  const resolveErrors = [...input.player1Deck.resolveErrors, ...input.player2Deck.resolveErrors];
  let state = beginMatchFromBuiltDecks(input);
  state = autoSetupEngineState(state, setupOptions);
  const setupComplete =
    state.phase === GamePhase.Active &&
    !!getPlayer(state, PlayerId.P1).active &&
    !!getPlayer(state, PlayerId.P2).active;

  const run = runEngineAutoPlay(state, runOptions);
  return {
    ...run,
    setupComplete,
    resolveErrors,
  };
}

export function runTournamentPresetMatch(
  player1Preset: TournamentDeckPreset,
  player2Preset: TournamentDeckPreset,
  options: {
    seed?: number;
    setup?: MatchSetupOptions;
    run?: GameRunOptions;
    useApiResolver?: boolean;
  } = {},
): Promise<TournamentMatchResult> {
  const buildDeck = (label: string, text: string) =>
    options.useApiResolver
      ? buildDeckFromText(label, text)
      : Promise.resolve(buildPlaytestDeckFromCorpusText(label, text));

  return Promise.all([
    buildDeck(player1Preset.label, player1Preset.text),
    buildDeck(player2Preset.label, player2Preset.text),
  ]).then(([player1Deck, player2Deck]) =>
    runMatchFromBuiltDecks(
      {
        player1Name: player1Preset.player,
        player2Name: player2Preset.player,
        player1Deck,
        player2Deck,
        seed: options.seed,
      },
      options.setup,
      options.run,
    ),
  );
}

/**
 * Minimal auto-play loop: use the first affordable attack each turn, otherwise END_TURN.
 * Stops when the game finishes, hits limits, or needs player input (pendingAction).
 */
export function runEngineAutoPlay(
  initialState: EngineState,
  options: GameRunOptions = {},
): GameRunResult {
  const maxTurns = options.maxTurns ?? 40;
  const maxActions = options.maxActions ?? 400;
  let state = initialState;
  let turnCount = 0;
  let actionCount = 0;

  while (
    actionCount < maxActions &&
    turnCount < maxTurns &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  ) {
    if (state.pendingAction) {
      const drained = drainAutoPending(state);
      state = drained.state;
      actionCount += drained.steps;
      if (isPlayStalled(state)) {
        return {
          state,
          turnCount,
          actionCount,
          stalled: true,
          winnerId: state.winnerId,
        };
      }
      if (state.phase !== GamePhase.Active || state.winnerId) {
        break;
      }
      continue;
    }

    const playerId = state.currentPlayerId;
    const player = getPlayer(state, playerId);
    let attacked = false;

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const trainerAction = pickAutoTrainerAction(state);
      if (trainerAction) {
        state = gameReducer(state, trainerAction);
        actionCount += 1;
        const drained = drainAutoPending(state);
        state = drained.state;
        actionCount += drained.steps;
        if (isPlayStalled(state)) {
          return {
            state,
            turnCount,
            actionCount,
            stalled: true,
            winnerId: state.winnerId,
          };
        }
        if (state.phase !== GamePhase.Active || state.winnerId) {
          break;
        }
        continue;
      }
    }

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const basicAction = pickAutoPlayBasicAction(state);
      if (basicAction) {
        state = gameReducer(state, basicAction);
        actionCount += 1;
        continue;
      }
    }

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const evolveAction = pickAutoEvolveAction(state);
      if (evolveAction) {
        state = gameReducer(state, evolveAction);
        actionCount += 1;
        continue;
      }
    }

    if (
      !state.turnFlags.energyAttached &&
      player.active &&
      player.hand.some((card) => getDefinition(state, card.definitionId)?.supertype === "Energy")
    ) {
      const energy = player.hand.find(
        (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
      );
      if (energy) {
        state = gameReducer(state, {
          type: "ATTACH_ENERGY",
          playerId,
          energyId: energy.instanceId,
          targetId: player.active.instanceId,
        });
        actionCount += 1;
      }
    }

    if (player.active && !state.turnFlags.attacked) {
      const def = getDefinitionSafe(state, player.active.definitionId);
      for (const attack of def.attacks ?? []) {
        if (!canAffordAttack(state, player.active, attack)) continue;
        const beforeTurn = state.turnNumber;
        const beforePlayer = state.currentPlayerId;
        state = gameReducer(state, { type: "ATTACK", playerId, attackName: attack.name });
        actionCount += 1;
        attacked = true;
        const drained = drainAutoPending(state);
        state = drained.state;
        actionCount += drained.steps;
        if (isPlayStalled(state)) {
          return {
            state,
            turnCount,
            actionCount,
            stalled: true,
            winnerId: state.winnerId,
          };
        }
        if (state.phase !== GamePhase.Active || state.winnerId) {
          break;
        }
        if (state.currentPlayerId !== beforePlayer || state.turnNumber > beforeTurn) {
          turnCount += 1;
        }
        break;
      }
    }

    if (!attacked) {
      const beforeTurn = state.turnNumber;
      state = gameReducer(state, { type: "END_TURN" });
      actionCount += 1;
      if (state.turnNumber > beforeTurn) {
        turnCount += 1;
      }
    }
  }

  return {
    state,
    turnCount,
    actionCount,
    stalled: isPlayStalled(state),
    winnerId: state.winnerId,
  };
}

export { checkMulliganNeeded };

/** Resolve simple optional/target pending actions so corpus playtests can finish. */
export function drainAutoPending(state: EngineState, maxSteps = 12): { state: EngineState; steps: number } {
  let next = state;
  let steps = 0;
  while (
    steps < maxSteps &&
    next.pendingAction &&
    next.phase === GamePhase.Active &&
    !next.winnerId
  ) {
    const resolved = tryResolveAutoPending(next);
    if (!resolved) break;
    next = resolved;
    steps += 1;
  }
  return { state: next, steps };
}

export function isPlayStalled(state: EngineState): boolean {
  return (
    state.pendingAction !== null &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  );
}

export function pickAutoPlayBasicAction(
  state: EngineState,
): Extract<GameAction, { type: "PLAY_BASIC_TO_BENCH" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  if (player.bench.length >= 5) return null;

  const legal = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "PLAY_BASIC_TO_BENCH" }> =>
      action.type === "PLAY_BASIC_TO_BENCH",
  );
  if (legal.length === 0) return null;

  // Prefer basics that have a higher-stage evolution in hand or deck so we set up the attacker first.
  const hasHigherEvolution = (instanceId: string): boolean => {
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) return false;
    const def = getDefinition(state, card.definitionId);
    if (!def) return false;
    const name = def.name.toLowerCase();
    const allCards = [...player.deck, ...player.hand];
    return allCards.some((c) => {
      const d = getDefinition(state, c.definitionId);
      return d?.evolvesFrom?.toLowerCase() === name;
    });
  };

  const preferred = legal.find((action) => hasHigherEvolution(action.instanceId));
  return preferred ?? legal[0] ?? null;
}

export function pickAutoEvolveAction(state: EngineState): Extract<GameAction, { type: "EVOLVE" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  const legal = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "EVOLVE" }> => action.type === "EVOLVE",
  );
  if (legal.length === 0) return null;

  const scored = legal.map((action) => {
    const card = player.hand.find((entry) => entry.instanceId === action.evolutionId);
    const def = card ? getDefinition(state, card.definitionId) : undefined;
    if (!def) return { action, score: 0 };
    const stage = isStage2(def) ? 20 : 10;
    const isActive = player.active?.instanceId === action.targetId;
    return { action, score: stage + (isActive ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.action ?? null;
}

export function pickAutoTrainerAction(state: EngineState): Extract<GameAction, { type: "PLAY_TRAINER" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  const legal = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "PLAY_TRAINER" }> => action.type === "PLAY_TRAINER",
  );
  if (legal.length === 0) return null;

  const scored = legal
    .map((action) => {
      const card = player.hand.find((entry) => entry.instanceId === action.instanceId);
      const def = card ? getDefinition(state, card.definitionId) : undefined;
      if (!def) return { action, score: -1 };
      const name = def.name.toLowerCase();
      let score = 0;
      if (name.includes("lillie")) score = player.hand.length >= 4 ? 90 : 45;
      else if (name.includes("professor")) score = player.hand.length >= 3 ? 85 : 40;
      else if (name.includes("judge")) score = 70;
      else if (name.includes("poffin") && player.bench.length < 4) score = 65;
      else if (name.includes("night stretcher") && player.discard.some((entry) => getDefinition(state, entry.definitionId)?.supertype === "Pokémon")) {
        score = 60;
      } else if (name.includes("ultra ball") && player.hand.length >= 4) score = 55;
      else if (name.includes("boss") && opponent.bench.length > 0) score = 35;
      else if (name.includes("crispin") && player.bench.length > 0) score = 30;
      else if (name.includes("rare candy")) score = 20;
      else if (!isSupporter(def)) score = 15;
      else if (!state.turnFlags.supporterPlayed) score = 10;
      return { action, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.action ?? null;
}

function tryResolveAutoPending(state: EngineState): EngineState | null {
  const pending = state.pendingAction;
  if (!pending) return null;
  const playerId = pending.playerId;

  switch (pending.type) {
    case "DISCARD_BASIC_ENERGY_FOR_DAMAGE":
    case "DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE":
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    case "CHOOSE_OPPONENT_POKEMON_DAMAGE":
      if (pending.options.length === 0) return null;
      return gameReducer(state, {
        type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET",
        playerId,
        targetId: pending.options[0]!,
      });
    case "CHOOSE_BENCH_DAMAGE":
      if (pending.options.length === 0) return null;
      return gameReducer(state, {
        type: "CHOOSE_BENCH_DAMAGE_TARGET",
        playerId,
        targetId: pending.options[0]!,
      });
    case "SWITCH_WITH_BENCH": {
      const player = getPlayer(state, playerId);
      if (pending.optional) {
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      const bench = player.bench[0];
      if (!bench) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, {
        type: "SWITCH_WITH_BENCH",
        playerId,
        benchInstanceId: bench.instanceId,
      });
    }
    case "DRAW_UNTIL_HAND":
      return gameReducer(state, { type: "CONFIRM_DRAW_UNTIL_HAND", playerId });
    case "SEARCH_DECK":
      if (pending.filter === "MEGA_EVOLUTION_EX_HAND" || pending.filter === "SALVATORE_EVOLUTION") {
        if (pending.options.length > 0) {
          return gameReducer(state, {
            type: "PICK_DECK_CARD",
            playerId,
            instanceId: pending.options[0]!,
          });
        }
        return null;
      }
      if (pending.slotsRemaining !== undefined && pending.slotsRemaining > 1) {
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      if (pending.options.length > 0) {
        return gameReducer(state, {
          type: "PICK_DECK_CARD",
          playerId,
          instanceId: pending.options[0]!,
        });
      }
      return null;
    case "BOSS_ORDERS": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      const bench = opponent.bench[0];
      if (!bench || !opponent.active) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, {
        type: "SWITCH_OPPONENT_ACTIVE",
        playerId,
        benchInstanceId: bench.instanceId,
      });
    }
    case "ULTRA_BALL_DISCARD": {
      const player = getPlayer(state, playerId);
      const discardCandidates = player.hand.filter(
        (card) => !pending.selectedIds.includes(card.instanceId),
      );
      if (discardCandidates.length === 0) return null;
      return gameReducer(state, {
        type: "SELECT_HAND_DISCARD",
        playerId,
        instanceId: discardCandidates[0]!.instanceId,
      });
    }
    case "RARE_CANDY": {
      const player = getPlayer(state, playerId);
      const allInPlay = [
        ...(player.active ? [player.active] : []),
        ...player.bench,
      ];
      const validBasic = allInPlay.find((mon) => {
        const monDef = getDefinitionSafe(state, mon.definitionId);
        if (!isBasicPokemon(monDef) || mon.enteredPlayTurn === state.turnNumber) return false;
        return player.hand.some((card) => {
          const cardDef = getDefinitionSafe(state, card.definitionId);
          return isStage2(cardDef) && canRareCandyEvolveInto(state, monDef, cardDef);
        });
      });
      if (!validBasic) return null;
      return gameReducer(state, {
        type: "SELECT_RARE_CANDY_BASIC",
        playerId,
        targetId: validBasic.instanceId,
      });
    }
    case "CRISPIN_ATTACH": {
      const player = getPlayer(state, playerId);
      const targetId = pending.targets[0] ?? player.active?.instanceId ?? player.bench[0]?.instanceId;
      if (!targetId) return null;
      return gameReducer(state, {
        type: "SELECT_CRISPIN_TARGET",
        playerId,
        pokemonId: targetId,
      });
    }
    case "CRISPIN_DISCARD":
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    case "ERI_DISCARD":
    case "JANINE_DARKNESS":
    case "GLASS_TRUMPET":
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    case "BIANCA_HEAL": {
      const player = getPlayer(state, playerId);
      const targetId =
        pending.options[0] ?? player.active?.instanceId ?? player.bench[0]?.instanceId;
      if (!targetId) return null;
      return gameReducer(state, {
        type: "SELECT_BIANCA_HEAL",
        playerId,
        pokemonId: targetId,
      });
    }
    case "EXPLORERS_GUIDANCE": {
      const player = getPlayer(state, playerId);
      const pick = pending.revealPool.find(
        (id) =>
          !pending.pickedIds.includes(id) &&
          player.deck.some((entry) => entry.instanceId === id),
      );
      if (!pick) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pick });
    }
    case "MORTY_DISCARD": {
      const player = getPlayer(state, playerId);
      const card = player.hand[0];
      if (!card) return null;
      return gameReducer(state, {
        type: "SELECT_MORTY_DISCARD",
        playerId,
        instanceId: card.instanceId,
      });
    }
    case "SALVATORE_EVOLVE": {
      const targetId = pending.options[0];
      if (!targetId) return null;
      return gameReducer(state, {
        type: "SELECT_SALVATORE_EVOLVE",
        playerId,
        targetId,
      });
    }
    case "PERRIN":
      if (pending.step === "HAND") {
        const pick = pending.options.find((id) => !pending.pickedIds.includes(id));
        if (pick) {
          return gameReducer(state, { type: "SELECT_PERRIN_HAND", playerId, instanceId: pick });
        }
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      if (pending.step === "SEARCH") {
        const pick = pending.options.find((id) => !pending.pickedIds.includes(id));
        if (pick) {
          return gameReducer(state, { type: "SELECT_PERRIN_SEARCH", playerId, instanceId: pick });
        }
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      return null;
    case "PICK_DISCARD":
      if (pending.options.length === 0) return null;
      return gameReducer(state, {
        type: "PICK_DISCARD_POKEMON",
        playerId,
        instanceId: pending.options[0]!,
      });
    case "ATTACH_HAND_ENERGY": {
      const player = getPlayer(state, playerId);
      const energy = player.hand.find(
        (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
      );
      const targetId = pending.targetIds[0];
      if (!energy || !targetId) return null;
      return gameReducer(state, {
        type: "ATTACH_HAND_ENERGY_TO_POKEMON",
        playerId,
        pokemonId: targetId,
        energyId: energy.instanceId,
      });
    }
    case "PROMOTE": {
      const player = getPlayer(state, playerId);
      const bench = player.bench[0];
      if (!bench) {
        const finished = { ...state, pendingAction: null };
        finished.winnerId = getOpponentId(playerId);
        finished.phase = GamePhase.Finished;
        return finished;
      }
      return gameReducer(state, {
        type: "PROMOTE_BENCH",
        playerId,
        instanceId: bench.instanceId,
      });
    }
    case "DAMAGE_TWO_OPPONENT": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      const candidates = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ].filter((pokemon) => !pending.pickedIds.includes(pokemon.instanceId));
      if (candidates.length === 0) return null;
      return gameReducer(state, {
        type: "CHOOSE_OPPONENT_DAMAGE",
        playerId,
        targetId: candidates[0]!.instanceId,
      });
    }
    case "IONO_HAND_BOTTOM": {
      const player = getPlayer(state, playerId);
      const card = player.hand[0];
      if (!card) return null;
      return gameReducer(state, { type: "IONO_SELECT_HAND", playerId, instanceId: card.instanceId });
    }
    case "MOVE_ENERGY_TO_BENCH": {
      const player = getPlayer(state, playerId);
      const bench = player.bench[0];
      if (!bench) return null;
      return gameReducer(state, { type: "MOVE_ENERGY_TO_BENCH", playerId, benchInstanceId: bench.instanceId });
    }
    case "SEARCH_EVOLUTION": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "SWITCH_TYPED_BENCH": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SWITCH_WITH_BENCH", playerId, benchInstanceId: pending.options[0]! });
    }
    case "ENERGY_SWITCH": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_ENERGY_SWITCH_POKEMON", playerId, pokemonId: pending.options[0]! });
    }
    case "ENHANCED_HAMMER": {
      if (pending.step === "POKEMON") {
        const opponent = getPlayer(state, getOpponentId(playerId));
        const mon = [
          ...(opponent.active ? [opponent.active] : []),
          ...opponent.bench,
        ].find((p) => p.attachedEnergy.length > 0);
        if (!mon) return null;
        return gameReducer(state, { type: "SELECT_ENHANCED_HAMMER_POKEMON", playerId, pokemonId: mon.instanceId });
      }
      if (pending.options.length === 0) return null;
      const opt = pending.options[0]!;
      return gameReducer(state, { type: "DISCARD_OPPONENT_ENERGY", playerId, pokemonId: opt.pokemonId, energyId: opt.energyId });
    }
    case "WALLYS_COMPASSION": {
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_WALLYS_POKEMON", playerId, pokemonId: pending.options[0]! });
    }
    case "HILDA": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "DAWN":
    case "COLRESS":
    case "RECON_DIRECTIVE": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "GIOVANNI": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_GIOVANNI_BENCH", playerId, benchInstanceId: pending.options[0]! });
    }
    case "PRIME_CATCHER": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_PRIME_CATCHER_BENCH", playerId, benchInstanceId: pending.options[0]! });
    }
    case "N_PP_UP": {
      if (pending.options.length === 0) return null;
      if (pending.step === "ENERGY") {
        return gameReducer(state, { type: "SELECT_N_PP_UP_ENERGY", playerId, instanceId: pending.options[0]! });
      }
      return gameReducer(state, { type: "SELECT_N_PP_UP_TARGET", playerId, pokemonId: pending.options[0]! });
    }
    case "TOOL_SCRAPPER": {
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_TOOL_SCRAPPER", playerId, toolInstanceId: pending.options[0]! });
    }
    case "ROTO_STICK": {
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_ROTO_STICK", playerId, instanceId: remaining[0]! });
    }
    case "MIRACLE_HEADSET": {
      if (pending.pickedIds.length >= pending.maxPicks) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_MIRACLE_HEADSET", playerId, instanceId: remaining[0]! });
    }
    case "BUG_CATCHING_SET": {
      if (pending.pickedIds.length >= pending.maxPicks) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_BUG_CATCHING", playerId, instanceId: remaining[0]! });
    }
    case "SECRET_BOX": {
      if (pending.options.length === 0) return null;
      if (pending.step === "DISCARD") {
        return gameReducer(state, { type: "SELECT_SECRET_BOX_DISCARD", playerId, instanceId: pending.options[0]! });
      }
      return gameReducer(state, { type: "SELECT_SECRET_BOX_SEARCH", playerId, instanceId: pending.options[0]! });
    }
    case "CIPHERMANIAC": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_CIPHERMANIAC_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "FIGHTING_GONG": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_FIGHTING_GONG", playerId, instanceId: pending.options[0]! });
    }
    case "LANAS_AID": {
      if (pending.pickedIds.length >= 3) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "PICK_DISCARD_POKEMON", playerId, instanceId: remaining[0]! });
    }
    case "BROCKS_SCOUTING": {
      if (pending.step === "MODE") {
        return gameReducer(state, { type: "SELECT_BROCK_MODE", playerId, mode: "basic" });
      }
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "ROSAS_ENCOURAGEMENT": {
      if (pending.step === "TARGET") {
        if (pending.options.length === 0) return null;
        return gameReducer(state, { type: "SELECT_ROSA_TARGET", playerId, pokemonId: pending.options[0]! });
      }
      const picked = pending.pickedEnergyIds ?? [];
      if (picked.length >= 2) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !picked.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_ROSA_ENERGY", playerId, instanceId: remaining[0]! });
    }
    case "SURFER": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_SURFER_BENCH", playerId, benchInstanceId: pending.options[0]! });
    }
    case "GRAND_TREE": {
      if (pending.step === "BASIC") {
        if (pending.options.length === 0) return null;
        return gameReducer(state, { type: "SELECT_GRAND_TREE_BASIC", playerId, targetId: pending.options[0]! });
      }
      if (pending.step === "STAGE1") {
        if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_GRAND_TREE_STAGE2", playerId });
        return gameReducer(state, { type: "SELECT_GRAND_TREE_STAGE1", playerId, instanceId: pending.options[0]! });
      }
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_GRAND_TREE_STAGE2", playerId });
      return gameReducer(state, { type: "SELECT_GRAND_TREE_STAGE2", playerId, instanceId: pending.options[0]! });
    }
    case "CRUSHING_HAMMER": {
      if (pending.options.length === 0) return null;
      const cOpt = pending.options[0]!;
      return gameReducer(state, { type: "DISCARD_OPPONENT_ENERGY", playerId, pokemonId: cOpt.pokemonId, energyId: cOpt.energyId });
    }
    case "DISTRIBUTE_BENCH_DAMAGE": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      const bench = opponent.bench[0];
      if (!bench) return null;
      return gameReducer(state, { type: "ASSIGN_BENCH_DAMAGE", playerId, targetId: bench.instanceId });
    }
    case "MOVE_DAMAGE": {
      if (pending.step === "SOURCE") {
        const owner = getPlayer(state, playerId);
        const mon = [...(owner.active ? [owner.active] : []), ...owner.bench].find(
          (p) => p.damageCounters > 0,
        );
        if (!mon) return null;
        return gameReducer(state, { type: "MOVE_DAMAGE_SOURCE", playerId, sourceId: mon.instanceId });
      }
      const targetPlayerId = pending.targetSide === "opponent" ? getOpponentId(playerId) : playerId;
      const targetPlayer = getPlayer(state, targetPlayerId);
      const targetMon = targetPlayer.active ?? targetPlayer.bench[0];
      if (!targetMon) return null;
      return gameReducer(state, { type: "MOVE_DAMAGE_TARGET", playerId, targetId: targetMon.instanceId });
    }
    case "REDISTRIBUTE_OPPONENT_COUNTERS": {
      if (pending.step === "SOURCE") {
        const opponent = getPlayer(state, getOpponentId(playerId));
        const mon = [...(opponent.active ? [opponent.active] : []), ...opponent.bench].find(
          (p) => p.damageCounters > 0,
        );
        if (!mon) {
          if (pending.optional) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
          return null;
        }
        return gameReducer(state, { type: "SELECT_REDISTRIBUTE_SOURCE", playerId, sourceId: mon.instanceId });
      }
      const opponent = getPlayer(state, getOpponentId(playerId));
      const targetMon = [...(opponent.active ? [opponent.active] : []), ...opponent.bench].find(
        (p) => p.instanceId !== pending.sourceId,
      );
      if (!targetMon) return null;
      return gameReducer(state, { type: "SELECT_REDISTRIBUTE_TARGET", playerId, targetId: targetMon.instanceId });
    }
    case "COPY_BENCH_ATTACK": {
      if (pending.options.length === 0) return null;
      const copyOpt = pending.options[0]!;
      return gameReducer(state, { type: "CHOOSE_BENCH_ATTACK", playerId, benchPokemonId: copyOpt.benchPokemonId, attackName: copyOpt.attackName });
    }
    case "ABILITY_DISCARD_HAND": {
      const player = getPlayer(state, playerId);
      const card = player.hand[0];
      if (!card) return null;
      return gameReducer(state, { type: "SELECT_HAND_DISCARD", playerId, instanceId: card.instanceId });
    }
    case "ABILITY_DISCARD_HAND_ENERGY": {
      const player = getPlayer(state, playerId);
      const energy = player.hand.find(
        (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
      );
      if (!energy) return null;
      return gameReducer(state, { type: "SELECT_HAND_DISCARD", playerId, instanceId: energy.instanceId });
    }
    case "CHOOSE_BLOCKED_ATTACK": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "CHOOSE_BLOCKED_ATTACK", playerId, attackName: pending.options[0]! });
    }
    default:
      return null;
  }
}
