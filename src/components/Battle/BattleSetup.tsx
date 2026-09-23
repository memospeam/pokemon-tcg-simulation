import { useEffect, useState } from "react";
import type { BuiltDeck } from "@/lib/deck/builder";
import { buildPlaytestDeckFromCorpusText } from "@/lib/deck/corpusDeckBuilder";
import { buildShareUrl, parseLocationHash } from "@/lib/deck/tcgmastersUrl";
import { matchupSides, PUBLIC_MATCHUPS, type PublicMatchup } from "@/lib/deck/publicMatchups";
import { ALL_TOURNAMENTS, getTournamentDeckById } from "@/lib/deck/tournamentPresets";
import type { AiKind } from "@/stores/gameStore";
import { useDeckStore } from "@/stores/deckStore";
import { DeckBuilder } from "../DeckBuilder/DeckBuilder";

export interface BattleReadyPayload {
  player1Name: string;
  player2Name: string;
  aiKind: AiKind;
}

interface BattleSetupProps {
  onBattleReady: (payload: BattleReadyPayload) => void;
}

export function BattleSetup({ onBattleReady }: BattleSetupProps) {
  const {
    savedDecks,
    player1Deck,
    player2Deck,
    setPlayer1Deck,
    setPlayer2Deck,
    refreshSavedDecks,
  } = useDeckStore();
  const [player1Name, setPlayer1Name] = useState("You");
  const [player2Name, setPlayer2Name] = useState("AI Opponent");
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [aiKind, setAiKind] = useState<AiKind>("heuristic");

  function deckFromList(name: string, text: string): BuiltDeck {
    return { ...buildPlaytestDeckFromCorpusText(name, text), id: crypto.randomUUID() };
  }

  function playMatchup(matchup: PublicMatchup) {
    const { you, ai } = matchupSides(matchup);
    setError(null);
    setPlayer1Name("You");
    setPlayer2Name("AI");
    const deck1 = deckFromList(you.name, you.text);
    const deck2 = deckFromList(ai.name, ai.text);
    setPlayer1Deck(deck1);
    setPlayer2Deck(deck2);
    const messages = [...deck1.resolveErrors, ...deck2.resolveErrors];
    const ready = deck1.validation.valid && deck2.validation.valid && messages.length === 0;
    if (!ready) {
      setError(messages.join("\n") || "Those decks are not ready to play yet.");
      return;
    }
    onBattleReady({ player1Name: "You", player2Name: "AI", aiKind: "heuristic" });
  }

  function loadDecks(p1: { name: string; text: string }, p2: { name: string; text: string }) {
    setError(null);
    setPlayer1Name(p1.name);
    setPlayer2Name(p2.name);
    const deck1 = deckFromList(p1.name, p1.text);
    const deck2 = deckFromList(p2.name, p2.text);
    setPlayer1Deck(deck1);
    setPlayer2Deck(deck2);
    setShareUrl(
      buildShareUrl({ list1: p1.text, list2: p2.text, list1Name: p1.name, list2Name: p2.name }),
    );
    const messages = [...deck1.resolveErrors, ...deck2.resolveErrors];
    if (messages.length > 0) setError(messages.join("\n"));
  }

  function loadSavedDeck(slot: "p1" | "p2", text: string, name: string) {
    setError(null);
    const deck = deckFromList(name, text);
    if (slot === "p1") setPlayer1Deck(deck);
    else setPlayer2Deck(deck);
    if (!deck.validation.valid || deck.resolveErrors.length > 0) {
      setError(
        [
          ...deck.resolveErrors,
          ...deck.validation.issues.filter((issue) => issue.level === "error").map((issue) => issue.message),
        ].join("\n"),
      );
    }
  }

  useEffect(() => {
    const payload = parseLocationHash();
    if (!payload) return;
    loadDecks(
      { name: payload.list1Name ?? "You", text: payload.list1 },
      { name: payload.list2Name ?? "AI Opponent", text: payload.list2 },
    );
  }, []);

  const canProceed =
    player1Deck?.validation.valid &&
    player2Deck?.validation.valid &&
    player1Deck.resolveErrors.length === 0 &&
    player2Deck.resolveErrors.length === 0;

  return (
    <div className="battle-setup" data-testid="battle-setup">
      <section className="panel battle-setup__hero">
        <header className="panel__header">
          <div>
            <h2>Play</h2>
            <p className="battle-setup__lead">
              Tap a matchup to start. The decks are already in the app, so the game opens immediately.
            </p>
          </div>
        </header>

        <div className="matchup-grid">
          {PUBLIC_MATCHUPS.map((matchup) => (
            <button
              key={matchup.id}
              type="button"
              className="matchup-card"
              data-testid={matchup.testId}
              onClick={() => playMatchup(matchup)}
            >
              <strong>{matchup.title}</strong>
              <span>{matchup.detail}</span>
            </button>
          ))}
        </div>
        {error && (
          <pre className="error-box" data-testid="battle-error">
            {error}
          </pre>
        )}
      </section>

      <section className="battle-setup__custom">
        <header className="panel__header">
          <div>
            <h3>Or pick your own decks</h3>
            <p className="battle-setup__lead">
              Tournament lists and saved decks. The fast AI plays the opponent.
            </p>
          </div>
          <div className="panel__actions">
            <button type="button" onClick={() => setShowBuilder((value) => !value)}>
              {showBuilder ? "Hide deck builder" : "Build deck"}
            </button>
            {shareUrl && (
              <button type="button" onClick={() => void navigator.clipboard.writeText(shareUrl)}>
                Copy share link
              </button>
            )}
          </div>
        </header>
      <div className="battle-setup__grid">
        <section className="panel deck-box deck-box--you">
          <h3>Your deck</h3>
          <label className="field">
            <span>Display name</span>
            <input
              data-testid="player-name"
              value={player1Name}
              onChange={(e) => setPlayer1Name(e.target.value)}
            />
          </label>
          <select
            data-testid="select-p1-deck"
            defaultValue=""
            onChange={(event) => {
              const preset = getTournamentDeckById(event.target.value);
              if (preset) {
                loadSavedDeck("p1", preset.text, preset.label);
                return;
              }
              const saved = savedDecks.find((entry) => entry.id === event.target.value);
              if (saved) loadSavedDeck("p1", saved.text, saved.name);
            }}
          >
            <option value="" disabled>
              Load deck…
            </option>
            {ALL_TOURNAMENTS.map((tournament) => (
              <optgroup key={tournament.tournamentId} label={tournament.name}>
                {tournament.decks.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {savedDecks.length > 0 && (
              <optgroup label="Saved">
                {savedDecks.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {player1Deck ? (
            <div className="deck-box__summary" data-testid="p1-deck-summary">
              <strong>{player1Deck.name}</strong>
              <span>{player1Deck.cards.length} cards</span>
              <span className={player1Deck.validation.valid ? "status-ok" : "status-bad"}>
                {player1Deck.validation.valid ? "Valid" : "Invalid"}
              </span>
            </div>
          ) : (
            <p className="panel__meta">No deck selected</p>
          )}
        </section>

        <section className="panel deck-box deck-box--ai">
          <h3>AI opponent</h3>
          <label className="field">
            <span>Opponent name</span>
            <input
              data-testid="opponent-name"
              value={player2Name}
              onChange={(e) => setPlayer2Name(e.target.value)}
            />
          </label>

          <fieldset className="battle-setup__ai-kind">
            <legend>AI engine</legend>
            <label>
              <input
                type="radio"
                data-testid="ai-heuristic"
                name="aiKind"
                checked={aiKind === "heuristic"}
                onChange={() => setAiKind("heuristic")}
              />
              Heuristic (fast, meta-aware)
            </label>
            <label>
              <input
                type="radio"
                data-testid="ai-llm"
                name="aiKind"
                checked={aiKind === "llm"}
                onChange={() => setAiKind("llm")}
              />
              LLM agent (local model only)
            </label>
          </fieldset>

          <select
            data-testid="select-p2-deck"
            defaultValue=""
            onChange={(event) => {
              const preset = getTournamentDeckById(event.target.value);
              if (preset) {
                loadSavedDeck("p2", preset.text, preset.label);
                return;
              }
              const saved = savedDecks.find((entry) => entry.id === event.target.value);
              if (saved) loadSavedDeck("p2", saved.text, saved.name);
            }}
          >
            <option value="" disabled>
              Opponent deck…
            </option>
            {ALL_TOURNAMENTS.map((tournament) => (
              <optgroup key={tournament.tournamentId} label={tournament.name}>
                {tournament.decks.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {savedDecks.length > 0 && (
              <optgroup label="Saved">
                {savedDecks.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {player2Deck ? (
            <div className="deck-box__summary" data-testid="p2-deck-summary">
              <strong>{player2Deck.name}</strong>
              <span>{player2Deck.cards.length} cards</span>
              <span className={player2Deck.validation.valid ? "status-ok" : "status-bad"}>
                {player2Deck.validation.valid ? "Valid" : "Invalid"}
              </span>
            </div>
          ) : (
            <p className="panel__meta">No opponent deck</p>
          )}
        </section>
      </div>

      <div className="panel__actions battle-setup__footer">
        <button type="button" onClick={refreshSavedDecks}>
          Refresh saved decks
        </button>
        <button
          type="button"
          data-testid="continue-vs"
          disabled={!canProceed}
          className="action-dock__primary battle-setup__continue"
          onClick={() => onBattleReady({ player1Name, player2Name, aiKind })}
        >
          Continue to VS →
        </button>
      </div>
      </section>

      {showBuilder && (
        <DeckBuilder
          onDeckBuilt={(deck) => {
            if (!player1Deck) setPlayer1Deck(deck);
            else if (!player2Deck) setPlayer2Deck(deck);
          }}
        />
      )}
    </div>
  );
}
