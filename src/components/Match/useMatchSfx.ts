import { useEffect, useRef } from "react";
import type { EngineState } from "@/lib/engine";
import { GamePhase, type PlayerId } from "@/lib/models/enums";
import { playSfx, sfxCueForLines, unlockSfx, type SfxKind } from "@/lib/ui/sfx";

const RANK: Record<SfxKind, number> = {
  win: 100,
  ko: 90,
  prize: 80,
  attack: 70,
  evolve: 60,
  turn: 55,
  coin: 50,
  play: 40,
  damage: 30,
  draw: 20,
};

/** Play one cue when the live match log advances. Skips the log already on screen. */
export function useMatchSfx(game: EngineState | null): void {
  const seen = useRef(false);
  const logLen = useRef(0);
  const turn = useRef<PlayerId | null>(null);

  useEffect(() => {
    const unlock = () => unlockSfx();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!game) {
      seen.current = false;
      return;
    }
    if (!seen.current) {
      seen.current = true;
      logLen.current = game.log.length;
      turn.current = game.currentPlayerId;
      return;
    }

    const fresh = game.log.slice(logLen.current);
    logLen.current = game.log.length;
    const cue = sfxCueForLines(fresh);
    const turnChanged =
      game.phase === GamePhase.Active &&
      !game.winnerId &&
      turn.current !== null &&
      game.currentPlayerId !== turn.current;
    turn.current = game.currentPlayerId;

    if (turnChanged && (!cue || RANK[cue] <= RANK.draw)) {
      playSfx("turn");
      return;
    }
    if (cue) playSfx(cue);
  }, [game]);
}
