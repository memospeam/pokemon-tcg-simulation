import type { BuiltDeck } from "./builder";
import { buildDeckFromText } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import { canAffordAttack } from "../engine/energy";
import { checkMulliganNeeded } from "../engine/rules";
import { beginGame, gameReducer, getLegalActions, startActiveGame } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { isBasicPokemon, isSupporter } from "../models/definition";
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
function drainAutoPending(state: EngineState, maxSteps = 12): { state: EngineState; steps: number } {
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

function isPlayStalled(state: EngineState): boolean {
  return (
    state.pendingAction !== null &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  );
}

function pickAutoTrainerAction(state: EngineState): Extract<GameAction, { type: "PLAY_TRAINER" }> | null {
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
      if (!bench) return null;
      return gameReducer(state, {
        type: "SWITCH_WITH_BENCH",
        playerId,
        benchInstanceId: bench.instanceId,
      });
    }
    case "DRAW_UNTIL_HAND":
      if (!pending.optional) return null;
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
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
      if (!bench) return null;
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
      const basic =
        player.active && isBasicPokemon(getDefinitionSafe(state, player.active.definitionId))
          ? player.active
          : player.bench.find((entry) => isBasicPokemon(getDefinitionSafe(state, entry.definitionId)));
      if (!basic) return null;
      return gameReducer(state, {
        type: "SELECT_RARE_CANDY_BASIC",
        playerId,
        targetId: basic.instanceId,
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
    default:
      return null;
  }
}
