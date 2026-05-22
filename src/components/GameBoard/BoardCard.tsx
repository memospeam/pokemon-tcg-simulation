import type { CardDefinition } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import { getDefinition, remainingHp } from "@/lib/engine";
import type { EngineState } from "@/lib/engine";

type BoardCardSize = "hand" | "bench" | "active" | "mini";

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
      <img src={def.images.small} alt={def.name} className="board-card__image" loading="lazy" />
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
              <img
                key={energy.instanceId}
                src={energyDef.images.small}
                alt={energyDef.name}
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
  return (
    <div className="board-card board-card--mini board-card--badge">
      <img src={definition.images.small} alt={definition.name} className="board-card__image" />
      <span>{definition.name}</span>
    </div>
  );
}
