import { useState } from "react";
import type { EngineState } from "@/lib/engine";
import { getDefinition, getPlayer } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import type { CardInstance } from "@/lib/models/instance";
import { BoardCard } from "./BoardCard";
import { CardPreviewPanel } from "./CardPreviewPanel";

interface DiscardPilePanelProps {
  game: EngineState;
  playerId: PlayerId;
  onClose: () => void;
  onPick?: (instanceId: string) => void;
  pickLabel?: string;
  selectableIds?: string[];
}

export function DiscardPilePanel({
  game,
  playerId,
  onClose,
  onPick,
  pickLabel,
  selectableIds,
}: DiscardPilePanelProps) {
  const player = getPlayer(game, playerId);
  const cards = [...player.discard].reverse();

  return (
    <DiscardPileContent
      game={game}
      title={`${player.name} — Discard pile (${cards.length})`}
      cards={cards}
      onClose={onClose}
      onPick={onPick}
      pickLabel={pickLabel}
      selectableIds={selectableIds}
    />
  );
}

interface DiscardPileContentProps {
  game: EngineState;
  title: string;
  cards: CardInstance[];
  onClose: () => void;
  onPick?: (instanceId: string) => void;
  pickLabel?: string;
  selectableIds?: string[];
}

export function DiscardPileContent({
  game,
  title,
  cards,
  onClose,
  onPick,
  pickLabel,
  selectableIds,
}: DiscardPileContentProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewCard = previewId ? cards.find((c) => c.instanceId === previewId) : null;
  const previewDef = previewCard ? getDefinition(game, previewCard.definitionId) : null;

  return (
    <>
      <aside className="zone-viewer">
        <div className="zone-viewer__header">
          <h4>{title}</h4>
          <button type="button" className="zone-viewer__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {cards.length === 0 ? (
          <p className="zone-viewer__empty">Discard pile is empty.</p>
        ) : (
          <div className="zone-viewer__cards">
            {cards.map((card) => {
              const def = getDefinition(game, card.definitionId);
              const canPick = onPick && (!selectableIds || selectableIds.includes(card.instanceId));
              return (
                <button
                  key={card.instanceId}
                  type="button"
                  className="zone-viewer__card"
                  onClick={() => setPreviewId(card.instanceId)}
                >
                  <BoardCard state={game} card={card} size="hand" showName={false} />
                  <span>{def?.name}</span>
                  {canPick && (
                    <span
                      className="zone-viewer__pick"
                      role="presentation"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick(card.instanceId);
                      }}
                    >
                      {pickLabel ?? "Select"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {previewCard && previewDef && (
        <CardPreviewPanel
          definition={previewDef}
          actions={[]}
          onAction={() => undefined}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}
