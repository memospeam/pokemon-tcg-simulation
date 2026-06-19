import { useEffect, useState } from "react";
import { buildDeckFromText } from "@/lib/deck/builder";
import {
  DRAGAPULT_DECK_1,
  DRAGAPULT_DECK_2,
  buildShareUrl,
  parseLocationHash,
} from "@/lib/deck/tcgmastersUrl";
import { TOURNAMENT_535_TOP16, getTournamentDeckById } from "@/lib/deck/tournamentPresets";
import { useDeckStore } from "@/stores/deckStore";
import { DeckBuilder } from "../DeckBuilder/DeckBuilder";

interface LobbyProps {
  onPlay: (player1Name: string, player2Name: string, vsAI?: boolean, aiKind?: "heuristic" | "llm") => void;
}

export function Lobby({ onPlay }: LobbyProps) {
  const {
    savedDecks,
    player1Deck,
    player2Deck,
    setPlayer1Deck,
    setPlayer2Deck,
    refreshSavedDecks,
  } = useDeckStore();
  const [player1Name, setPlayer1Name] = useState("Player 1");
  const [player2Name, setPlayer2Name] = useState("Player 2");
  const [loadingSlot, setLoadingSlot] = useState<"p1" | "p2" | "both" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(false);

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
      { name: payload.list1Name ?? "Player 1", text: payload.list1 },
      { name: payload.list2Name ?? "Player 2", text: payload.list2 },
    );
  }, []);

  const canPlay =
    player1Deck?.validation.valid &&
    player2Deck?.validation.valid &&
    player1Deck.resolveErrors.length === 0 &&
    player2Deck.resolveErrors.length === 0;

  return (
    <div className="lobby">
      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Play Match</h2>
            <p>
              Load tournament decks from{" "}
              <a href={TOURNAMENT_535_TOP16.sourceUrl} target="_blank" rel="noreferrer">
                {TOURNAMENT_535_TOP16.name} Top 16
              </a>
              , the Dragapult mirror preset, or your saved decklists.
            </p>
          </div>
          <button type="button" onClick={() => setShowBuilder((value) => !value)}>
            {showBuilder ? "Hide deck builder" : "Open deck builder"}
          </button>
        </header>

        <div className="panel__actions lobby-presets">
          <button
            type="button"
            disabled={loadingSlot !== null}
            onClick={() => void loadDecks(DRAGAPULT_DECK_1, DRAGAPULT_DECK_2)}
          >
            {loadingSlot === "both" ? "Loading Dragapult decks..." : "Load Dragapult mirror (tcgmasters)"}
          </button>
          {shareUrl && (
            <button type="button" onClick={() => void navigator.clipboard.writeText(shareUrl)}>
              Copy share link
            </button>
          )}
        </div>

        <div className="lobby-slots">
          {(["p1", "p2"] as const).map((slot) => {
            const deck = slot === "p1" ? player1Deck : player2Deck;
            const title = slot === "p1" ? player1Name : player2Name;
            return (
              <div key={slot} className="deck-slot">
                <label className="field">
                  <span>{slot === "p1" ? "Player 1" : "Player 2"} name</span>
                  <input
                    value={slot === "p1" ? player1Name : player2Name}
                    onChange={(event) =>
                      slot === "p1"
                        ? setPlayer1Name(event.target.value)
                        : setPlayer2Name(event.target.value)
                    }
                  />
                </label>

                <select
                  defaultValue=""
                  onChange={(event) => {
                    const preset = getTournamentDeckById(event.target.value);
                    if (preset) {
                      void loadSavedDeck(slot, preset.text, preset.label);
                      return;
                    }
                    const saved = savedDecks.find((entry) => entry.id === event.target.value);
                    if (saved) void loadSavedDeck(slot, saved.text, saved.name);
                  }}
                >
                  <option value="" disabled>
                    Load deck
                  </option>
                  <optgroup label={`${TOURNAMENT_535_TOP16.name} Top 16`}>
                    {TOURNAMENT_535_TOP16.decks.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </optgroup>
                  {savedDecks.length > 0 && (
                    <optgroup label="Saved decks">
                      {savedDecks.map((saved) => (
                        <option key={saved.id} value={saved.id}>
                          {saved.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {deck ? (
                  <div className="deck-slot__summary">
                    <strong>{deck.name}</strong>
                    <span>{deck.cards.length} cards</span>
                    <span className={deck.validation.valid ? "status-ok" : "status-bad"}>
                      {deck.validation.valid ? "Valid" : "Invalid"}
                    </span>
                  </div>
                ) : (
                  <p className="panel__meta">No deck selected for {title}.</p>
                )}

                {loadingSlot === slot && <p className="panel__meta">Resolving cards...</p>}
              </div>
            );
          })}
        </div>

        {error && <pre className="error-box">{error}</pre>}

        <div className="panel__actions">
          <button type="button" onClick={refreshSavedDecks}>
            Refresh saved decks
          </button>

          <label className="lobby-mode-toggle">
            <input
              type="checkbox"
              checked={useLlm}
              onChange={(e) => setUseLlm(e.target.checked)}
            />
            {" "}Opponent = LLM agent (reads card text; needs Ollama/Groq — see README)
          </label>

          <button
            type="button"
            disabled={!canPlay || loadingSlot !== null}
            onClick={() => onPlay(player1Name, player2Name, true, useLlm ? "llm" : "heuristic")}
            className="action-dock__primary"
          >
            {useLlm ? "🤖 Play vs LLM" : "⚔️ Play vs AI"}
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
