import type { BuiltDeck } from "@/lib/deck/builder";
import type { AiKind } from "@/stores/gameStore";

export interface VsScreenProps {
  playerName: string;
  opponentName: string;
  playerDeck: BuiltDeck;
  opponentDeck: BuiltDeck;
  aiKind: AiKind;
  onStart: () => void;
  onBack: () => void;
}

export function VsScreen({
  playerName,
  opponentName,
  playerDeck,
  opponentDeck,
  aiKind,
  onStart,
  onBack,
}: VsScreenProps) {
  return (
    <div className="vs-screen">
      <div className="vs-screen__backdrop" />
      <div className="vs-screen__content">
        <p className="vs-screen__eyebrow">Ready to battle</p>
        <div className="vs-screen__fighters">
          <article className="vs-screen__fighter vs-screen__fighter--you">
            <span className="vs-screen__role">You</span>
            <h2>{playerName}</h2>
            <p className="vs-screen__deck">{playerDeck.name}</p>
            <span className="vs-screen__meta">{playerDeck.cards.length} cards</span>
          </article>

          <div className="vs-screen__badge" aria-hidden>
            VS
          </div>

          <article className="vs-screen__fighter vs-screen__fighter--rival">
            <span className="vs-screen__role">{aiKind === "llm" ? "LLM AI" : "Heuristic AI"}</span>
            <h2>{opponentName}</h2>
            <p className="vs-screen__deck">{opponentDeck.name}</p>
            <span className="vs-screen__meta">{opponentDeck.cards.length} cards</span>
          </article>
        </div>

        <div className="vs-screen__actions">
          <button type="button" className="vs-screen__back" onClick={onBack}>
            ← Back
          </button>
          <button type="button" className="vs-screen__start action-dock__primary" onClick={onStart}>
            Start Battle
          </button>
        </div>
      </div>
    </div>
  );
}
