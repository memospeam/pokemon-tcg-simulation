import { useEffect, useState } from "react";
import { buildDeckFromText } from "@/lib/deck/builder";
import {
  DRAGAPULT_DECK_1,
  DRAGAPULT_DECK_2,
  buildShareUrl,
  parseLocationHash,
} from "@/lib/deck/tcgmastersUrl";
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
  const [loadingSlot, setLoadingSlot] = useState<"p1" | "p2" | "both" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [aiKind, setAiKind] = useState<AiKind>("heuristic");

  async function loadDecks(
    p1: { name: string; text: string },
    p2: { name: string; text: string },
  ) {
    setLoadingSlot("both");
    setError(null);
    setPlayer1Name(p1.name);
    setPlayer2Name(p2.name);
    try {
      const [deck1, deck2] = await Promise.all([
        buildDeckFromText(p1.name, p1.text),
        buildDeckFromText(p2.name, p2.text),
      ]);
      setPlayer1Deck(deck1);
      setPlayer2Deck(deck2);
      setShareUrl(buildShareUrl({ list1: p1.text, list2: p2.text, list1Name: p1.name, list2Name: p2.name }));
      const messages = [...deck1.resolveErrors, ...deck2.resolveErrors];
      if (messages.length > 0) setError(messages.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decks");
    } finally {
      setLoadingSlot(null);
    }
  }

  async function loadSavedDeck(slot: "p1" | "p2", text: string, name: string) {
    setLoadingSlot(slot);
    setError(null);
    try {
      const deck = await buildDeckFromText(name, text);
      if (slot === "p1") setPlayer1Deck(deck);
      else setPlayer2Deck(deck);
      if (!deck.validation.valid || deck.resolveErrors.length > 0) {
        setError(
          [
            ...deck.resolveErrors,
            ...deck.validation.issues.filter((i) => i.level === "error").map((i) => i.message),
          ].join("\n"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deck");
    } finally {
      setLoadingSlot(null);
    }
  }

  useEffect(() => {
    const payload = parseLocationHash();
    if (!payload) return;
    void loadDecks(
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
    <div className="battle-setup">
      <section className="panel battle-setup__hero">
        <header className="panel__header">
          <div>
            <h2>Battle</h2>
            <p className="battle-setup__lead">
              Choose your deck and AI opponent — PTCGL-style solo battles against heuristic or LLM agents.
            </p>
          </div>
          <button type="button" onClick={() => setShowBuilder((value) => !value)}>
            {showBuilder ? "Hide deck builder" : "Build deck"}
          </button>
        </header>

        <div className="panel__actions lobby-presets">
          <button
            type="button"
            disabled={loadingSlot !== null}
            onClick={() => void loadDecks(DRAGAPULT_DECK_1, DRAGAPULT_DECK_2)}
          >
            {loadingSlot === "both" ? "Loading…" : "Quick: Dragapult mirror"}
          </button>
          {shareUrl && (
            <button type="button" onClick={() => void navigator.clipboard.writeText(shareUrl)}>
              Copy share link
            </button>
          )}
        </div>
      </section>

      <div className="battle-setup__grid">
        <section className="panel deck-box deck-box--you">
          <h3>Your deck</h3>
          <label className="field">
            <span>Display name</span>
            <input value={player1Name} onChange={(e) => setPlayer1Name(e.target.value)} />
          </label>
          <select
            defaultValue=""
            onChange={(event) => {
              const preset = getTournamentDeckById(event.target.value);
              if (preset) {
                void loadSavedDeck("p1", preset.text, preset.label);
                return;
              }
              const saved = savedDecks.find((entry) => entry.id === event.target.value);
              if (saved) void loadSavedDeck("p1", saved.text, saved.name);
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
            <div className="deck-box__summary">
              <strong>{player1Deck.name}</strong>
              <span>{player1Deck.cards.length} cards</span>
              <span className={player1Deck.validation.valid ? "status-ok" : "status-bad"}>
                {player1Deck.validation.valid ? "Valid" : "Invalid"}
              </span>
            </div>
          ) : (
            <p className="panel__meta">No deck selected</p>
          )}
          {loadingSlot === "p1" && <p className="panel__meta">Resolving…</p>}
        </section>

        <section className="panel deck-box deck-box--ai">
          <h3>AI opponent</h3>
          <label className="field">
            <span>Opponent name</span>
            <input value={player2Name} onChange={(e) => setPlayer2Name(e.target.value)} />
          </label>

          <fieldset className="battle-setup__ai-kind">
            <legend>AI engine</legend>
            <label>
              <input
                type="radio"
                name="aiKind"
                checked={aiKind === "heuristic"}
                onChange={() => setAiKind("heuristic")}
              />
              Heuristic (fast, meta-aware)
            </label>
            <label>
              <input
                type="radio"
                name="aiKind"
                checked={aiKind === "llm"}
                onChange={() => setAiKind("llm")}
              />
              LLM agent (reads card text)
            </label>
          </fieldset>

          <select
            defaultValue=""
            onChange={(event) => {
              const preset = getTournamentDeckById(event.target.value);
              if (preset) {
                void loadSavedDeck("p2", preset.text, preset.label);
                return;
              }
              const saved = savedDecks.find((entry) => entry.id === event.target.value);
              if (saved) void loadSavedDeck("p2", saved.text, saved.name);
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
            <div className="deck-box__summary">
              <strong>{player2Deck.name}</strong>
              <span>{player2Deck.cards.length} cards</span>
              <span className={player2Deck.validation.valid ? "status-ok" : "status-bad"}>
                {player2Deck.validation.valid ? "Valid" : "Invalid"}
              </span>
            </div>
          ) : (
            <p className="panel__meta">No opponent deck</p>
          )}
          {loadingSlot === "p2" && <p className="panel__meta">Resolving…</p>}
        </section>
      </div>

      {error && <pre className="error-box">{error}</pre>}

      <div className="panel__actions battle-setup__footer">
        <button type="button" onClick={refreshSavedDecks}>
          Refresh saved decks
        </button>
        <button
          type="button"
          disabled={!canProceed || loadingSlot !== null}
          className="action-dock__primary battle-setup__continue"
          onClick={() => onBattleReady({ player1Name, player2Name, aiKind })}
        >
          Continue to VS →
        </button>
      </div>

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
