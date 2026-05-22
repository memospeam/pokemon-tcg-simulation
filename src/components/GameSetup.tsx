import { useMemo, useState } from "react";
import { createSamplePlayer, setupGame } from "@/lib/models";
import { CardTile } from "./CardTile";

export function GameSetup() {
  const [player1Name, setPlayer1Name] = useState("Player 1");
  const [player2Name, setPlayer2Name] = useState("Player 2");
  const [gameKey, setGameKey] = useState(0);

  const game = useMemo(() => {
    void gameKey;
    const p1 = createSamplePlayer(player1Name);
    const p2 = createSamplePlayer(player2Name);
    return setupGame(p1, p2);
  }, [player1Name, player2Name, gameKey]);

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2>Setup Match</h2>
          <p>Shuffle decks, deal prize cards, and draw opening hands.</p>
        </div>
        <div className="panel__actions">
          <label className="field">
            <span>Player 1</span>
            <input
              value={player1Name}
              onChange={(event) => setPlayer1Name(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Player 2</span>
            <input
              value={player2Name}
              onChange={(event) => setPlayer2Name(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => setGameKey((value) => value + 1)}>
            Start Game
          </button>
        </div>
      </header>

      <div className="match-summary">
        <div className="stat-card">
          <span className="stat-card__label">{game.player1.name}</span>
          <strong>{game.player1.hand.length}</strong>
          <span>cards in hand</span>
        </div>
        <div className="stat-card stat-card--accent">
          <span className="stat-card__label">Phase</span>
          <strong>{game.phase}</strong>
          <span>turn {game.turnNumber}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">{game.player2.name}</span>
          <strong>{game.player2.hand.length}</strong>
          <span>cards in hand</span>
        </div>
      </div>

      <div className="player-hands">
        {[game.player1, game.player2].map((player) => (
          <div key={player.name} className="player-hand">
            <h3>
              {player.name} · {player.prizesRemaining} prize cards left
            </h3>
            <div className="card-grid card-grid--compact">
              {player.hand.map((card) => (
                <CardTile key={card.id} card={card} compact />
              ))}
            </div>
          </div>
        ))}
      </div>

      <ul className="event-log">
        {game.log.map((entry, index) => (
          <li key={`${gameKey}-${index}`}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}
