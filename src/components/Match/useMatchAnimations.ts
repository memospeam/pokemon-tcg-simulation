import { useEffect, useState } from "react";
import type { EngineState } from "@/lib/engine";

/** Lightweight VFX hook — flashes the felt when the log mentions damage/KO. */
export function useMatchEventClass(game: EngineState | null): string {
  const [eventClass, setEventClass] = useState("");

  useEffect(() => {
    if (!game?.log.length) return;
    const last = game.log[game.log.length - 1] ?? "";
    if (!/(damage|knocked out|KO)/i.test(last)) return;
    setEventClass("match-table--event-damage");
    const timer = setTimeout(() => setEventClass(""), 400);
    return () => clearTimeout(timer);
  }, [game, game?.log]);

  return eventClass;
}
