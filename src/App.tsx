import { useEffect, useState } from "react";
import { DeckBuilder } from "./components/DeckBuilder/DeckBuilder";
import { GameBoard } from "./components/GameBoard/GameBoard";
import { Lobby } from "./components/Lobby/Lobby";
import { PackOpener } from "./components/PackOpener";
import { SimPlayback } from "./components/SimPlayback/SimPlayback";
import { useDeckStore } from "@/stores/deckStore";
import { useGameStore } from "@/stores/gameStore";

type Tab = "lobby" | "play" | "builder" | "pack" | "sim";

export function App() {
  const [tab, setTab] = useState<Tab>("lobby");
  const { player1Deck, player2Deck } = useDeckStore();
  const { startMatch, loadSaved, engineState } = useGameStore();

  useEffect(() => {
    if (loadSaved()) {
      setTab("play");
    }
  }, [loadSaved]);

  function handlePlay(player1Name: string, player2Name: string) {
    if (!player1Deck || !player2Deck) return;
    startMatch({
      player1Name,
      player2Name,
      player1Deck,
      player2Deck,
    });
    setTab("play");
  }

  return (
    <div className={`app${tab === "play" ? " app--play" : ""}`}>
      {tab !== "play" && (
        <header className="hero">
          <p className="hero__eyebrow">Pokémon TCG Simulation</p>
          <h1>Import decks and practice full matches solo</h1>
          <p className="hero__subtitle">
            Import Limitless decklists, resolve real cards via pokemontcg.io, and play both sides like
            tcgmasters.net.
          </p>
        </header>
      )}

      <nav className="tabs" aria-label="Simulation modes">
        <button
          type="button"
          className={tab === "lobby" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("lobby")}
        >
          Lobby
        </button>
        <button
          type="button"
          className={tab === "play" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("play")}
          disabled={!engineState}
        >
          Play
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
          className={tab === "pack" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("pack")}
        >
          Open Pack
        </button>
        <button
          type="button"
          className={tab === "sim" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("sim")}
        >
          Simulate
        </button>
      </nav>

      <main>
        {tab === "lobby" && <Lobby onPlay={handlePlay} />}
        {tab === "play" && <GameBoard />}
        {tab === "builder" && <DeckBuilder />}
        {tab === "pack" && <PackOpener />}
        {tab === "sim" && <SimPlayback />}
      </main>
    </div>
  );
}
