import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone, GamePhase } from "../../models/enums";
import { createCardInstance } from "../../models/instance";
import type { EngineState } from "../types";
import { emptyTurnFlags } from "../types";
import { getPlayer } from "../types";
import {
  devolveOwnTypedPokemon,
  devolveOwnTypedPokemonById,
  devolvePokemonOneStage,
  listDevolveEligibleTyped,
  resolveDevolveOwnTypedById,
  startDevolveOwnTypedFlow,
} from "./devolutionEffects";
import { getStadiumKind } from "./stadiumEffects";

function mockPokemon(
  name: string,
  opts: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "120",
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
    ...opts,
  };
}

function mockStadium(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Stadium"],
    rules: [],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function stateWithStadium(stadiumName: string, defs: Record<string, CardDefinition>): EngineState {
  const stadiumDef = mockStadium(stadiumName);
  const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);
  return {
    phase: GamePhase.Active,
    turnNumber: 2,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [],
        hand: [],
        active: null,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: null,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium,
    stadiumOwnerId: PlayerId.P1,
    definitions: { stadium: stadiumDef, ...defs },
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
}

describe("devolutionEffects", () => {
  it("devolves Stage 2 to Stage 1 and sends evolution card to hand", () => {
    const dreepy = mockPokemon("Dreepy");
    const drakloak = mockPokemon("Drakloak", { subtypes: ["Stage 1"], evolvesFrom: "Dreepy" });
    const dragapult = mockPokemon("Dragapult", { subtypes: ["Stage 2"], evolvesFrom: "Drakloak" });
    const state = stateWithStadium("Lively Stadium", { dreepy, drakloak, dragapult });
    const active = createCardInstance("dragapult", PlayerId.P1, Zone.Active);
    active.damageCounters = 30;
    active.statusConditions = ["Burned"];
    getPlayer(state, PlayerId.P1).active = active;

    expect(devolvePokemonOneStage(state, PlayerId.P1, active, "hand")).toBe(true);
    expect(getPlayer(state, PlayerId.P1).active?.definitionId).toBe("drakloak");
    expect(getPlayer(state, PlayerId.P1).active?.damageCounters).toBe(30);
    expect(getPlayer(state, PlayerId.P1).active?.statusConditions).toEqual([]);
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).hand[0]?.definitionId).toBe("dragapult");
  });

  it("keeps Confused on devolve under Dizzying Valley", () => {
    const dreepy = mockPokemon("Dreepy");
    const drakloak = mockPokemon("Drakloak", { subtypes: ["Stage 1"], evolvesFrom: "Dreepy" });
    const state = stateWithStadium("Dizzying Valley", { dreepy, drakloak });
    expect(getStadiumKind(state)).toBe("dizzying_valley");
    const active = createCardInstance("drakloak", PlayerId.P1, Zone.Active);
    active.statusConditions = ["Confused", "Burned"];
    getPlayer(state, PlayerId.P1).active = active;

    expect(devolvePokemonOneStage(state, PlayerId.P1, active, "hand")).toBe(true);
    expect(getPlayer(state, PlayerId.P1).active?.definitionId).toBe("dreepy");
    expect(getPlayer(state, PlayerId.P1).active?.statusConditions).toEqual(["Confused"]);
  });

  it("devolves typed Pokémon for Strange Timepiece-style effects", () => {
    const abra = mockPokemon("Abra", { types: ["Psychic"] });
    const kadabra = mockPokemon("Kadabra", {
      subtypes: ["Stage 1"],
      evolvesFrom: "Abra",
      types: ["Psychic"],
    });
    const state = stateWithStadium("Lively Stadium", { abra, kadabra });
    getPlayer(state, PlayerId.P1).active = createCardInstance("kadabra", PlayerId.P1, Zone.Active);

    expect(devolveOwnTypedPokemon(state, PlayerId.P1, "Psychic", { untilBasic: false })).toBe(true);
    expect(getPlayer(state, PlayerId.P1).active?.definitionId).toBe("abra");
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
  });

  it("devolves through all stages to Basic for Strange Timepiece", () => {
    const abra = mockPokemon("Abra", { types: ["Psychic"] });
    const kadabra = mockPokemon("Kadabra", {
      subtypes: ["Stage 1"],
      evolvesFrom: "Abra",
      types: ["Psychic"],
    });
    const alakazam = mockPokemon("Alakazam", {
      subtypes: ["Stage 2"],
      evolvesFrom: "Kadabra",
      types: ["Psychic"],
    });
    const state = stateWithStadium("Lively Stadium", { abra, kadabra, alakazam });
    state.turnNumber = 4;
    getPlayer(state, PlayerId.P1).active = createCardInstance("alakazam", PlayerId.P1, Zone.Active);

    expect(devolveOwnTypedPokemon(state, PlayerId.P1, "Psychic")).toBe(true);
    const active = getPlayer(state, PlayerId.P1).active;
    expect(active?.definitionId).toBe("abra");
    expect(active?.enteredPlayTurn).toBe(4);
    expect(getPlayer(state, PlayerId.P1).hand.map((card) => card.definitionId).sort()).toEqual([
      "alakazam",
      "kadabra",
    ]);
  });

  it("opens pending when multiple evolved Psychic Pokémon are eligible", () => {
    const abra = mockPokemon("Abra", { types: ["Psychic"] });
    const kadabra = mockPokemon("Kadabra", {
      subtypes: ["Stage 1"],
      evolvesFrom: "Abra",
      types: ["Psychic"],
    });
    const drowzee = mockPokemon("Drowzee", { types: ["Psychic"] });
    const hypno = mockPokemon("Hypno", {
      subtypes: ["Stage 1"],
      evolvesFrom: "Drowzee",
      types: ["Psychic"],
    });
    const state = stateWithStadium("Lively Stadium", { abra, kadabra, drowzee, hypno });
    getPlayer(state, PlayerId.P1).active = createCardInstance("kadabra", PlayerId.P1, Zone.Active);
    getPlayer(state, PlayerId.P1).bench = [createCardInstance("hypno", PlayerId.P1, Zone.Bench)];

    expect(listDevolveEligibleTyped(state, PlayerId.P1, "Psychic")).toHaveLength(2);
    startDevolveOwnTypedFlow(state, PlayerId.P1, "Psychic");
    expect(state.pendingAction?.type).toBe("STRANGE_TIMEPIECE");

    resolveDevolveOwnTypedById(state, PlayerId.P1, getPlayer(state, PlayerId.P1).bench[0]!.instanceId);
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).bench[0]?.definitionId).toBe("drowzee");
  });
});
