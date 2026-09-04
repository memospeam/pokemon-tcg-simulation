import type { CardInstance } from "@/lib/models/instance";
import type { EngineState } from "@/lib/engine";
import type { PlayerState } from "@/lib/engine";
import { BoardCard } from "./BoardCard";
import { DamageFloatLayer } from "@/components/Match/DamageFloatLayer";
import { isSlotAnimating, type DamageFloat } from "@/components/Match/useBoardSlotVfx";
import type { HandDragKind } from "@/components/Match/useHandDragDrop";

interface PileZoneProps {
  label: string;
  count: number;
  variant?: "prize" | "deck" | "discard";
  onClick?: () => void;
}

export function PileZone({ label, count, variant = "deck", onClick }: PileZoneProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`pile-zone pile-zone--${variant}${onClick ? " pile-zone--clickable" : ""}`}
      onClick={onClick}
    >
      <div className="pile-zone__stack">
        {count > 0 && <div className="pile-zone__card-back" />}
        {count > 1 && <div className="pile-zone__card-back pile-zone__card-back--offset" />}
      </div>
      <span className="pile-zone__label">{label}</span>
      <strong>{count}</strong>
    </Tag>
  );
}

interface PlayerMatProps {
  game: EngineState;
  player: PlayerState;
  label: string;
  isOpponent?: boolean;
  isActiveTurn?: boolean;
  highlightTargets?: boolean;
  onPokemonSelect: (card: CardInstance) => void;
  onActiveSelect?: (card: CardInstance) => void;
  onDiscardClick?: () => void;
  selectedPokemonId?: string;
  dropKindForTarget?: (instanceId: string) => HandDragKind | null;
  onHandDrop?: (card: CardInstance) => void;
  damageFloats?: DamageFloat[];
  evolvingSlots?: Set<string>;
  koSlots?: Set<string>;
}

export function PlayerMat({
  game,
  player,
  label,
  isOpponent = false,
  isActiveTurn = false,
  highlightTargets = false,
  onPokemonSelect,
  onActiveSelect,
  onDiscardClick,
  selectedPokemonId,
  dropKindForTarget,
  onHandDrop,
  damageFloats = [],
  evolvingSlots = new Set<string>(),
  koSlots = new Set<string>(),
}: PlayerMatProps) {
  const matSide = isOpponent ? "opponent" : "self";
  const benchSlots = Array.from({ length: 5 }, (_, i) => player.bench[i] ?? null);

  return (
    <section className={`player-mat${isOpponent ? " player-mat--opponent" : " player-mat--self"}${isActiveTurn ? " player-mat--turn" : ""}`}>
      <div className="player-mat__header">
        <h3>{label}</h3>
        {isActiveTurn && !isOpponent && <span className="player-mat__turn-chip">Your turn</span>}
        {isActiveTurn && isOpponent && <span className="player-mat__turn-chip player-mat__turn-chip--rival">Their turn</span>}
      </div>

      <div className="player-mat__layout">
        <div className="player-mat__left">
          <PileZone label="Prizes" count={player.prizes.length} variant="prize" />
        </div>

        <div className="player-mat__center">
          <div className="player-mat__bench">
            {benchSlots.map((card, index) => (
              <div key={card?.instanceId ?? `empty-${index}`} className="player-mat__bench-slot">
                {card ? (
                  <>
                    <BoardCard
                      state={game}
                      card={card}
                      size="bench"
                      highlight={highlightTargets}
                      selected={selectedPokemonId === card.instanceId}
                      dropKind={dropKindForTarget?.(card.instanceId) ?? undefined}
                      dropHighlight={Boolean(dropKindForTarget?.(card.instanceId))}
                      onHandDrop={onHandDrop ? () => onHandDrop(card) : undefined}
                      animateEvolve={isSlotAnimating(evolvingSlots, matSide, "bench", index)}
                      animateKo={isSlotAnimating(koSlots, matSide, "bench", index)}
                      onSelect={() => onPokemonSelect(card)}
                    />
                    <DamageFloatLayer
                      floats={damageFloats}
                      mat={matSide}
                      slot="bench"
                      benchIndex={index}
                    />
                  </>
                ) : (
                  <div className="player-mat__empty-slot" />
                )}
              </div>
            ))}
          </div>

          <div className="player-mat__active">
            {player.active ? (
              <>
                <BoardCard
                  state={game}
                  card={player.active}
                  size="active"
                  highlight={highlightTargets}
                  selected={selectedPokemonId === player.active.instanceId}
                  dropKind={dropKindForTarget?.(player.active.instanceId) ?? undefined}
                  dropHighlight={Boolean(dropKindForTarget?.(player.active.instanceId))}
                  onHandDrop={onHandDrop ? () => onHandDrop(player.active!) : undefined}
                  animateEvolve={isSlotAnimating(evolvingSlots, matSide, "active")}
                  animateKo={isSlotAnimating(koSlots, matSide, "active")}
                  onSelect={() => (onActiveSelect ?? onPokemonSelect)(player.active!)}
                />
                <DamageFloatLayer floats={damageFloats} mat={matSide} slot="active" />
              </>
            ) : (
              <div className="player-mat__active-empty">Active</div>
            )}
          </div>
        </div>

        <div className="player-mat__right">
          <PileZone label="Deck" count={player.deck.length} variant="deck" />
          <PileZone label="Discard" count={player.discard.length} variant="discard" onClick={onDiscardClick} />
        </div>
      </div>
    </section>
  );
}
