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

export interface BoardSlot {
  mat: "self" | "opponent";
  slot: "active" | "bench";
  benchIndex?: number;
}

type SlotSnapshot = {
  instanceId: string;
  definitionId: string;
};

function slotKey(slot: BoardSlot): string {
  return `${slot.mat}:${slot.slot}:${slot.benchIndex ?? "active"}`;
}

function snapshotBoard(
  game: EngineState,
  viewingPlayerId: PlayerId,
): Map<string, SlotSnapshot | null> {
  const self = getPlayer(game, viewingPlayerId);
  const opponent = getPlayer(game, getOpponentId(viewingPlayerId));
  const map = new Map<string, SlotSnapshot | null>();

  const add = (
    card: CardInstance | null | undefined,
    mat: BoardSlot["mat"],
    slot: BoardSlot["slot"],
    benchIndex?: number,
  ) => {
    map.set(
      slotKey({ mat, slot, benchIndex }),
      card ? { instanceId: card.instanceId, definitionId: card.definitionId } : null,
    );
  };

  add(self.active, "self", "active");
  for (let i = 0; i < 5; i += 1) add(self.bench[i], "self", "bench", i);
  add(opponent.active, "opponent", "active");
  for (let i = 0; i < 5; i += 1) add(opponent.bench[i], "opponent", "bench", i);

  return map;
}

function parseSlotFromKey(key: string): BoardSlot {
  const [mat, slot, index] = key.split(":");
  return {
    mat: mat as BoardSlot["mat"],
    slot: slot as BoardSlot["slot"],
    benchIndex: index === "active" ? undefined : Number(index),
  };
}

export interface BoardSlotVfx {
  damageFloats: DamageFloat[];
  evolvingSlots: Set<string>;
  koSlots: Set<string>;
}

const EMPTY_SET = new Set<string>();

/** Track damage floats, evolve flashes, and KO animations per board slot. */
export function useBoardSlotVfx(
  game: EngineState | null,
  viewingPlayerId: PlayerId,
): BoardSlotVfx {
  const prevLayoutRef = useRef<Map<string, SlotSnapshot | null>>(new Map());
  const prevCountersRef = useRef<Map<string, number>>(new Map());
  const [damageFloats, setDamageFloats] = useState<DamageFloat[]>([]);
  const [evolvingSlots, setEvolvingSlots] = useState<Set<string>>(EMPTY_SET);
  const [koSlots, setKoSlots] = useState<Set<string>>(EMPTY_SET);

  useEffect(() => {
    if (!game) return;

    const layout = snapshotBoard(game, viewingPlayerId);
    const lastLog = game.log[game.log.length - 1] ?? "";
    const evolveKeys: string[] = [];
    const koKeys: string[] = [];
    const nextFloats: DamageFloat[] = [];

    if (prevLayoutRef.current.size === 0) {
      for (const [key, entry] of layout) {
        prevLayoutRef.current.set(key, entry);
        if (entry) {
          const card = findCardAtSlot(game, viewingPlayerId, parseSlotFromKey(key));
          if (card) prevCountersRef.current.set(entry.instanceId, card.damageCounters);
        }
      }
      return;
    }

    for (const [key, entry] of layout) {
      const prev = prevLayoutRef.current.get(key) ?? null;

      if (prev && !entry) {
        koKeys.push(key);
      } else if (
        prev &&
        entry &&
        prev.instanceId !== entry.instanceId &&
        /evolv/i.test(lastLog)
      ) {
        evolveKeys.push(key);
      } else if (
        prev &&
        entry &&
        prev.instanceId === entry.instanceId &&
        prev.definitionId !== entry.definitionId
      ) {
        evolveKeys.push(key);
      }

      if (entry) {
        const card = findCardAtSlot(game, viewingPlayerId, parseSlotFromKey(key));
        if (card) {
          const prevCounters = prevCountersRef.current.get(entry.instanceId) ?? card.damageCounters;
          const delta = card.damageCounters - prevCounters;
          if (delta > 0) {
            const slot = parseSlotFromKey(key);
            nextFloats.push({
              id: `${entry.instanceId}-${game.log.length}-${delta}`,
              mat: slot.mat,
              slot: slot.slot,
              benchIndex: slot.benchIndex,
              amount: delta,
            });
          }
          prevCountersRef.current.set(entry.instanceId, card.damageCounters);
        }
      }

      prevLayoutRef.current.set(key, entry);
    }

    for (const key of prevLayoutRef.current.keys()) {
      if (!layout.has(key)) prevLayoutRef.current.delete(key);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    if (nextFloats.length > 0) {
      setDamageFloats((current) => [...current, ...nextFloats]);
      timers.push(
        setTimeout(() => {
          setDamageFloats((current) =>
            current.filter((item) => !nextFloats.some((added) => added.id === item.id)),
          );
        }, 1100),
      );
    }

    if (evolveKeys.length > 0) {
      setEvolvingSlots(new Set(evolveKeys));
      timers.push(setTimeout(() => setEvolvingSlots(EMPTY_SET), 700));
    }

    if (koKeys.length > 0) {
      setKoSlots(new Set(koKeys));
      timers.push(setTimeout(() => setKoSlots(EMPTY_SET), 900));
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [game, viewingPlayerId]);

  return { damageFloats, evolvingSlots, koSlots };
}

function findCardAtSlot(
  game: EngineState,
  viewingPlayerId: PlayerId,
  slot: BoardSlot,
): CardInstance | null {
  const playerId = slot.mat === "self" ? viewingPlayerId : getOpponentId(viewingPlayerId);
  const player = getPlayer(game, playerId);
  if (slot.slot === "active") return player.active;
  if (slot.benchIndex === undefined) return null;
  return player.bench[slot.benchIndex] ?? null;
}

export function isSlotAnimating(
  slots: Set<string>,
  mat: BoardSlot["mat"],
  slot: BoardSlot["slot"],
  benchIndex?: number,
): boolean {
  return slots.has(slotKey({ mat, slot, benchIndex }));
}
