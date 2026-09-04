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

export interface PrizeFly {
  id: string;
  mat: "self" | "opponent";
  count: number;
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
  promoteSlots: Set<string>;
  switchSlots: Set<string>;
  prizeFlies: PrizeFly[];
}

const EMPTY_SET = new Set<string>();

/** Track damage floats, evolve/KO/promote flashes, and prize fly-ins. */
export function useBoardSlotVfx(
  game: EngineState | null,
  viewingPlayerId: PlayerId,
): BoardSlotVfx {
  const prevLayoutRef = useRef<Map<string, SlotSnapshot | null>>(new Map());
  const prevCountersRef = useRef<Map<string, number>>(new Map());
  const prevPrizesRef = useRef<{ self: number; opponent: number } | null>(null);
  const [damageFloats, setDamageFloats] = useState<DamageFloat[]>([]);
  const [evolvingSlots, setEvolvingSlots] = useState<Set<string>>(EMPTY_SET);
  const [koSlots, setKoSlots] = useState<Set<string>>(EMPTY_SET);
  const [promoteSlots, setPromoteSlots] = useState<Set<string>>(EMPTY_SET);
  const [switchSlots, setSwitchSlots] = useState<Set<string>>(EMPTY_SET);
  const [prizeFlies, setPrizeFlies] = useState<PrizeFly[]>([]);

  useEffect(() => {
    if (!game) return;

    const layout = snapshotBoard(game, viewingPlayerId);
    const self = getPlayer(game, viewingPlayerId);
    const opponent = getPlayer(game, getOpponentId(viewingPlayerId));
    const lastLog = game.log[game.log.length - 1] ?? "";
    const evolveKeys: string[] = [];
    const koKeys: string[] = [];
    const promoteKeys: string[] = [];
    const switchKeys: string[] = [];
    const nextFloats: DamageFloat[] = [];
    const nextPrizeFlies: PrizeFly[] = [];

    if (prevLayoutRef.current.size === 0) {
      for (const [key, entry] of layout) {
        prevLayoutRef.current.set(key, entry);
        if (entry) {
          const card = findCardAtSlot(game, viewingPlayerId, parseSlotFromKey(key));
          if (card) prevCountersRef.current.set(entry.instanceId, card.damageCounters);
        }
      }
      prevPrizesRef.current = { self: self.prizes.length, opponent: opponent.prizes.length };
      return;
    }

    const prevActiveSelf = prevLayoutRef.current.get(slotKey({ mat: "self", slot: "active" })) ?? null;
    const prevActiveOpp =
      prevLayoutRef.current.get(slotKey({ mat: "opponent", slot: "active" })) ?? null;
    const nextActiveSelf = layout.get(slotKey({ mat: "self", slot: "active" })) ?? null;
    const nextActiveOpp = layout.get(slotKey({ mat: "opponent", slot: "active" })) ?? null;

    const matIsSwitching = (mat: BoardSlot["mat"]) =>
      /retreated|switched .+ with/i.test(lastLog) &&
      ((mat === "self" &&
        prevActiveSelf &&
        nextActiveSelf &&
        prevActiveSelf.instanceId !== nextActiveSelf.instanceId) ||
        (mat === "opponent" &&
          prevActiveOpp &&
          nextActiveOpp &&
          prevActiveOpp.instanceId !== nextActiveOpp.instanceId));

    const prevSnapshot = new Map(prevLayoutRef.current);

    for (const [key, entry] of layout) {
      const prev = prevLayoutRef.current.get(key) ?? null;
      const slot = parseSlotFromKey(key);

      if (prev && !entry) {
        const wasPromoteSource =
          /promoted/i.test(lastLog) &&
          ((slot.mat === "self" && nextActiveSelf?.instanceId === prev.instanceId) ||
            (slot.mat === "opponent" && nextActiveOpp?.instanceId === prev.instanceId));
        if (!wasPromoteSource && !matIsSwitching(slot.mat)) {
          koKeys.push(key);
        }
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
      } else if (
        !prev &&
        entry &&
        slot.slot === "active" &&
        /promoted/i.test(lastLog)
      ) {
        promoteKeys.push(key);
      }

      if (entry) {
        const card = findCardAtSlot(game, viewingPlayerId, slot);
        if (card) {
          const prevCounters = prevCountersRef.current.get(entry.instanceId) ?? card.damageCounters;
          const delta = card.damageCounters - prevCounters;
          if (delta > 0) {
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

    // Promote: active gained a bench Pokémon (bench slot may have shifted indices).
    if (/promoted/i.test(lastLog)) {
      for (const mat of ["self", "opponent"] as const) {
        const prevActive = mat === "self" ? prevActiveSelf : prevActiveOpp;
        const nextActive = mat === "self" ? nextActiveSelf : nextActiveOpp;
        if (
          nextActive &&
          (!prevActive || prevActive.instanceId !== nextActive.instanceId)
        ) {
          promoteKeys.push(slotKey({ mat, slot: "active" }));
        }
      }
    }

    if (/retreated|switched .+ with/i.test(lastLog)) {
      for (const mat of ["self", "opponent"] as const) {
        const prevActive = mat === "self" ? prevActiveSelf : prevActiveOpp;
        const nextActive = mat === "self" ? nextActiveSelf : nextActiveOpp;
        if (
          !prevActive ||
          !nextActive ||
          prevActive.instanceId === nextActive.instanceId
        ) {
          continue;
        }
        switchKeys.push(slotKey({ mat, slot: "active" }));
        for (let i = 0; i < 5; i += 1) {
          const benchKey = slotKey({ mat, slot: "bench", benchIndex: i });
          const prevBench = prevSnapshot.get(benchKey) ?? null;
          const nextBench = layout.get(benchKey) ?? null;
          if ((prevBench?.instanceId ?? null) !== (nextBench?.instanceId ?? null)) {
            switchKeys.push(benchKey);
          }
        }
      }
    }

    for (const key of prevLayoutRef.current.keys()) {
      if (!layout.has(key)) prevLayoutRef.current.delete(key);
    }

    const prevPrizes = prevPrizesRef.current ?? {
      self: self.prizes.length,
      opponent: opponent.prizes.length,
    };
    const selfPrizeDelta = prevPrizes.self - self.prizes.length;
    const oppPrizeDelta = prevPrizes.opponent - opponent.prizes.length;
    if (selfPrizeDelta > 0 && /prize card/i.test(lastLog)) {
      nextPrizeFlies.push({
        id: `self-prize-${game.log.length}`,
        mat: "self",
        count: selfPrizeDelta,
      });
    }
    if (oppPrizeDelta > 0 && /prize card/i.test(lastLog)) {
      nextPrizeFlies.push({
        id: `opp-prize-${game.log.length}`,
        mat: "opponent",
        count: oppPrizeDelta,
      });
    }
    prevPrizesRef.current = { self: self.prizes.length, opponent: opponent.prizes.length };

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

    if (promoteKeys.length > 0) {
      setPromoteSlots(new Set(promoteKeys));
      timers.push(setTimeout(() => setPromoteSlots(EMPTY_SET), 750));
    }

    if (switchKeys.length > 0) {
      setSwitchSlots(new Set(switchKeys));
      timers.push(setTimeout(() => setSwitchSlots(EMPTY_SET), 700));
    }

    if (nextPrizeFlies.length > 0) {
      setPrizeFlies((current) => [...current, ...nextPrizeFlies]);
      timers.push(
        setTimeout(() => {
          setPrizeFlies((current) =>
            current.filter((item) => !nextPrizeFlies.some((added) => added.id === item.id)),
          );
        }, 1200),
      );
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [game, viewingPlayerId]);

  return { damageFloats, evolvingSlots, koSlots, promoteSlots, switchSlots, prizeFlies };
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
