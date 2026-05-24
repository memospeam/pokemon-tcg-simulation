import { canAffordAttack } from "../engine/energy";
import { gameReducer } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { getPlayer, type EngineState } from "../engine/types";
import { GamePhase, PlayerId } from "../models/enums";

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
