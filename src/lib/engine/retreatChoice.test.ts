import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { drainAutoPending } from "../deck/metaGameRunner";
import { gameReducer, getLegalActions } from "./reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "./types";

function pokemon(id: string, retreatCost: string[]): CardDefinition {
  return {
    apiId: id,
    name: id,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "100",
    types: ["Colorless"],
    attacks: [{ name: "Hit", cost: ["Fire"], convertedEnergyCost: 1, damage: "30", text: "" }],
    retreatCost,
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function energy(id: string, type: string): CardDefinition {
  return {
    apiId: id,
    name: `${type} Energy`,
    supertype: "Energy",
    subtypes: ["Basic"],
    types: [type],
    set: { id: "t", name: "T" },
    number: "2",
    images: { small: "", large: "" },
  };
}

function board(retreatCost: string[], energyIds: string[]): EngineState {
  const active = createCardInstance("active", PlayerId.P1, Zone.Active);
  active.attachedEnergy = energyIds.map((id) => createCardInstance(id, PlayerId.P1, Zone.Active));
  const bench = createCardInstance("bench", PlayerId.P1, Zone.Bench);
  const definitions: Record<string, CardDefinition> = {
    active: pokemon("Active", retreatCost),
    bench: pokemon("Bench", []),
  };
  for (const id of energyIds) {
    const type = id.startsWith("fire") ? "Fire" : id.startsWith("water") ? "Water" : "Psychic";
    definitions[id] = energy(id, type);
  }
  const state: EngineState = {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [],
        hand: [],
        active,
        bench: [bench],
        prizes: [],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: createCardInstance("opp", PlayerId.P2, Zone.Active),
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: { ...definitions, opp: pokemon("Opp", []) },
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: null,
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
  return state;
}

function energyId(state: EngineState, definitionId: string): string {
  const match = getPlayer(state, PlayerId.P1).active?.attachedEnergy.find(
    (card) => card.definitionId === definitionId,
  );
  if (!match) throw new Error(`missing ${definitionId}`);
  return match.instanceId;
}

function retreat(state: EngineState): EngineState {
  const bench = getPlayer(state, PlayerId.P1).bench[0]!;
  return gameReducer(state, {
    type: "RETREAT",
    playerId: PlayerId.P1,
    benchInstanceId: bench.instanceId,
  });
}

describe("retreat energy choice", () => {
  it("asks which Energy to discard when more than one can pay", () => {
    const choosing = retreat(board(["Colorless"], ["fire", "water"]));
    expect(choosing.pendingAction?.type).toBe("RETREAT_ENERGY");
    expect(choosing.turnFlags.retreated).toBe(false);
    const player = getPlayer(choosing, PlayerId.P1);
    expect(player.active?.attachedEnergy.map((card) => card.definitionId).sort()).toEqual(["fire", "water"]);
    expect(player.discard).toHaveLength(0);
    if (choosing.pendingAction?.type !== "RETREAT_ENERGY") return;
    expect(choosing.pendingAction.options.sort()).toEqual(
      ["fire", "water"].map((id) => energyId(choosing, id)).sort(),
    );

    const paid = gameReducer(choosing, {
      type: "DISCARD_RETREAT_ENERGY",
      playerId: PlayerId.P1,
      energyId: energyId(choosing, "water"),
    });
    expect(paid.pendingAction).toBeNull();
    expect(paid.turnFlags.retreated).toBe(true);
    expect(getPlayer(paid, PlayerId.P1).active?.definitionId).toBe("bench");
    const outgoing = getPlayer(paid, PlayerId.P1).bench.find((card) => card.definitionId === "active");
    expect(outgoing?.attachedEnergy.map((card) => card.definitionId)).toEqual(["fire"]);
    expect(getPlayer(paid, PlayerId.P1).discard.map((card) => card.definitionId)).toEqual(["water"]);
  });

  it("cancels retreat and keeps every attached Energy", () => {
    const choosing = retreat(board(["Colorless"], ["fire", "water"]));
    const cancelled = gameReducer(choosing, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    expect(cancelled.pendingAction).toBeNull();
    expect(cancelled.turnFlags.retreated).toBe(false);
    expect(getPlayer(cancelled, PlayerId.P1).active?.definitionId).toBe("active");
    expect(getPlayer(cancelled, PlayerId.P1).active?.attachedEnergy.map((card) => card.definitionId).sort()).toEqual([
      "fire",
      "water",
    ]);
  });

  it("discards the only legal Energy without asking", () => {
    const next = retreat(board(["Fire"], ["fire", "water"]));
    expect(next.pendingAction).toBeNull();
    expect(next.turnFlags.retreated).toBe(true);
    const outgoing = getPlayer(next, PlayerId.P1).bench.find((card) => card.definitionId === "active");
    expect(outgoing?.attachedEnergy.map((card) => card.definitionId)).toEqual(["water"]);
    expect(getPlayer(next, PlayerId.P1).discard.map((card) => card.definitionId)).toEqual(["fire"]);
  });

  it("lets the player pay a cost of 2 one Energy at a time", () => {
    const choosing = retreat(board(["Colorless", "Colorless"], ["fire", "water", "psychic"]));
    expect(choosing.pendingAction?.type).toBe("RETREAT_ENERGY");
    if (choosing.pendingAction?.type !== "RETREAT_ENERGY") return;
    expect(choosing.pendingAction.remainingCost).toHaveLength(2);

    const once = gameReducer(choosing, {
      type: "DISCARD_RETREAT_ENERGY",
      playerId: PlayerId.P1,
      energyId: energyId(choosing, "psychic"),
    });
    expect(once.turnFlags.retreated).toBe(false);
    expect(once.pendingAction?.type).toBe("RETREAT_ENERGY");
    expect(getPlayer(once, PlayerId.P1).discard.map((card) => card.definitionId)).toEqual(["psychic"]);
    expect(getPlayer(once, PlayerId.P1).active?.attachedEnergy).toHaveLength(2);

    const paid = gameReducer(once, {
      type: "DISCARD_RETREAT_ENERGY",
      playerId: PlayerId.P1,
      energyId: energyId(once, "water"),
    });
    expect(paid.turnFlags.retreated).toBe(true);
    expect(paid.pendingAction).toBeNull();
    const outgoing = getPlayer(paid, PlayerId.P1).bench.find((card) => card.definitionId === "active");
    expect(outgoing?.attachedEnergy.map((card) => card.definitionId)).toEqual(["fire"]);
    expect(getPlayer(paid, PlayerId.P1).discard.map((card) => card.definitionId).sort()).toEqual(["psychic", "water"]);
  });

  it("returns an auto-paid Energy when retreat is cancelled", () => {
    const choosing = retreat(board(["Fire", "Colorless"], ["fire", "water", "psychic"]));
    expect(choosing.pendingAction?.type).toBe("RETREAT_ENERGY");
    if (choosing.pendingAction?.type !== "RETREAT_ENERGY") return;
    const discardedFire = getPlayer(choosing, PlayerId.P1).discard.find((card) => card.definitionId === "fire");
    expect(choosing.pendingAction.discardedIds).toEqual([discardedFire?.instanceId]);
    expect(
      choosing.pendingAction.options
        .map((id) => {
          const discarded = getPlayer(choosing, PlayerId.P1).discard.find((card) => card.instanceId === id);
          const attached = getPlayer(choosing, PlayerId.P1).active?.attachedEnergy.find((card) => card.instanceId === id);
          return (discarded ?? attached)?.definitionId;
        })
        .sort(),
    ).toEqual(["psychic", "water"]);

    const cancelled = gameReducer(choosing, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    expect(cancelled.turnFlags.retreated).toBe(false);
    expect(getPlayer(cancelled, PlayerId.P1).discard).toHaveLength(0);
    expect(getPlayer(cancelled, PlayerId.P1).active?.attachedEnergy.map((card) => card.definitionId).sort()).toEqual([
      "fire",
      "psychic",
      "water",
    ]);
  });

  it("offers each payable Energy as a legal action", () => {
    const choosing = retreat(board(["Colorless"], ["fire", "water"]));
    const types = getLegalActions(choosing).map((action) => action.type);
    expect(types.filter((type) => type === "DISCARD_RETREAT_ENERGY")).toHaveLength(2);
    expect(types).toContain("SKIP_OPTIONAL");
    expect(types).not.toContain("END_TURN");
  });

  it("lets the AI finish a retreat that needs an Energy choice", () => {
    const choosing = retreat(board(["Colorless"], ["fire", "water"]));
    const drained = drainAutoPending(choosing);
    expect(drained.state.pendingAction).toBeNull();
    expect(drained.state.turnFlags.retreated).toBe(true);
    expect(getPlayer(drained.state, PlayerId.P1).discard).toHaveLength(1);
    const outgoing = getPlayer(drained.state, PlayerId.P1).bench.find((card) => card.definitionId === "active");
    expect(outgoing?.attachedEnergy).toHaveLength(1);
  });
});
