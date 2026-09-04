import { useEffect, useState } from "react";
import type { EngineState } from "@/lib/engine";

export type CoinFlipResult = "heads" | "tails";

interface CoinFlipOverlayProps {
  game: EngineState | null;
}

/** Brief PTCGL-style coin when the engine logs a flip. */
export function CoinFlipOverlay({ game }: CoinFlipOverlayProps) {
  const [flip, setFlip] = useState<CoinFlipResult | null>(null);

  useEffect(() => {
    if (!game?.log.length) return;
    const last = game.log[game.log.length - 1] ?? "";
    const match = last.match(/Coin flip: (heads|tails)/i);
    if (!match) return;
    const result = match[1]!.toLowerCase() as CoinFlipResult;
    setFlip(result);
    const timer = setTimeout(() => setFlip(null), 900);
    return () => clearTimeout(timer);
  }, [game, game?.log]);

  if (!flip) return null;

  return (
    <div className="coin-flip-overlay" role="status" aria-live="polite">
      <div className={`coin-flip-overlay__coin coin-flip-overlay__coin--${flip}`}>
        <span className="coin-flip-overlay__face">{flip === "heads" ? "H" : "T"}</span>
        <span className="coin-flip-overlay__label">{flip === "heads" ? "Heads" : "Tails"}</span>
      </div>
    </div>
  );
}
