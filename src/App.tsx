import { useState } from "react";
import { GameSetup } from "./components/GameSetup";
import { PackOpener } from "./components/PackOpener";

type Tab = "pack" | "game";

export function App() {
  const [tab, setTab] = useState<Tab>("pack");

  return (
    <div className="app">
      <header className="hero">
        <p className="hero__eyebrow">Pokémon TCG Simulation</p>
        <h1>Practice packs and match setup in the browser</h1>
        <p className="hero__subtitle">
          TypeScript simulation engine with a lightweight React UI for booster openings and
          two-player game setup.
        </p>
      </header>

      <nav className="tabs" aria-label="Simulation modes">
        <button
          type="button"
          className={tab === "pack" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("pack")}
        >
          Open Pack
        </button>
        <button
          type="button"
          className={tab === "game" ? "tabs__button tabs__button--active" : "tabs__button"}
          onClick={() => setTab("game")}
        >
          Setup Game
        </button>
      </nav>

      <main>{tab === "pack" ? <PackOpener /> : <GameSetup />}</main>
    </div>
  );
}
