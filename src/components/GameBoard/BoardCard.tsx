import type { CardDefinition } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import { getDefinition, remainingHp } from "@/lib/engine";
import type { EngineState } from "@/lib/engine";
import { useCardImage } from "@/lib/ui/useCardImage";

type BoardCardSize = "hand" | "bench" | "active" | "mini";

/** Small helper so the hook is always called at the top level of a component. */
function CardImage({
  def,
  className,
  title,
}: {
  def: CardDefinition;
  className: string;
  title?: string;
}) {
  const src = useCardImage(def);
  return <img src={src} alt={def.name} className={className} title={title} loading="lazy" />;
}

interface BoardCardProps {
  state: EngineState;
  card: CardInstance;
  onSelect?: (card: CardInstance) => void;
  selected?: boolean;
  highlight?: boolean;
  size?: BoardCardSize;
  showName?: boolean;
}

export function BoardCard({
  state,
  card,
  onSelect,
  selected,
  highlight,
  size = "bench",
  showName = true,
}: BoardCardProps) {
  const def = getDefinition(state, card.definitionId);
  if (!def) return null;

  return (
    <button
      type="button"
      className={[
        "board-card",
        `board-card--${def.supertype.toLowerCase()}`,
        `board-card--${size}`,
        selected ? "board-card--selected" : "",
        highlight ? "board-card--highlight" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect?.(card)}
    >
      <CardImage def={def} className="board-card__image" />
      {showName && size !== "hand" && <span className="board-card__name">{def.name}</span>}
      {def.supertype === "Pokémon" && size !== "hand" && (
        <span className="board-card__hp">
          {remainingHp(state, card)}/{def.hp ?? 0}
        </span>
      )}
      {card.attachedEnergy.length > 0 && (
        <div className="board-card__energy-row">
          {card.attachedEnergy.map((energy) => {
            const energyDef = getDefinition(state, energy.definitionId);
            return energyDef ? (
              <CardImage
                key={energy.instanceId}
                def={energyDef}
                className="board-card__energy-icon"
                title={energyDef.name}
              />
            ) : null;
          })}
        </div>
      )}
    </button>
  );
}

export function CardDefinitionBadge({ definition }: { definition: CardDefinition }) {
  const src = useCardImage(definition);
  return (
    <div className="board-card board-card--mini board-card--badge">
      <img src={src} alt={definition.name} className="board-card__image" />
      <span>{definition.name}</span>
    </div>
  );
}
