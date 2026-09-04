import type { PointerEvent } from "react";
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
  canDragHandCard?: (instanceId: string) => boolean;
  onHandDragStart?: (card: CardInstance) => void;
  onHandDragEnd?: () => void;
  onHandPointerDown?: (card: CardInstance, event: PointerEvent) => void;
  onHandPointerUp?: (event: PointerEvent) => void;
  touchDragCardId?: string | null;
  showKeyboardIndex?: boolean;
  /** Player name shown as prefix in the label */
  playerName?: string;
  /** Flips border/gradient direction (for the opponent row at the top) */
  isOpponent?: boolean;
}

export function HandBar({
  game,
  hand,
  selectedId,
  onSelect,
  getQuickLabel,
  canDragHandCard,
  onHandDragStart,
  onHandDragEnd,
  onHandPointerDown,
  onHandPointerUp,
  touchDragCardId,
  showKeyboardIndex = false,
  playerName,
  isOpponent,
}: HandBarProps) {
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
        {hand.map((card, index) => {
          const def = game.definitions[card.definitionId];
          const quick = def && getQuickLabel ? getQuickLabel(def) : null;
          const draggable = canDragHandCard?.(card.instanceId) ?? false;
          const touchDragging = touchDragCardId === card.instanceId;
          const keyboardIndex = showKeyboardIndex && index < 9 ? index + 1 : null;
          return (
            <div
              key={card.instanceId}
              className={[
                "hand-bar__slot",
                draggable ? "hand-bar__slot--draggable" : "",
                touchDragging ? "hand-bar__slot--touch-drag" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={draggable}
              onDragStart={
                draggable
                  ? (event) => {
                      event.dataTransfer.setData("text/plain", card.instanceId);
                      event.dataTransfer.effectAllowed = "move";
                      onHandDragStart?.(card);
                    }
                  : undefined
              }
              onDragEnd={draggable ? () => onHandDragEnd?.() : undefined}
              onPointerDown={
                draggable ? (event) => onHandPointerDown?.(card, event) : undefined
              }
              onPointerUp={draggable ? (event) => onHandPointerUp?.(event) : undefined}
              onPointerCancel={draggable ? (event) => onHandPointerUp?.(event) : undefined}
            >
              {keyboardIndex !== null && (
                <span className="hand-bar__index" aria-hidden="true">
                  {keyboardIndex}
                </span>
              )}
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
