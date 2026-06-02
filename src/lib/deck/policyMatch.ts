/**
 * Async AI-vs-AI runner driven by TurnPolicy objects (policy.ts), so either
 * player can be the heuristic AI or an LLM agent.
 *
 * This is a parallel, additive runner — the synchronous runAutoMatch /
 * runMatchFromBuiltDecks used by CI and the meta playtest are untouched. The
 * loop mirrors runAutoMatch's structure: resolve pending actions with the
 * existing heuristic drainAutoPending, then ask the active player's policy for
 * the next main-phase action, apply it, and repeat.
 */
import { gameReducer } from "../engine/reducer";
import {
  getDefinition,
  getPlayer,
  type EngineState,
  type GameAction,
} from "../engine/types";
import { GamePhase, PlayerId } from "../models/enums";
import { buildStrategyContext, type StrategyContext } from "./deckStrategy";
import {
  autoSetupEngineState,
  beginMatchFromBuiltDecks,
  drainAutoPending,
  isPlayStalled,
  type GameRunOptions,
  type GameRunResult,
} from "./metaGameRunner";
import type { BuiltDeck } from "./builder";
import type { TurnPolicy } from "./policy";

export interface PolicyMatchOptions extends GameRunOptions {
  /** Optional cap on policy.decide() calls before falling back to end-turn. */
  maxDecisions?: number;
  /** Collect a human-readable action transcript for debugging / reports. */
  transcript?: string[];
}

function describeAction(state: EngineState, action: GameAction): string {
  switch (action.type) {
    case "ATTACK":
      return `ATTACK ${action.attackName}`;
    case "ATTACH_ENERGY": {
      const tgt = [...Object.values(state.players)].flatMap((p) => [
        ...(p.active ? [p.active] : []),
        ...p.bench,
      ]).find((c) => c.instanceId === action.targetId);
      const name = tgt ? getDefinition(state, tgt.definitionId)?.name : "?";
      return `ATTACH_ENERGY → ${name ?? "?"}`;
    }
    case "PLAY_TRAINER":
    case "EVOLVE":
    case "PLAY_BASIC_TO_BENCH":
    case "USE_ABILITY":
    case "RETREAT":
      return action.type;
    default:
      return action.type;
  }
}

/**
 * Run a single game where each player's main-phase decisions come from its
 * TurnPolicy. Pending sub-choices are resolved by the heuristic drainAutoPending.
 */
export async function runPolicyMatch(
  initialState: EngineState,
  p1Policy: TurnPolicy,
  p2Policy: TurnPolicy,
  options: PolicyMatchOptions = {},
): Promise<GameRunResult> {
  const maxTurns = options.maxTurns ?? 45;
  const maxActions = options.maxActions ?? 360;
  const maxDecisions = options.maxDecisions ?? Number.POSITIVE_INFINITY;
  const transcript = options.transcript;

  let state = initialState;
  let turnCount = 0;
  let actionCount = 0;
  let decisions = 0;

  const ctxCache: Partial<Record<PlayerId, StrategyContext>> = {};
  function ctxFor(playerId: PlayerId): StrategyContext {
    if (!ctxCache[playerId]) {
      const p = getPlayer(state, playerId);
      const names = [...p.deck, ...p.hand, ...(p.active ? [p.active] : []), ...p.bench, ...p.discard]
        .map((c) => getDefinition(state, c.definitionId)?.name ?? "");
      ctxCache[playerId] = buildStrategyContext(names);
    }
    return ctxCache[playerId]!;
  }
  const policyFor = (playerId: PlayerId): TurnPolicy =>
    playerId === PlayerId.P1 ? p1Policy : p2Policy;

  const drainHere = (): boolean => {
    // Returns true if the match should stop (stalled / finished).
    const drained = drainAutoPending(state, 12, ctxFor(state.pendingAction!.playerId));
    state = drained.state;
    actionCount += drained.steps;
    return isPlayStalled(state) || state.phase !== GamePhase.Active || !!state.winnerId;
  };

  while (
    actionCount < maxActions &&
    turnCount < maxTurns &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  ) {
    if (state.pendingAction) {
      if (drainHere()) break;
      continue;
    }

    const playerId = state.currentPlayerId;
    const ctx = ctxFor(playerId);

    let action: GameAction | null = null;
    if (decisions < maxDecisions) {
      action = await policyFor(playerId).decide(state, playerId, ctx);
      decisions += 1;
    }

    if (!action) {
      // End the turn.
      const beforeTurn = state.turnNumber;
      state = gameReducer(state, { type: "END_TURN" });
      actionCount += 1;
      if (state.turnNumber > beforeTurn) turnCount += 1;
      continue;
    }

    const beforeTurn = state.turnNumber;
    const beforePlayer = state.currentPlayerId;
    const beforeRetreated = state.turnFlags.retreated;

    state = gameReducer(state, action);
    actionCount += 1;
    if (transcript) transcript.push(`T${state.turnNumber} ${playerId}: ${describeAction(state, action)}`);

    // No-op guard: a RETREAT that didn't take (affordability/payment mismatch)
    // must not be retried forever — the policy would keep returning it.
    if (action.type === "RETREAT" && state.turnFlags.retreated === beforeRetreated) {
      const beforeT = state.turnNumber;
      state = gameReducer(state, { type: "END_TURN" });
      actionCount += 1;
      if (state.turnNumber > beforeT) turnCount += 1;
      continue;
    }

    if (state.pendingAction) {
      if (drainHere()) break;
    }
    if (state.phase !== GamePhase.Active || state.winnerId) break;
    if (state.currentPlayerId !== beforePlayer || state.turnNumber > beforeTurn) {
      turnCount += 1;
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

/** Convenience: build decks → setup → run a policy match. */
export async function runPolicyMatchFromBuiltDecks(
  input: {
    player1Name: string;
    player2Name: string;
    player1Deck: BuiltDeck;
    player2Deck: BuiltDeck;
    seed?: number;
  },
  p1Policy: TurnPolicy,
  p2Policy: TurnPolicy,
  options: PolicyMatchOptions & { maxMulligans?: number } = {},
): Promise<GameRunResult> {
  let state = beginMatchFromBuiltDecks(input);
  state = autoSetupEngineState(state, {
    placeBenchBasics: true,
    maxMulligans: options.maxMulligans ?? 40,
  });
  return runPolicyMatch(state, p1Policy, p2Policy, options);
}
