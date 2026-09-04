import { useEffect, useState } from "react";
import { getDefinition, getOpponentId, getPlayer, type EngineState } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import { parseAttackBeam, type AttackBeam } from "./parseAttackBeam";

export function useAttackBeam(game: EngineState | null, viewingPlayerId: PlayerId): AttackBeam | null {
  const [beam, setBeam] = useState<AttackBeam | null>(null);

  useEffect(() => {
    if (!game?.log.length) return;

    const last = game.log[game.log.length - 1] ?? "";
    const self = getPlayer(game, viewingPlayerId);
    const opponent = getPlayer(game, getOpponentId(viewingPlayerId));
    const selfName = self.active
      ? (getDefinition(game, self.active.definitionId)?.name ?? null)
      : null;
    const oppName = opponent.active
      ? (getDefinition(game, opponent.active.definitionId)?.name ?? null)
      : null;

    const next = parseAttackBeam(last, selfName, oppName, game.log.length);
    if (!next) return;

    setBeam(next);
    const timer = setTimeout(() => setBeam(null), 450);
    return () => clearTimeout(timer);
  }, [game, viewingPlayerId]);

  return beam;
}
