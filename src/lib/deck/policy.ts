/**
 * Turn-policy seam: an abstraction over "what main-phase action should the
 * active player take?" so the AI-vs-AI runner (policyMatch.ts) can be driven
 * by either the deterministic heuristic chain or an LLM agent — for either
 * player independently (LLM-vs-heuristic or LLM-vs-LLM).
 *
 * A policy chooses ONLY the top-level main-phase action; the runner applies it
 * and resolves any resulting pendingAction via the existing heuristic
 * drainAutoPending. Returning null means "end the turn".
 */
import type { EngineState, GameAction } from "../engine/types";
import type { PlayerId } from "../models/enums";
import type { StrategyContext } from "./deckStrategy";
import { pickHeuristicMainAction } from "./metaGameRunner";

export interface TurnPolicy {
  /** Human-readable label for reports (e.g. "heuristic", "llm"). */
  readonly name: string;
  /**
   * Choose the next main-phase action for `playerId`, or null to end the turn.
   * May be async (LLM policies call the network).
   */
  decide(
    state: EngineState,
    playerId: PlayerId,
    ctx: StrategyContext,
  ): Promise<GameAction | null>;
}

/**
 * The current deterministic AI, wrapped as a TurnPolicy. Delegates to
 * pickHeuristicMainAction so behaviour is identical to runAutoMatch's loop.
 */
export class HeuristicPolicy implements TurnPolicy {
  readonly name = "heuristic";

  async decide(
    state: EngineState,
    playerId: PlayerId,
    ctx: StrategyContext,
  ): Promise<GameAction | null> {
    return pickHeuristicMainAction(state, playerId, ctx);
  }
}
