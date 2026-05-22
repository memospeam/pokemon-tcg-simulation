import type { CardDefinition } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import type { EngineState, GameAction } from "@/lib/engine";
import { getDefinition, getPlayer } from "@/lib/engine";
import { Zone } from "@/lib/models/enums";
import { formatAttackCost } from "@/lib/engine/energy";
import { getTrainerCategory, getTrainerHint } from "@/lib/ui/trainerHints";

export interface CardAction {
  label: string;
  action: GameAction;
}

interface CardActionMenuProps {
  definition: CardDefinition;
  actions: CardAction[];
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

export function CardActionMenu({ definition, actions, onAction, onClose }: CardActionMenuProps) {
  if (actions.length === 0) return null;

  return (
    <div className="action-menu">
      <div className="action-menu__header">
        <strong>{definition.name}</strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="action-menu__buttons">
        {actions.map((entry) => (
          <button
            key={`${entry.label}-${JSON.stringify(entry.action)}`}
            type="button"
            onClick={() => {
              onAction(entry.action);
              onClose();
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function buildHandActions(
  card: CardInstance,
  definition: CardDefinition,
  legalActions: GameAction[],
  game?: EngineState,
): CardAction[] {
  const actions: CardAction[] = [];

  for (const legal of legalActions) {
    if ("instanceId" in legal && legal.instanceId === card.instanceId) {
      if (legal.type === "PLACE_ACTIVE") {
        actions.push({ label: "Place as Active Pokémon", action: legal });
      }
      if (legal.type === "PLACE_BENCH" || legal.type === "PLAY_BASIC_TO_BENCH") {
        actions.push({ label: "Place on Bench", action: legal });
      }
      if (legal.type === "PLAY_TRAINER") {
        const hint = getTrainerHint(definition);
        actions.push({
          label: `Play ${getTrainerCategory(definition)} — ${hint}`,
          action: legal,
        });
      }
    }

    if (legal.type === "EVOLVE" && legal.evolutionId === card.instanceId) {
      actions.push({ label: "Evolve (select target Pokémon next)", action: legal });
    }

    if (
      legal.type === "ATTACH_ENERGY" &&
      legal.energyId === card.instanceId &&
      legal.targetId
    ) {
      actions.push({ label: "Attach to selected Pokémon", action: legal });
    }
  }

  if (definition.supertype === "Energy" && game) {
    const player = getPlayer(game, card.ownerId);
    const attachActions = legalActions.filter(
      (entry): entry is Extract<GameAction, { type: "ATTACH_ENERGY" }> =>
        entry.type === "ATTACH_ENERGY" &&
        entry.energyId === card.instanceId &&
        Boolean(entry.targetId),
    );
    for (const legal of attachActions) {
      const target =
        player.active?.instanceId === legal.targetId
          ? player.active
          : player.bench.find((entry) => entry.instanceId === legal.targetId);
      if (!target) continue;
      const targetDef = getDefinition(game, target.definitionId);
      const slot = player.active?.instanceId === legal.targetId ? "Active" : "Bench";
      actions.push({
        label: `Attach to ${targetDef?.name ?? "Pokémon"} (${slot})`,
        action: legal,
      });
    }
  }

  return actions;
}

export function buildPokemonActions(
  card: CardInstance,
  definition: CardDefinition,
  legalActions: GameAction[],
  game?: EngineState,
): CardAction[] {
  const actions: CardAction[] = [];

  for (const legal of legalActions) {
    if (legal.type === "ATTACH_ENERGY" && "targetId" in legal && legal.targetId === card.instanceId) {
      actions.push({ label: "Attach selected Energy here", action: legal });
    }
    if (legal.type === "EVOLVE" && "targetId" in legal && legal.targetId === card.instanceId) {
      actions.push({ label: "Evolve with selected card from hand", action: legal });
    }
    if (legal.type === "PROMOTE_BENCH" && legal.instanceId === card.instanceId) {
      actions.push({ label: "Promote to Active", action: legal });
    }
    if (legal.type === "SWITCH_OPPONENT_ACTIVE" && legal.benchInstanceId === card.instanceId) {
      actions.push({ label: "Switch into Active (Boss's Orders)", action: legal });
    }
    if (legal.type === "SWITCH_WITH_BENCH" && legal.benchInstanceId === card.instanceId) {
      actions.push({ label: "Switch with Active", action: legal });
    }
    if (legal.type === "MOVE_ENERGY_TO_BENCH" && legal.benchInstanceId === card.instanceId) {
      actions.push({ label: "Move Energy here", action: legal });
    }
    if (legal.type === "SELECT_RARE_CANDY_BASIC" && legal.targetId === card.instanceId) {
      actions.push({ label: "Evolve with Rare Candy", action: legal });
    }
    if (legal.type === "SELECT_CRISPIN_TARGET" && legal.pokemonId === card.instanceId) {
      actions.push({ label: "Attach searched Energy (Crispin)", action: legal });
    }
    if (legal.type === "DISCARD_OPPONENT_ENERGY" && legal.pokemonId === card.instanceId) {
      actions.push({ label: "Discard attached Energy (Crushing Hammer)", action: legal });
    }
    if (legal.type === "ASSIGN_BENCH_DAMAGE" && legal.targetId === card.instanceId) {
      actions.push({ label: "Place 1 damage counter here", action: legal });
    }
    if (legal.type === "CHOOSE_BENCH_DAMAGE_TARGET" && legal.targetId === card.instanceId) {
      actions.push({ label: "Damage this Benched Pokémon", action: legal });
    }
    if (legal.type === "MOVE_DAMAGE_SOURCE" && legal.sourceId === card.instanceId) {
      actions.push({ label: "Move damage from this Pokémon", action: legal });
    }
    if (legal.type === "MOVE_DAMAGE_TARGET" && legal.targetId === card.instanceId) {
      actions.push({ label: "Move damage to this Pokémon", action: legal });
    }
    if (legal.type === "USE_ABILITY" && legal.pokemonId === card.instanceId) {
      actions.push({ label: `Use ${legal.abilityName}`, action: legal });
    }
    if (legal.type === "RETREAT" && card.zone === Zone.Active) {
      const bench = game ? getPlayer(game, legal.playerId).bench.find((entry) => entry.instanceId === legal.benchInstanceId) : null;
      const benchName = bench ? getDefinition(game!, bench.definitionId)?.name : "Bench Pokémon";
      actions.push({ label: `Retreat → ${benchName}`, action: legal });
    }
  }

  if (definition.attacks?.length) {
    for (const attack of definition.attacks) {
      const legalAttack = legalActions.find(
        (entry) => entry.type === "ATTACK" && entry.attackName === attack.name,
      );
      if (legalAttack) {
        actions.push({
          label: `${attack.name} · ${attack.damage || "0"} · ${formatAttackCost(attack.cost)}`,
          action: legalAttack,
        });
      }
    }
  }

  return actions;
}
