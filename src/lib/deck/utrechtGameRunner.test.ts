import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { runEngineAutoPlay } from "./utrechtGameRunner";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Colorless"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    types,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mirrorMatchState(): EngineState {
  const p1Attack = mockBasic("Attacker A", "60", ["Colorless"], [
    { name: "Strike", cost: ["Colorless"], convertedEnergyCost: 1, damage: "60", text: "" },
  ]);
  const p2Attack = mockBasic("Attacker B", "60", ["Colorless"], [
    { name: "Strike", cost: ["Colorless"], convertedEnergyCost: 1, damage: "60", text: "" },
  ]);
  const energy = mockEnergy("Colorless Energy", ["Colorless"]);
  const p1Active = createCardInstance("p1-active", PlayerId.P1, Zone.Active);
  const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
  const p1Energy = createCardInstance("p1-energy", PlayerId.P1, Zone.Active);
  const p2Energy = createCardInstance("p2-energy", PlayerId.P2, Zone.Active);
  p1Active.attachedEnergy = [p1Energy];
  p2Active.attachedEnergy = [p2Energy];

  return {
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
        active: p1Active,
        bench: [],
        prizes: Array.from({ length: 1 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: p2Active,
        bench: [],
        prizes: Array.from({ length: 1 }, (_, i) => createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      "p1-active": p1Attack,
      "p2-active": p2Attack,
      "p1-energy": energy,
      "p2-energy": energy,
    },
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 42,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: null,
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("utrechtGameRunner", () => {
  it("runs alternating attacks until a winner is declared", () => {
    const result = runEngineAutoPlay(mirrorMatchState(), { maxTurns: 20, maxActions: 80 });
    expect(result.stalled).toBe(false);
    expect(result.winnerId).not.toBeNull();
    expect(result.state.phase).toBe(GamePhase.Finished);
    expect(result.actionCount).toBeGreaterThan(0);
  });

  it("reports stall when an attack needs manual target selection", () => {
    const base = mirrorMatchState();
    const greninjaDef = mockBasic("Greninja ex", "330", ["Water"], [
      {
        name: "Mirage Barrage",
        cost: [],
        convertedEnergyCost: 0,
        damage: "",
        text: "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ]);
    const water = mockEnergy("Water Energy", ["Water"]);
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const energies = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(`energy-${index}`, PlayerId.P1, Zone.Active),
    );
    greninja.attachedEnergy = energies;
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const bench = Array.from({ length: 2 }, (_, index) =>
      createCardInstance(`p2-bench-${index}`, PlayerId.P2, Zone.Bench),
    );

    const state: EngineState = {
      ...base,
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: greninja,
          prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: p2Active,
          bench,
        },
      },
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        "p2-active": mockBasic("Defender", "330", ["Lightning"]),
        "p2-bench-0": mockBasic("Bench A", "200", ["Colorless"]),
        "p2-bench-1": mockBasic("Bench B", "200", ["Colorless"]),
        ...Object.fromEntries(energies.map((card) => [card.definitionId, water])),
      },
    };

    const result = runEngineAutoPlay(state, { maxTurns: 5, maxActions: 10 });
    expect(result.stalled).toBe(true);
    expect(result.state.pendingAction?.type).toBe("DAMAGE_TWO_OPPONENT");
    expect(getPlayer(result.state, PlayerId.P1).active!.attachedEnergy).toHaveLength(2);
  });
});
