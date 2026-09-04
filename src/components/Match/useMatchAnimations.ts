import { useEffect, useState } from "react";
import type { EngineState } from "@/lib/engine";

export type MatchEventKind = "damage" | "ko" | "evolve" | null;

/** Felt flash keyed to the latest log event (damage, KO, evolve). */
export function useMatchEventClass(game: EngineState | null): string {
  const [eventClass, setEventClass] = useState("");

  useEffect(() => {
    if (!game?.log.length) return;
    const last = game.log[game.log.length - 1] ?? "";
    let kind: MatchEventKind = null;
    if (/knocked out|was knocked out/i.test(last)) kind = "ko";
    else if (/evolv/i.test(last)) kind = "evolve";
    else if (/damage|recoil/i.test(last)) kind = "damage";

    if (!kind) return;

    setEventClass(`match-table--event-${kind}`);
    const duration = kind === "ko" ? 650 : kind === "evolve" ? 550 : 400;
    const timer = setTimeout(() => setEventClass(""), duration);
    return () => clearTimeout(timer);
  }, [game, game?.log]);

  return eventClass;
}
