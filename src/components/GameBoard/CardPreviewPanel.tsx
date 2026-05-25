import type { CardDefinition } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import type { GameAction } from "@/lib/engine";
import { formatAttackCost } from "@/lib/engine/energy";
import { getAttackEffectSummary } from "@/lib/engine/effects";
import { summarizeAbility } from "@/lib/engine/effects/abilities";
import { parseAbilityText } from "@/lib/engine/effects/parseText";
import { getTrainerCategory, getTrainerHint } from "@/lib/ui/trainerHints";
import { useCardImageLarge } from "@/lib/ui/useCardImage";
import { isBasicPokemon, isSupporter } from "@/lib/models/definition";
import type { CardAction } from "./CardActionMenu";

interface CardPreviewPanelProps {
  definition: CardDefinition;
  actions: CardAction[];
  onAction: (action: GameAction) => void;
  onClose: () => void;
  attackActions?: CardAction[];
}

function groupActions(actions: CardAction[]) {
  const play: CardAction[] = [];
  const other: CardAction[] = [];

  for (const action of actions) {
    if (
      action.action.type === "PLAY_TRAINER" ||
      action.action.type === "PLACE_ACTIVE" ||
      action.action.type === "PLACE_BENCH" ||
      action.action.type === "PLAY_BASIC_TO_BENCH"
    ) {
      play.push(action);
    } else {
      other.push(action);
    }
  }

  return { play, other };
}

export function CardPreviewPanel({
  definition,
  actions,
  attackActions = [],
  onAction,
  onClose,
}: CardPreviewPanelProps) {
  const { play, other } = groupActions(actions);
  const imageSrc = useCardImageLarge(definition);

  return (
    <aside className="card-preview">
      <button type="button" className="card-preview__close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <div className="card-preview__layout">
        <img src={imageSrc} alt={definition.name} className="card-preview__image" />

        <div className="card-preview__details">
          <span className="card-preview__type">
            {definition.supertype}
            {definition.subtypes[0] ? ` · ${definition.subtypes[0]}` : ""}
          </span>
          <h3>{definition.name}</h3>

          {definition.supertype === "Trainer" && (
            <div className="card-preview__trainer">
              <span className="card-preview__badge">{getTrainerCategory(definition)}</span>
              <p>{getTrainerHint(definition)}</p>
              {isSupporter(definition) && (
                <p className="card-preview__note">Only one Supporter card per turn.</p>
              )}
            </div>
          )}

          {definition.supertype === "Energy" && (
            <p className="card-preview__note">Attach to one of your Pokémon in play (1 Energy per turn).</p>
          )}

          {isBasicPokemon(definition) && (
            <p className="card-preview__note">Basic Pokémon can go to Active or Bench.</p>
          )}

          {definition.supertype === "Pokémon" && !isBasicPokemon(definition) && (
            <p className="card-preview__note">Evolution — select this card, then click the Pokémon to evolve.</p>
          )}

          {definition.supertype === "Pokémon" && definition.abilities && definition.abilities.length > 0 && (
            <div className="card-preview__section">
              <h4>Abilities</h4>
              {definition.abilities.map((ability) => (
                <div key={ability.name} className="card-preview__ability">
                  <strong>{ability.name}</strong>
                  <p>{ability.text}</p>
                  <span className="card-preview__note">{summarizeAbility(parseAbilityText(ability))}</span>
                </div>
              ))}
            </div>
          )}

          {definition.supertype === "Pokémon" && definition.attacks && definition.attacks.length > 0 && (
            <div className="card-preview__section">
              <h4>Attack effects</h4>
              {definition.attacks.map((attack) => {
                const summary = getAttackEffectSummary(attack);
                return (
                  <p key={attack.name} className="card-preview__note">
                    <strong>{attack.name}</strong>
                    {summary ? `: ${summary}` : attack.text ? `: ${attack.text}` : ""}
                  </p>
                );
              })}
            </div>
          )}

          {definition.attacks && definition.attacks.length > 0 && attackActions.length > 0 && (
            <div className="card-preview__attacks">
              <h4>Attacks</h4>
              {attackActions.map((entry) => (
                <button
                  key={entry.action.type === "ATTACK" ? entry.action.attackName : entry.label}
                  type="button"
                  className="card-preview__attack-btn"
                  onClick={() => onAction(entry.action)}
                >
                  <strong>{entry.label.split(" · ")[0]}</strong>
                  <span>{entry.label.split(" · ").slice(1).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}

          {play.length > 0 && (
            <div className="card-preview__section">
              <h4>Play</h4>
              {play.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  className="card-preview__action card-preview__action--primary"
                  onClick={() => onAction(entry.action)}
                >
                  {definition.supertype === "Trainer"
                    ? `Play ${getTrainerCategory(definition)}`
                    : entry.label}
                </button>
              ))}
            </div>
          )}

          {other.length > 0 && (
            <div className="card-preview__section">
              <h4>Other actions</h4>
              {other.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  className="card-preview__action"
                  onClick={() => onAction(entry.action)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          {play.length === 0 && other.length === 0 && attackActions.length === 0 && (
            <p className="card-preview__note">No actions available for this card right now.</p>
          )}
        </div>
      </div>
    </aside>
  );
}

export function buildAttackActions(
  _card: CardInstance,
  definition: CardDefinition,
  legalActions: GameAction[],
): CardAction[] {
  if (definition.supertype !== "Pokémon" || !definition.attacks) return [];

  return definition.attacks
    .map((attack) => {
      const legalAttack = legalActions.find(
        (entry) => entry.type === "ATTACK" && entry.attackName === attack.name,
      );
      if (!legalAttack) return null;
      return {
        label: `${attack.name} · ${attack.damage || "0"} · ${formatAttackCost(attack.cost)}`,
        action: legalAttack,
      };
    })
    .filter(Boolean) as CardAction[];
}
