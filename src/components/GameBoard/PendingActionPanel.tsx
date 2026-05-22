import type { EngineState } from "@/lib/engine";
import { getDefinition, getPlayer } from "@/lib/engine";
import type { CardInstance } from "@/lib/models/instance";
import { BoardCard } from "./BoardCard";

interface PendingActionPanelProps {
  game: EngineState;
  onPickDeck: (instanceId: string) => void;
  onSkipOptional: () => void;
}

export function PendingActionPanel({
  game,
  onPickDeck,
  onSkipOptional,
}: PendingActionPanelProps) {
  const pending = game.pendingAction;
  if (!pending) return null;

  if (pending.type === "SEARCH_DECK") {
    const cards = pending.options
      .map((id) => {
        const player = getPlayer(game, pending.playerId);
        return player.deck.find((entry) => entry.instanceId === id) ?? null;
      })
      .filter(Boolean) as CardInstance[];

    return (
      <div className="pending-panel">
        <h4>Deck search</h4>
        <div className="pending-panel__cards">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button key={card.instanceId} type="button" className="pending-panel__pick" onClick={() => onPickDeck(card.instanceId)}>
                <BoardCard state={game} card={card} size="hand" showName={false} />
                <span>{def?.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (pending.type === "RECON_DIRECTIVE") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];

    return (
      <div className="pending-panel">
        <h4>Recon Directive — top of deck</h4>
        <div className="pending-panel__cards">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button key={card.instanceId} type="button" className="pending-panel__pick" onClick={() => onPickDeck(card.instanceId)}>
                <BoardCard state={game} card={card} size="hand" showName={false} />
                <span>{def?.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (pending.type === "CRISPIN_DISCARD") {
    return (
      <div className="pending-panel pending-panel--compact">
        <p>Crispin: optionally discard 1 card from hand to draw 2.</p>
        <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
          Skip optional effect
        </button>
      </div>
    );
  }

  return null;
}
