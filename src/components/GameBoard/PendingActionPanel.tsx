import type { EngineState } from "@/lib/engine";
import { getDefinition, getPlayer } from "@/lib/engine";
import { isSupporter } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import { BoardCard } from "./BoardCard";

interface PendingActionPanelProps {
  game: EngineState;
  onPickDeck: (instanceId: string) => void;
  onPickDiscard: (instanceId: string) => void;
  onDiscardHandCard: (instanceId: string) => void;
  onChooseBenchAttack: (benchPokemonId: string, attackName: string) => void;
  onSkipOptional: () => void;
  onConfirmDrawUntil: () => void;
  onSelectGrandTreeBasic?: (targetId: string) => void;
  onSelectGrandTreeDeck?: (instanceId: string) => void;
  onSkipGrandTreeStage2?: () => void;
  onSelectAcademyAtNight?: (instanceId: string) => void;
  onSelectLevincia?: (instanceId: string) => void;
  onSelectSpikemuthGym?: (instanceId: string) => void;
  onSelectSurfingBeach?: (benchInstanceId: string) => void;
  onSelectMysteryGarden?: (instanceId: string) => void;
  onSelectPrismTower?: (instanceId: string) => void;
}

function deckSearchTitle(pending: Extract<EngineState["pendingAction"], { type: "SEARCH_DECK" }>): string {
  const count = pending.options.length;
  const slots = pending.slotsRemaining;
  if (pending.filter === "POFFIN") return `Buddy-Buddy Poffin — ${count} eligible Pokémon`;
  if (pending.filter === "POKEMON_NO_RULE_BOX") return `Poké Pad — ${count} Pokémon without Rule Box`;
  if (pending.filter === "SUPPORTER_HAND") return `Choose a Supporter — ${count} found`;
  if (pending.filter === "POKEGEAR_TOP7") return `Pokégear 3.0 — top 7 cards (${count} Supporter${count === 1 ? "" : "s"})`;
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
  onPickDiscard,
  onDiscardHandCard,
  onChooseBenchAttack,
  onSkipOptional,
  onConfirmDrawUntil,
  onSelectGrandTreeBasic,
  onSelectGrandTreeDeck,
  onSkipGrandTreeStage2,
  onSelectAcademyAtNight,
  onSelectLevincia,
  onSelectSpikemuthGym,
  onSelectSurfingBeach,
  onSelectMysteryGarden,
  onSelectPrismTower,
}: PendingActionPanelProps) {
  const pending = game.pendingAction;
  if (!pending) return null;

  if (pending.type === "SEARCH_DECK") {
    const cards = resolveDeckCards(game, pending);
    const showSkip = pending.filter === "POKEGEAR_TOP7" || (pending.slotsRemaining ?? 1) > 1;

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

  if (pending.type === "DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE") {
    const player = getPlayer(game, pending.playerId);
    const eligibleCards = player.hand.filter((card) => {
      const def = getDefinition(game, card.definitionId);
      return def && isSupporter(def) && def.name.toLowerCase().includes(pending.nameFilter.toLowerCase());
    });
    const bonusSoFar = pending.discardedCount * pending.perCard;
    return (
      <div className="pending-panel pending-panel--deck">
        <div className="pending-panel__header">
          <h4>
            Rocket Feathers — discard Team Rocket Supporters (+{pending.perCard} each)
            {pending.discardedCount > 0 && ` · ${pending.discardedCount} discarded (+${bonusSoFar} damage)`}
          </h4>
          <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
            Done — Attack
          </button>
        </div>
        {eligibleCards.length > 0 ? (
          <div className="pending-panel__cards pending-panel__cards--scroll">
            {eligibleCards.map((card) => {
              const def = getDefinition(game, card.definitionId);
              return (
                <button
                  key={card.instanceId}
                  type="button"
                  className="pending-panel__pick"
                  onClick={() => onDiscardHandCard(card.instanceId)}
                >
                  <BoardCard state={game} card={card} size="hand" showName={false} />
                  <span>{def?.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="pending-panel__meta">No Team Rocket Supporters in hand — click "Done" to attack.</p>
        )}
      </div>
    );
  }

  if (pending.type === "ROTO_STICK") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <div className="pending-panel__header">
          <h4>Roto-Stick — choose Supporters from top 4 ({pending.options.length} remaining)</h4>
          <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
            Done / Take none
          </button>
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

  if (pending.type === "MIRACLE_HEADSET") {
    const player = getPlayer(game, pending.playerId);
    const remaining = pending.maxPicks - pending.pickedIds.length;
    const cards = pending.options
      .map((id) => player.discard.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <div className="pending-panel__header">
          <h4>Miracle Headset — choose up to {remaining} Supporter(s) from discard ({pending.options.length} found)</h4>
          <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
            Done
          </button>
        </div>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onPickDiscard(card.instanceId)}
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

  if (pending.type === "BUG_CATCHING_SET") {
    const player = getPlayer(game, pending.playerId);
    const remaining = pending.maxPicks - pending.pickedIds.length;
    const cards = pending.options
      .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <div className="pending-panel__header">
          <h4>Bug Catching Set — choose up to {remaining} card(s) from top 7 ({pending.options.length} found)</h4>
          <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
            Done
          </button>
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

  if (pending.type === "COPY_BENCH_ATTACK") {
    const player = getPlayer(game, pending.playerId);
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Night Joker — choose a Benched N's Pokémon's attack to copy</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {pending.options.map((option) => {
            const benchMon = player.bench.find((b) => b.instanceId === option.benchPokemonId);
            if (!benchMon) return null;
            const def = getDefinition(game, benchMon.definitionId);
            const attack = def?.attacks?.find((a) => a.name === option.attackName);
            return (
              <button
                key={`${option.benchPokemonId}-${option.attackName}`}
                type="button"
                className="pending-panel__pick"
                onClick={() => onChooseBenchAttack(option.benchPokemonId, option.attackName)}
              >
                <BoardCard state={game} card={benchMon} size="hand" showName={false} />
                <span>
                  {def?.name} — {option.attackName}
                  {attack?.damage ? ` (${attack.damage})` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (pending.type === "ACADEMY_AT_NIGHT") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.hand.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Academy at Night — put a card on top of your deck</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectAcademyAtNight?.(card.instanceId)}
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

  if (pending.type === "LEVINCIA") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.discard.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Levincia — choose Basic Lightning Energy ({pending.slotsRemaining} remaining)</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectLevincia?.(card.instanceId)}
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

  if (pending.type === "SPIKEMUTH_GYM") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Spikemuth Gym — choose a Marnie's Pokémon</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectSpikemuthGym?.(card.instanceId)}
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

  if (pending.type === "SURFING_BEACH") {
    const player = getPlayer(game, pending.playerId);
    const targets = pending.options
      .map((id) => player.bench.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Surfing Beach — switch with a Benched Water Pokémon</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {targets.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectSurfingBeach?.(card.instanceId)}
              >
                <BoardCard state={game} card={card} size="bench" showName={false} />
                <span>{def?.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (pending.type === "MYSTERY_GARDEN") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.hand.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Mystery Garden — discard an Energy card</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectMysteryGarden?.(card.instanceId)}
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

  if (pending.type === "PRISM_TOWER") {
    const player = getPlayer(game, pending.playerId);
    const cards = pending.options
      .map((id) => player.hand.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    return (
      <div className="pending-panel pending-panel--deck">
        <h4>Prism Tower — discard {pending.slotsRemaining} card(s) from hand</h4>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {cards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectPrismTower?.(card.instanceId)}
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

  if (pending.type === "GRAND_TREE") {
    const player = getPlayer(game, pending.playerId);
    if (pending.step === "BASIC") {
      const targets = pending.options
        .map((id) => {
          if (player.active?.instanceId === id) return player.active;
          return player.bench.find((entry) => entry.instanceId === id) ?? null;
        })
        .filter(Boolean) as CardInstance[];
      return (
        <div className="pending-panel pending-panel--deck">
          <h4>Grand Tree — choose a Basic Pokémon to evolve</h4>
          <div className="pending-panel__cards pending-panel__cards--scroll">
            {targets.map((card) => {
              const def = getDefinition(game, card.definitionId);
              return (
                <button
                  key={card.instanceId}
                  type="button"
                  className="pending-panel__pick"
                  onClick={() => onSelectGrandTreeBasic?.(card.instanceId)}
                >
                  <BoardCard state={game} card={card} size="bench" showName={false} />
                  <span>{def?.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    const deckCards = pending.options
      .map((id) => player.deck.find((entry) => entry.instanceId === id) ?? null)
      .filter(Boolean) as CardInstance[];
    const stepLabel = pending.step === "STAGE1" ? "Stage 1" : "Stage 2";
    return (
      <div className="pending-panel pending-panel--deck">
        <div className="pending-panel__header">
          <h4>Grand Tree — choose {stepLabel} from deck</h4>
          {pending.step === "STAGE2" && (
            <button type="button" className="pending-panel__skip" onClick={onSkipGrandTreeStage2}>
              Skip Stage 2
            </button>
          )}
        </div>
        <div className="pending-panel__cards pending-panel__cards--scroll">
          {deckCards.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() => onSelectGrandTreeDeck?.(card.instanceId)}
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

  if (pending.type === "DRAW_UNTIL_HAND") {
    return (
      <div className="pending-panel pending-panel--compact">
        <p>
          Draw until you have {pending.targetCount} cards in your hand ({getPlayer(game, pending.playerId).hand.length}{" "}
          now)?
        </p>
        <div className="pending-panel__actions">
          <button type="button" className="pending-panel__pick" onClick={onConfirmDrawUntil}>
            Draw up to {pending.targetCount}
          </button>
          <button type="button" className="pending-panel__skip" onClick={onSkipOptional}>
            Skip optional draw
          </button>
        </div>
      </div>
    );
  }

  return null;
}
