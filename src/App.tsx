import { useEffect, useState } from "react";
import { DeckBuilder } from "./components/DeckBuilder/DeckBuilder";
import { GameBoard } from "./components/GameBoard/GameBoard";
import { Lobby } from "./components/Lobby/Lobby";
import { SimPlayback } from "./components/SimPlayback/SimPlayback";
import { useDeckStore } from "@/stores/deckStore";
import { useGameStore } from "@/stores/gameStore";

type Tab = "play" | "builder" | "sim";

export function App() {
  const [tab, setTab] = useState<Tab>("play");
  const { player1Deck, player2Deck } = useDeckStore();
  const { startMatch, loadSaved, engineState } = useGameStore();

  useEffect(() => {
    if (loadSaved()) setTab("play");
  }, [loadSaved]);

  // Human vs AI only — Player 2 is always the AI.
  function handlePlay(
    player1Name: string,
    player2Name: string,
    _vsAI = true,
    aiKind: "heuristic" | "llm" = "heuristic",
  ) {
    if (!player1Deck || !player2Deck) return;
    startMatch({ player1Name, player2Name, player1Deck, player2Deck, vsAI: true, aiKind });
    setTab("play");
  }

  const inGame = tab === "play" && !!engineState;

  return (
    <div className={`app${inGame ? " app--play" : ""}`}>
      {!inGame && (
        <header className="hero">
          <p className="hero__eyebrow">Pokémon TCG Simulation</p>
          <h1>Build a deck, play the AI, run playtests</h1>
          <p className="hero__subtitle">
            Import Limitless decklists, play full matches against the AI, and run AI-vs-AI
            simulations to analyse the meta.
          </p>
        </header>
      )}

      <nav className="tabs" aria-label="Modes">
        <button
          type="button"
          className={tab === "play" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("play")}
        >
          Play vs AI
        </button>
        <button
          type="button"
          className={tab === "builder" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("builder")}
        >
          Deck Builder
        </button>
        <button
          type="button"
          className={tab === "sim" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("sim")}
        >
          Simulation
        </button>
      </nav>

      <main>
        {tab === "play" && (engineState ? <GameBoard /> : <Lobby onPlay={handlePlay} />)}
        {tab === "builder" && <DeckBuilder onUseDeck={() => setTab("play")} />}
        {tab === "sim" && <SimPlayback />}
      </main>
    </div>
  );
}
