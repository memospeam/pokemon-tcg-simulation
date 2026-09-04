import { useCallback, useState } from "react";
import type { CardInstance } from "@/lib/models/instance";
import type { GameAction } from "@/lib/engine";

/** HTML5 drag-and-drop attach for energy cards → Pokémon in play. */
export function useEnergyDragDrop(
  legalActions: GameAction[],
  onAttach: (energyId: string, targetId: string) => void,
) {
  const [dragEnergyId, setDragEnergyId] = useState<string | null>(null);

  const attachTargets = useCallback(
    (energyId: string) =>
      new Set(
        legalActions
          .filter(
            (entry): entry is Extract<GameAction, { type: "ATTACH_ENERGY" }> =>
              entry.type === "ATTACH_ENERGY" &&
              entry.energyId === energyId &&
              Boolean(entry.targetId),
          )
          .map((entry) => entry.targetId!),
      ),
    [legalActions],
  );

  const canDragEnergy = useCallback(
    (instanceId: string) =>
      legalActions.some(
        (entry) => entry.type === "ATTACH_ENERGY" && entry.energyId === instanceId,
      ),
    [legalActions],
  );

  const onEnergyDragStart = useCallback(
    (card: CardInstance) => {
      if (!canDragEnergy(card.instanceId)) return;
      setDragEnergyId(card.instanceId);
    },
    [canDragEnergy],
  );

  const onEnergyDragEnd = useCallback(() => {
    setDragEnergyId(null);
  }, []);

  const onEnergyDrop = useCallback(
    (target: CardInstance) => {
      if (!dragEnergyId) return;
      const targets = attachTargets(dragEnergyId);
      if (!targets.has(target.instanceId)) return;
      onAttach(dragEnergyId, target.instanceId);
      setDragEnergyId(null);
    },
    [attachTargets, dragEnergyId, onAttach],
  );

  const isDropTarget = useCallback(
    (instanceId: string) => {
      if (!dragEnergyId) return false;
      return attachTargets(dragEnergyId).has(instanceId);
    },
    [attachTargets, dragEnergyId],
  );

  return {
    dragEnergyId,
    canDragEnergy,
    onEnergyDragStart,
    onEnergyDragEnd,
    onEnergyDrop,
    isDropTarget,
  };
}
