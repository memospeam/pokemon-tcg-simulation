import type { BuiltDeck } from "./builder";
import { buildDeckFromText } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import { canAffordAttack } from "../engine/energy";
import { checkMulliganNeeded } from "../engine/rules";
import { beginGame, gameReducer, startActiveGame } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { isBasicPokemon } from "../models/definition";
import { GamePhase, PlayerId } from "../models/enums";
import { getDefinition, getPlayer, type EngineState } from "../engine/types";

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
      return {
        state,
        turnCount,
        actionCount,
        stalled: true,
        winnerId: state.winnerId,
      };
    }

    const playerId = state.currentPlayerId;
    const player = getPlayer(state, playerId);
    let attacked = false;

    if (player.active && !state.turnFlags.attacked) {
      const def = getDefinitionSafe(state, player.active.definitionId);
      for (const attack of def.attacks ?? []) {
        if (!canAffordAttack(state, player.active, attack)) continue;
        const beforeTurn = state.turnNumber;
        const beforePlayer = state.currentPlayerId;
        state = gameReducer(state, { type: "ATTACK", playerId, attackName: attack.name });
        actionCount += 1;
        attacked = true;
        if (state.pendingAction) {
          return {
            state,
            turnCount,
            actionCount,
            stalled: true,
            winnerId: state.winnerId,
          };
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
    stalled: state.pendingAction !== null,
    winnerId: state.winnerId,
  };
}

export { checkMulliganNeeded };
