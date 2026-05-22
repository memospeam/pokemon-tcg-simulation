import { CardType } from "@/lib/models/enums";
import type { Card } from "@/lib/models/card";
import { cardDetail } from "@/lib/models/card";

const typeLabels: Record<CardType, string> = {
  [CardType.Pokemon]: "Pokémon",
  [CardType.Trainer]: "Trainer",
  [CardType.Energy]: "Energy",
};

interface CardTileProps {
  card: Card;
  compact?: boolean;
}

export function CardTile({ card, compact = false }: CardTileProps) {
  return (
    <article className={`card-tile card-tile--${card.cardType}`} data-compact={compact}>
      <span className="card-tile__type">{typeLabels[card.cardType]}</span>
      <h3 className="card-tile__name">{card.name}</h3>
      {!compact && <p className="card-tile__detail">{cardDetail(card)}</p>}
    </article>
  );
}
