import { GamePhase } from "@/lib/models/enums";
import type { EngineState } from "@/lib/engine";
import { getPlayer } from "@/lib/engine";

interface TurnBannerProps {
  game: EngineState;
  prompt: string;
  isMyTurn: boolean;
}

export function TurnBanner({ game, prompt, isMyTurn }: TurnBannerProps) {
  const current = getPlayer(game, game.currentPlayerId);

  return (
    <div className={`turn-banner${isMyTurn ? " turn-banner--active" : ""}`}>
      <div className="turn-banner__main">
        <span className="turn-banner__label">Turn {game.turnNumber}</span>
        <strong>{current.name}'s turn</strong>
        {game.phase !== GamePhase.Active && (
          <span className="turn-banner__phase">{game.phase}</span>
        )}
      </div>
      <p className="turn-banner__prompt">{prompt}</p>
      <div className="turn-banner__flags">
        {game.phase === GamePhase.Active && (
          <>
            <span data-used={game.turnFlags.energyAttached}>Energy</span>
            <span data-used={game.turnFlags.supporterPlayed}>Supporter</span>
            <span data-used={game.turnFlags.attacked}>Attack</span>
            {game.itemPlayBlockedForPlayerId === game.currentPlayerId && (
              <span className="turn-banner__lock">Items locked</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
