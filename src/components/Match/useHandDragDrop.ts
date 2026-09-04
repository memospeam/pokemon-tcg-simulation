import { useCallback, useState } from "react";
import type { CardInstance } from "@/lib/models/instance";
import type { GameAction } from "@/lib/engine";

export type HandDragKind = "energy" | "evolve";

/** HTML5 drag-and-drop for energy attach and evolution from hand → Pokémon in play. */
export function useHandDragDrop(
  legalActions: GameAction[],
  onAttach: (energyId: string, targetId: string) => void,
  onEvolve: (evolutionId: string, targetId: string) => void,
) {
  const [drag, setDrag] = useState<{ cardId: string; kind: HandDragKind } | null>(null);

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

  const canDragHandCard = useCallback(
    (instanceId: string) => dragKindForCard(instanceId) !== null,
    [dragKindForCard],
  );

  const onHandDragStart = useCallback(
    (card: CardInstance) => {
      const kind = dragKindForCard(card.instanceId);
      if (!kind) return;
      setDrag({ cardId: card.instanceId, kind });
    },
    [dragKindForCard],
  );

  const onHandDragEnd = useCallback(() => {
    setDrag(null);
  }, []);

  const onHandDrop = useCallback(
    (target: CardInstance) => {
      if (!drag) return;
      const targets = dropTargets(drag.cardId, drag.kind);
      if (!targets.has(target.instanceId)) return;
      if (drag.kind === "energy") {
        onAttach(drag.cardId, target.instanceId);
      } else {
        onEvolve(drag.cardId, target.instanceId);
      }
      setDrag(null);
    },
    [drag, dropTargets, onAttach, onEvolve],
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
    canDragHandCard,
    onHandDragStart,
    onHandDragEnd,
    onHandDrop,
    dropKindForTarget,
  };
}
