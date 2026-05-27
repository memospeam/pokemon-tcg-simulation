import { GamePhase } from "@/lib/models/enums";
import type { PlayerId } from "@/lib/models/enums";

interface ActionDockProps {
  phase: GamePhase;
  isMyTurn: boolean;
  hasPendingAction: boolean;
  canStart: boolean;
  viewingId: PlayerId;
  currentId: PlayerId;
  opponentId: PlayerId;
  onEndTurn: () => void;
  onSwitchSide?: () => void;
  onJumpToCurrent: () => void;
  onMulligan?: () => void;
  onStartGame: () => void;
  onConcede: () => void;
  showMulligan: boolean;
}

export function ActionDock({
  phase,
  isMyTurn,
  hasPendingAction,
  canStart,
  onEndTurn,
  onSwitchSide,
  onJumpToCurrent,
  onMulligan,
  onStartGame,
  onConcede,
  showMulligan,
}: ActionDockProps) {
  return (
    <div className="action-dock">
      <div className="action-dock__group">
        {onSwitchSide && (
          <button type="button" className="action-dock__secondary" onClick={onSwitchSide}>
            Switch side
          </button>
        )}
        <button type="button" className="action-dock__secondary" onClick={onJumpToCurrent}>
          Current player
        </button>
      </div>

      <div className="action-dock__group action-dock__group--primary">
        {showMulligan && onMulligan && (
          <button type="button" className="action-dock__warn" onClick={onMulligan}>
            Mulligan
          </button>
        )}
        {canStart && (
          <button type="button" className="action-dock__primary" onClick={onStartGame}>
            Start game
          </button>
        )}
        {phase === GamePhase.Active && isMyTurn && !hasPendingAction && (
          <button type="button" className="action-dock__primary" onClick={onEndTurn}>
            End turn
          </button>
        )}
      </div>

      <div className="action-dock__group">
        <button type="button" className="action-dock__danger" onClick={onConcede}>
          Concede
        </button>
      </div>
    </div>
  );
}
