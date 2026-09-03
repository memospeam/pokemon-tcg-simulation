import { useMemo } from "react";
import { getOpponentId, getPlayer, type EngineState } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import type { MatchVisibility } from "./types";

export interface MatchViewModel {
  viewingPlayerId: PlayerId;
  opponentPlayerId: PlayerId;
  self: ReturnType<typeof getPlayer>;
  opponent: ReturnType<typeof getPlayer>;
  isMyTurn: boolean;
  hideOpponentHand: boolean;
  opponentHandCount: number;
}

export function useMatchView(
  game: EngineState | null,
  viewingPlayerId: PlayerId,
  visibility: MatchVisibility,
): MatchViewModel | null {
  return useMemo(() => {
    if (!game) return null;
    const opponentPlayerId = getOpponentId(viewingPlayerId);
    const self = getPlayer(game, viewingPlayerId);
    const opponent = getPlayer(game, opponentPlayerId);
    return {
      viewingPlayerId,
      opponentPlayerId,
      self,
      opponent,
      isMyTurn: game.currentPlayerId === viewingPlayerId,
      hideOpponentHand: visibility === "player",
      opponentHandCount: opponent.hand.length,
    };
  }, [game, viewingPlayerId, visibility]);
}
