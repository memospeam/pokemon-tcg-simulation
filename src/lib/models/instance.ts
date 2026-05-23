import type { PlayerId, Zone } from "./enums";

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: PlayerId;
  zone: Zone;
  attachedEnergy: CardInstance[];
  attachedTools: CardInstance[];
  damageCounters: number;
  statusConditions: string[];
  /** Turn number when this Pokémon entered play (for evolve / Rare Candy rules). */
  enteredPlayTurn?: number;
  /** Set on attack; blocks this Pokémon on the owner's next turn. */
  cantAttackNextOwnerTurn?: "pending" | "active";
  /** Set on the Defending Pokémon; blocks retreat on that player's next turn. */
  cantRetreatNextOpponentTurn?: "pending" | "active";
  /** Applied during the opponent's next turn (after pending → active). */
  damageReductionNextOpponentTurn?: number;
  damageReductionPending?: number;
  /** Prevents damage and attack effects during the opponent's next turn. */
  preventDamageEffectsNextOpponentTurn?: "pending" | "active";
  /** Prevents damage from Basic non-Colorless attackers during opponent's next turn. */
  preventDamageFromBasicNonColorless?: "pending" | "active";
  /** Opponent chose an attack this Pokémon can't use during the owner's next turn. */
  blockedAttackNextOpponentTurn?: { name: string; phase: "pending" | "active" };
  /** No Weakness during the opponent's next turn. */
  noWeaknessNextOpponentTurn?: "pending" | "active";
}

export function createInstanceId(): string {
  return crypto.randomUUID();
}

export function createCardInstance(
  definitionId: string,
  ownerId: PlayerId,
  zone: Zone,
): CardInstance {
  return {
    instanceId: createInstanceId(),
    definitionId,
    ownerId,
    zone,
    attachedEnergy: [],
    attachedTools: [],
    damageCounters: 0,
    statusConditions: [],
  };
}
