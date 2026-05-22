import type { EngineState } from "@/lib/engine";
import { getDefinition, getPlayer } from "@/lib/engine";
import type { CardInstance } from "@/lib/models/instance";
import { BoardCard } from "./BoardCard";

interface PendingActionPanelProps {
  game: EngineState;
  onPickDeck: (instanceId: string) => void;
  onSkipOptional: () => void;
}

function deckSearchTitle(pending: Extract<EngineState["pendingAction"], { type: "SEARCH_DECK" }>): string {
  const count = pending.options.length;
  const slots = pending.slotsRemaining;
  if (pending.filter === "POFFIN") return `Buddy-Buddy Poffin — ${count} eligible Pokémon`;
  if (pending.filter === "POKEMON_NO_RULE_BOX") return `Poké Pad — ${count} Pokémon without Rule Box`;
  if (pending.filter === "SUPPORTER_HAND") return `Choose a Supporter — ${count} found`;
  if (pending.filter === "TOOL_HAND") return `Treasure Tracker — choose Tools (${slots ?? 1} remaining)`;
  if (pending.filter === "TYPED_POKEMON_MAX_HP_HAND") {
    const type = pending.searchMeta?.typeFilter ?? "Pokémon";
    const maxHp = pending.searchMeta?.maxHp ?? 100;
    return `Fan Call — up to ${slots ?? 1} ${type} ≤${maxHp} HP (${count} found)`;
  }
  if (pending.filter === "NAMED_POKEMON_BENCH") {
    const name = pending.searchMeta?.nameFilter ?? "matching";
    return `Search ${name} Pokémon to Bench (${slots ?? 1} remaining, ${count} found)`;
  }
  if (slots && slots > 1) return `Deck search — choose up to ${slots} (${count} found)`;
  return `Deck search — ${count} card${count === 1 ? "" : "s"} found`;
}

function resolveDeckCards(
  game: EngineState,
  pending: Extract<EngineState["pendingAction"], { type: "SEARCH_DECK" }>,
): CardInstance[] {
  const player = getPlayer(game, pending.playerId);
  return pending.options
    .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
    .filter(Boolean) as CardInstance[];
}

export function PendingActionPanel({
  game,
  onPickDeck,
  onSkipOptional,
}: PendingActionPanelProps) {
  const pending = game.pendingAction;
  if (!pending) return null;

  if (pending.type === "SEARCH_DECK") {
    const cards = resolveDeckCards(game, pending);
    const showSkip = (pending.slotsRemaining ?? 1) > 1;

    return (
      <div className="pending-panel pending-panel--deck">
        <div className="pending-panel__header">
          <h4>{deckSearchTitle(pending)}</h4>
          {showSkip && (
            <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
              Done / Skip
            </button>
          )}
        </div>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onPickDeck(card.instanceId)}
              >
                <BoardCard state={game} card={card} size="hand" showName={false} />
                <span>{def?.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (pending.type === "RECON_DIRECTIVE") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];

    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Recon Directive — top of deck</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onPickDeck(card.instanceId)}
              >
                <BoardCard state={game} card={card} size="hand" showName={false} />
                <span>{def?.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (pending.type === "CRISPIN_DISCARD") {
    return (
      <div className="pending-panel pending-panel--compact">
        <p>Crispin: optionally discard 1 card from hand to draw 2.</p>
        <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
          Skip optional effect
        </button>
      </div>
    );
  }

  return null;
}
