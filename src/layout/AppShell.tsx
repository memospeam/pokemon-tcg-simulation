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
          <p className="hero__eyebrow">Free to play</p>
          <h1>Pokémon TCG</h1>
          <p className="hero__subtitle">
            Play a match in the browser. Pick a Worlds deck and battle the AI — no account, no install.
          </p>
        </header>
      )}

      <nav className="tabs" aria-label="Modes">
        <NavLink
          to="/battle"
          data-testid="nav-battle"
          className={({ isActive }) =>
            isActive ? "tabs__button tabs__button--active" : "tabs__button"
          }
        >
          Play
        </NavLink>
        <NavLink
          to="/decks"
          data-testid="nav-decks"
          className={({ isActive }) =>
            isActive ? "tabs__button tabs__button--active" : "tabs__button"
          }
        >
          Decks
        </NavLink>
        <NavLink
          to="/analysis"
          data-testid="nav-analysis"
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
