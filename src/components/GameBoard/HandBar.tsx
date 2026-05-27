import type { CardDefinition } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import type { EngineState } from "@/lib/engine";
import { BoardCard } from "./BoardCard";

interface HandBarProps {
  game: EngineState;
  hand: CardInstance[];
  selectedId?: string;
  onSelect: (card: CardInstance) => void;
  getQuickLabel?: (def: CardDefinition) => string | null;
  /** Player name shown as prefix in the label */
  playerName?: string;
  /** Flips border/gradient direction (for the opponent row at the top) */
  isOpponent?: boolean;
}

export function HandBar({ game, hand, selectedId, onSelect, getQuickLabel, playerName, isOpponent }: HandBarProps) {
  const cls = `hand-bar${isOpponent ? " hand-bar--opponent" : ""}`;
  if (hand.length === 0) {
    return <div className={`${cls} hand-bar--empty`}>{playerName ?? "Hand"} — empty</div>;
  }

  return (
    <div className={cls}>
      <div className="hand-bar__label">
        {playerName && <span className="hand-bar__player">{playerName}</span>}
        Hand · {hand.length} cards
      </div>
      <div className="hand-bar__cards">
        {hand.map((card) => {
          const def = game.definitions[card.definitionId];
          const quick = def && getQuickLabel ? getQuickLabel(def) : null;
          return (
            <div key={card.instanceId} className="hand-bar__slot">
              <BoardCard
                state={game}
                card={card}
                size="hand"
                selected={selectedId === card.instanceId}
                onSelect={() => onSelect(card)}
              />
              {quick && <span className="hand-bar__quick">{quick}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
