import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useGameStore } from "@/stores/gameStore";

export function AppShell() {
  const location = useLocation();
  const { engineState, loadSaved } = useGameStore();
  const inMatch = !!engineState && location.pathname.startsWith("/battle");

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  return (
    <div className={`app${inMatch ? " app--play" : ""}`}>
      {!inMatch && (
        <header className="hero">
          <p className="hero__eyebrow">Pokémon TCG Live-style</p>
          <h1>Battle the AI. Analyse the meta.</h1>
          <p className="hero__subtitle">
            Import tournament decks, play solo against heuristic or LLM agents, and run AI-vs-AI
            simulations with full replay analysis.
          </p>
        </header>
      )}

      <nav className="tabs" aria-label="Modes">
        <NavLink
          to="/battle"
          className={({ isActive }) =>
            isActive ? "tabs__button tabs__button--active" : "tabs__button"
          }
        >
          Battle
        </NavLink>
        <NavLink
          to="/decks"
          className={({ isActive }) =>
            isActive ? "tabs__button tabs__button--active" : "tabs__button"
          }
        >
          Decks
        </NavLink>
        <NavLink
          to="/analysis"
          className={({ isActive }) =>
            isActive ? "tabs__button tabs__button--active" : "tabs__button"
          }
        >
          Analysis
        </NavLink>
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
