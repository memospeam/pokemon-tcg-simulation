/**
 * LlmPolicy: a TurnPolicy whose main-phase decisions come from an LLM that
 * reads the board observation (including card effect text) and picks among the
 * legal actions. Any failure — no candidates, parse error, illegal pick, call
 * cap exceeded, or a thrown client error — falls back to the deterministic
 * heuristic so a game never crashes or hangs.
 */
import type { EngineState, GameAction } from "../../engine/types";
import type { PlayerId } from "../../models/enums";
import type { StrategyContext } from "../deckStrategy";
import { pickHeuristicMainAction } from "../metaGameRunner";
import type { TurnPolicy } from "../policy";
import type { CompleteFn } from "./client";
import {
  buildObservation,
  enumerateMainPhaseActions,
  parseActionChoice,
  renderActionMenu,
} from "./observation";

const SYSTEM_PROMPT = [
  "You are an expert Pokémon Trading Card Game player driving one side of a match.",
  "Each turn you are given the board state (your cards include their full attack",
  "and ability text) and a numbered list of the legal actions you may take right",
  "now. Choose the single best action to maximise your chance of winning —",
  "taking prizes by knocking out the opponent's Active Pokémon, while developing",
  "your board and not decking yourself out.",
  "",
  "Reply with ONLY the number of the action you choose, optionally followed by a",
  "brief reason. Example: \"3 - attach Fire to set up Phantom Dive next turn\".",
  "Do not output anything before the number.",
].join("\n");

export interface LlmPolicyOptions {
  /** Max LLM calls per game; after this, fall back to heuristic. Default 80. */
  maxCalls?: number;
  /** Called on each fallback (for diagnostics). */
  onFallback?: (reason: string) => void;
}

export class LlmPolicy implements TurnPolicy {
  readonly name = "llm";
  private calls = 0;
  private readonly maxCalls: number;
  private readonly complete: CompleteFn;
  private readonly onFallback?: (reason: string) => void;

  constructor(complete: CompleteFn, options: LlmPolicyOptions = {}) {
    this.complete = complete;
    this.maxCalls = options.maxCalls ?? 80;
    this.onFallback = options.onFallback;
  }

  async decide(
    state: EngineState,
    playerId: PlayerId,
    ctx: StrategyContext,
  ): Promise<GameAction | null> {
    const candidates = enumerateMainPhaseActions(state, playerId);
    // Only END_TURN available → nothing to ask the model.
    if (candidates.length <= 1) return null;

    if (this.calls >= this.maxCalls) {
      this.onFallback?.("call-cap");
      return pickHeuristicMainAction(state, playerId, ctx);
    }
    this.calls += 1;

    const user = `${buildObservation(state, playerId)}\n\nLEGAL ACTIONS:\n${renderActionMenu(candidates)}\n\nWhich action number do you choose?`;

    let reply: string;
    try {
      reply = await this.complete(SYSTEM_PROMPT, user);
    } catch (err) {
      this.onFallback?.(`error:${(err as Error)?.message ?? "unknown"}`);
      return pickHeuristicMainAction(state, playerId, ctx);
    }

    const chosen = parseActionChoice(reply, candidates);
    if (!chosen) {
      this.onFallback?.("parse-fail");
      return pickHeuristicMainAction(state, playerId, ctx);
    }
    // END_TURN sentinel → end the turn.
    return chosen.type === "END_TURN" ? null : chosen;
  }
}
