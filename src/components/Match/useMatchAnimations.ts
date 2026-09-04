import { useEffect, useState } from "react";
import type { EngineState } from "@/lib/engine";

export type MatchEventKind = "damage" | "ko" | "evolve" | "promote" | "prize" | "switch" | "attack" | null;

/** Felt flash keyed to the latest log event. */
export function useMatchEventClass(game: EngineState | null): string {
  const [eventClass, setEventClass] = useState("");

  useEffect(() => {
    if (!game?.log.length) return;
    const last = game.log[game.log.length - 1] ?? "";
    let kind: MatchEventKind = null;
    if (/knocked out|was knocked out/i.test(last)) kind = "ko";
    else if (/promoted/i.test(last)) kind = "promote";
    else if (/retreated|switched .+ with/i.test(last)) kind = "switch";
    else if (/took \d+ prize card/i.test(last)) kind = "prize";
    else if (/ used .+ for \d+ damage to Active/i.test(last)) kind = "attack";
    else if (/evolv/i.test(last)) kind = "evolve";
    else if (/damage|recoil/i.test(last)) kind = "damage";

    if (!kind) return;

    setEventClass(`match-table--event-${kind}`);
    const duration =
      kind === "ko"
        ? 650
        : kind === "promote"
          ? 600
          : kind === "switch"
            ? 550
            : kind === "attack"
              ? 420
              : kind === "prize"
                ? 550
                : kind === "evolve"
                  ? 550
                  : 400;
    const timer = setTimeout(() => setEventClass(""), duration);
    return () => clearTimeout(timer);
  }, [game, game?.log]);

  return eventClass;
}
