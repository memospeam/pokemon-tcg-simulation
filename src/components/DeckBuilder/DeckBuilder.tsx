import { useMemo, useState } from "react";
import { buildDeckFromText } from "@/lib/deck/builder";
import { deckListToText, parseLimitlessDeckList } from "@/lib/deck/limitlessParser";
import { useDeckStore } from "@/stores/deckStore";
import type { BuiltDeck } from "@/lib/deck/builder";

const SAMPLE_DECK = `Pokémon: 18
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
2 Munkidori TWM 95
1 Dunsparce JTG 120
1 Dudunsparce TEF 129
1 Meowth ex POR 62
1 Fezandipiti ex ASC 142
1 Budew ASC 16

Trainer: 32
4 Lillie's Determination MEG 119
3 Crispin SCR 133
3 Boss's Orders MEG 114
1 Judge POR 76
4 Poké Pad POR 81
4 Buddy-Buddy Poffin TEF 144
4 Ultra Ball MEG 131
4 Crushing Hammer POR 71
2 Night Stretcher ASC 196
1 Unfair Stamp TWM 165
2 Risky Ruins MEG 127

Energy: 10
4 Psychic Energy MEE 5
3 Fire Energy MEE 2
3 Darkness Energy MEE 7`;

interface DeckBuilderProps {
  onDeckBuilt?: (deck: BuiltDeck) => void;
  /** Called after the built deck is set as Player 1's deck (e.g. navigate to the Lobby). */
  onUseDeck?: () => void;
}

export function DeckBuilder({ onDeckBuilt, onUseDeck }: DeckBuilderProps) {
  // Saved decks live in the shared store so that saving here is immediately
  // reflected in the Lobby's "Load deck" dropdown (no manual refresh needed).
  const { savedDecks, saveDeck, removeDeck, setPlayer1Deck } = useDeckStore();
  const [name, setName] = useState("My Deck");
  const [text, setText] = useState(SAMPLE_DECK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<BuiltDeck | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const groupedCards = useMemo(() => {
    if (!deck) return [];
    const counts = new Map<string, { count: number; image?: string }>();
    for (const card of deck.cards) {
      const existing = counts.get(card.name) ?? { count: 0, image: card.images.small };
      existing.count += 1;
      counts.set(card.name, existing);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [deck]);

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const built = await buildDeckFromText(name, text);
      setDeck(built);
      onDeckBuilt?.(built);
      if (built.resolveErrors.length > 0) {
        setError(built.resolveErrors.join("\n"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleClipboardImport() {
    try {
      const clip = await navigator.clipboard.readText();
      setText(clip);
    } catch {
      setError("Could not read clipboard.");
    }
  }

  function handleSave() {
    if (!deck) return;
    saveDeck(deck);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  function handleUseToPlay() {
    if (!deck) return;
    // Make this the Player 1 deck and (optionally) jump to the Lobby to pick an
    // opponent and start the match.
    if (!savedDecks.some((d) => d.name === deck.name)) saveDeck(deck);
    setPlayer1Deck(deck);
    onUseDeck?.();
  }

  function handleLoadSaved(savedText: string, savedName: string) {
    setName(savedName);
    setText(savedText);
  }

  function handleDeleteSaved(id: string) {
    removeDeck(id);
  }

  function handleExport() {
    if (!deck) return;
    const exported = deckListToText(deck.name, parseLimitlessDeckList(deck.text).lines);
    void navigator.clipboard.writeText(exported);
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2>Deck Builder</h2>
          <p>Paste a Limitless/PTCGL decklist and resolve real cards from pokemontcg.io.</p>
        </div>
        <div className="panel__actions">
          <label className="field">
            <span>Deck name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="button" onClick={() => void handleClipboardImport()}>
            Import from clipboard
          </button>
          <button type="button" onClick={() => void handleImport()} disabled={loading}>
            {loading ? "Resolving..." : "Resolve deck"}
          </button>
        </div>
      </header>

      <textarea
        className="deck-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={16}
      />

      {error && <pre className="error-box">{error}</pre>}

      {deck && (
        <>
          <div className="deck-summary">
            <div>
              <strong>{deck.cards.length}</strong> cards
            </div>
            <div className={deck.validation.valid ? "status-ok" : "status-bad"}>
              {deck.validation.valid ? "Valid deck" : "Invalid deck"}
            </div>
            <button type="button" onClick={handleSave}>
              {justSaved ? "Saved ✓" : "Save to My Decks"}
            </button>
            <button
              type="button"
              className="action-dock__primary"
              onClick={handleUseToPlay}
              disabled={!deck.validation.valid}
              title={deck.validation.valid ? "Save & use as Player 1, then go to the Lobby" : "Deck must be valid to play"}
            >
              ▶ Use to play
            </button>
            <button type="button" onClick={handleExport}>
              Export text
            </button>
          </div>

          <ul className="validation-list">
            {deck.validation.issues.map((issue) => (
              <li key={issue.message} data-level={issue.level}>
                {issue.message}
              </li>
            ))}
          </ul>

          <div className="card-grid card-grid--compact">
            {groupedCards.map(([cardName, info]) => (
              <article key={cardName} className="card-tile card-tile--pokemon">
                {info.image && <img src={info.image} alt={cardName} className="card-image" />}
                <h3 className="card-tile__name">
                  {info.count}x {cardName}
                </h3>
              </article>
            ))}
          </div>
        </>
      )}

      {savedDecks.length > 0 && (
        <div className="saved-decks">
          <h3>My Decks</h3>
          <ul>
            {savedDecks.map((saved) => (
              <li key={saved.id}>
                <button type="button" onClick={() => handleLoadSaved(saved.text, saved.name)}>
                  {saved.name}
                </button>
                <button type="button" className="danger-button" onClick={() => handleDeleteSaved(saved.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
