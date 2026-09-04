import { useCallback, useState, type PointerEvent } from "react";
import type { CardInstance } from "@/lib/models/instance";
import type { GameAction } from "@/lib/engine";

export type HandDragKind = "energy" | "evolve";

/** HTML5 drag-and-drop + pointer fallback for energy attach and evolution from hand → Pokémon in play. */
export function useHandDragDrop(
  legalActions: GameAction[],
  onAttach: (energyId: string, targetId: string) => void,
  onEvolve: (evolutionId: string, targetId: string) => void,
) {
  const [drag, setDrag] = useState<{ cardId: string; kind: HandDragKind } | null>(null);
  const [touchDragCardId, setTouchDragCardId] = useState<string | null>(null);

  const dragKindForCard = useCallback(
    (instanceId: string): HandDragKind | null => {
      if (
        legalActions.some(
          (entry) => entry.type === "ATTACH_ENERGY" && entry.energyId === instanceId,
        )
      ) {
        return "energy";
      }
      if (
        legalActions.some(
          (entry) => entry.type === "EVOLVE" && entry.evolutionId === instanceId,
        )
      ) {
        return "evolve";
      }
      return null;
    },
    [legalActions],
  );

  const dropTargets = useCallback(
    (cardId: string, kind: HandDragKind) =>
      new Set(
        legalActions
          .filter((entry) => {
            if (kind === "energy") {
              return (
                entry.type === "ATTACH_ENERGY" &&
                entry.energyId === cardId &&
                Boolean(entry.targetId)
              );
            }
            return (
              entry.type === "EVOLVE" &&
              entry.evolutionId === cardId &&
              Boolean(entry.targetId)
            );
          })
          .map((entry) => ("targetId" in entry ? entry.targetId! : "")),
      ),
    [legalActions],
  );

  const completeDrop = useCallback(
    (cardId: string, kind: HandDragKind, targetId: string) => {
      if (!dropTargets(cardId, kind).has(targetId)) return;
      if (kind === "energy") onAttach(cardId, targetId);
      else onEvolve(cardId, targetId);
    },
    [dropTargets, onAttach, onEvolve],
  );

  const canDragHandCard = useCallback(
    (instanceId: string) => dragKindForCard(instanceId) !== null,
    [dragKindForCard],
  );

  const onHandDragStart = useCallback(
    (card: CardInstance) => {
      const kind = dragKindForCard(card.instanceId);
      if (!kind) return;
      setDrag({ cardId: card.instanceId, kind });
      setTouchDragCardId(card.instanceId);
    },
    [dragKindForCard],
  );

  const onHandDragEnd = useCallback(() => {
    setDrag(null);
    setTouchDragCardId(null);
  }, []);

  const onHandDrop = useCallback(
    (target: CardInstance) => {
      if (!drag) return;
      completeDrop(drag.cardId, drag.kind, target.instanceId);
      setDrag(null);
      setTouchDragCardId(null);
    },
    [drag, completeDrop],
  );

  const onHandPointerDown = useCallback(
    (card: CardInstance, event: PointerEvent) => {
      const kind = dragKindForCard(card.instanceId);
      if (!kind || event.pointerType === "mouse") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ cardId: card.instanceId, kind });
      setTouchDragCardId(card.instanceId);
    },
    [dragKindForCard],
  );

  const onHandPointerUp = useCallback(
    (event: PointerEvent) => {
      if (!drag || event.pointerType === "mouse") return;
      const targetEl = document.elementFromPoint(event.clientX, event.clientY)?.closest(
        "[data-hand-drop-target]",
      ) as HTMLElement | null;
      const targetId = targetEl?.dataset.handDropTarget;
      if (targetId) completeDrop(drag.cardId, drag.kind, targetId);
      setDrag(null);
      setTouchDragCardId(null);
    },
    [drag, completeDrop],
  );

  const dropKindForTarget = useCallback(
    (instanceId: string): HandDragKind | null => {
      if (!drag) return null;
      return dropTargets(drag.cardId, drag.kind).has(instanceId) ? drag.kind : null;
    },
    [drag, dropTargets],
  );

  return {
    drag,
    touchDragCardId,
    canDragHandCard,
    onHandDragStart,
    onHandDragEnd,
    onHandDrop,
    onHandPointerDown,
    onHandPointerUp,
    dropKindForTarget,
  };
}
