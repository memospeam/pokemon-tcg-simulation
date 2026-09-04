import { useEffect, useRef, useState } from "react";
import { getOpponentId, getPlayer, type EngineState } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import type { CardInstance } from "@/lib/models/instance";

export interface DamageFloat {
  id: string;
  mat: "self" | "opponent";
  slot: "active" | "bench";
  benchIndex?: number;
  amount: number;
}

function snapshotCounters(
  game: EngineState,
  viewingPlayerId: PlayerId,
): Map<string, { counters: number; mat: "self" | "opponent"; slot: "active" | "bench"; benchIndex?: number }> {
  const self = getPlayer(game, viewingPlayerId);
  const opponent = getPlayer(game, getOpponentId(viewingPlayerId));
  const map = new Map<string, { counters: number; mat: "self" | "opponent"; slot: "active" | "bench"; benchIndex?: number }>();

  const add = (
    card: CardInstance,
    mat: "self" | "opponent",
    slot: "active" | "bench",
    benchIndex?: number,
  ) => {
    map.set(card.instanceId, { counters: card.damageCounters, mat, slot, benchIndex });
  };

  if (self.active) add(self.active, "self", "active");
  self.bench.forEach((card, index) => add(card, "self", "bench", index));
  if (opponent.active) add(opponent.active, "opponent", "active");
  opponent.bench.forEach((card, index) => add(card, "opponent", "bench", index));

  return map;
}

/** Detect HP loss on in-play Pokémon and emit floating damage numbers. */
export function useDamageFloats(game: EngineState | null, viewingPlayerId: PlayerId): DamageFloat[] {
  const prevRef = useRef<Map<string, number>>(new Map());
  const [floats, setFloats] = useState<DamageFloat[]>([]);

  useEffect(() => {
    if (!game) return;

    const layout = snapshotCounters(game, viewingPlayerId);
    const next: DamageFloat[] = [];

    if (prevRef.current.size === 0) {
      for (const [instanceId, entry] of layout) {
        prevRef.current.set(instanceId, entry.counters);
      }
      return;
    }

    for (const [instanceId, entry] of layout) {
      const prev = prevRef.current.get(instanceId) ?? entry.counters;
      const delta = entry.counters - prev;
      if (delta > 0) {
        next.push({
          id: `${instanceId}-${game.log.length}-${delta}`,
          mat: entry.mat,
          slot: entry.slot,
          benchIndex: entry.benchIndex,
          amount: delta,
        });
      }
      prevRef.current.set(instanceId, entry.counters);
    }

    for (const key of prevRef.current.keys()) {
      if (!layout.has(key)) prevRef.current.delete(key);
    }

    if (next.length === 0) return;

    setFloats((current) => [...current, ...next]);
    const timer = setTimeout(() => {
      setFloats((current) => current.filter((item) => !next.some((added) => added.id === item.id)));
    }, 1100);
    return () => clearTimeout(timer);
  }, [game, viewingPlayerId]);

  return floats;
}
