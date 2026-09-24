import { useEffect, useRef, useState } from "react";
import { BattleSetup, type BattleReadyPayload } from "@/components/Battle/BattleSetup";
import { VsScreen } from "@/components/Battle/VsScreen";
import { GameBoard } from "@/components/GameBoard/GameBoard";
import { useDeckStore } from "@/stores/deckStore";
import { useGameStore } from "@/stores/gameStore";

type BattleFlow = "setup" | "vs";

export function BattlePage() {
  const { player1Deck, player2Deck } = useDeckStore();
  const engineState = useGameStore((state) => state.engineState);
  const startMatch = useGameStore((state) => state.startMatch);
  const clearSaved = useGameStore((state) => state.clearSaved);
  const [flow, setFlow] = useState<BattleFlow>("setup");
  const [pending, setPending] = useState<BattleReadyPayload | null>(null);
  // Set while leaving a finished match so the lobby shows even if the VS
  // screen state has not flushed yet.
  const returnedHome = useRef(false);

  useEffect(() => {
    if (!engineState?.winnerId) return;
    const timer = window.setTimeout(() => {
      returnedHome.current = true;
      setFlow("setup");
      setPending(null);
      clearSaved();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [engineState?.winnerId, clearSaved]);

  useEffect(() => {
    if (!engineState && flow === "setup") returnedHome.current = false;
  }, [engineState, flow]);

  if (engineState) {
    return <GameBoard />;
  }

  if (!returnedHome.current && flow === "vs" && pending && player1Deck && player2Deck) {
    return (
      <VsScreen
        playerName={pending.player1Name}
        opponentName={pending.player2Name}
        playerDeck={player1Deck}
        opponentDeck={player2Deck}
        aiKind={pending.aiKind}
        onBack={() => setFlow("setup")}
        onStart={() => {
          startMatch({
            player1Name: pending.player1Name,
            player2Name: pending.player2Name,
            player1Deck,
            player2Deck,
            vsAI: true,
            aiKind: pending.aiKind,
          });
        }}
      />
    );
  }

  return (
    <BattleSetup
      onBattleReady={(payload) => {
        setPending(payload);
        setFlow("vs");
      }}
    />
  );
}
