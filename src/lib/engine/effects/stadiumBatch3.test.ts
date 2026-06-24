import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone, GamePhase } from "../../models/enums";
import type { CardInstance } from "../../models/instance";
import { createCardInstance } from "../../models/instance";
import {
  areToolEffectsDisabled,
  getStadiumAttackBonus,
  getStadiumDamageReduction,
  getStadiumHpModifier,
  getStadiumKind,
  getStadiumRetreatReduction,
} from "./stadiumEffects";
import { getToolKind } from "./toolEffects";
import type { EngineState } from "../types";
import { emptyTurnFlags } from "../types";

function mockStadium(name: string): CardDefinition {
  // Batch 3 stadiums are classified by name (no rules text needed).
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

function mockPokemon(name: string, opts: Partial<CardDefinition> = {}): CardDefinition {
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
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active: null, bench: [], prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: null, bench: [], prizes: [], discard: [], lostZone: [] },
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

function inst(defId: string): CardInstance {
  const c = createCardInstance(defId, PlayerId.P1, Zone.Active);
  c.attachedTools = [];
  return c;
}

describe("Batch 3 stadiums (passives)", () => {
  it("classifies name-matched stadiums", () => {
    expect(getStadiumKind(stateWithStadium("Lively Stadium", {}))).toBe("lively_stadium");
    expect(getStadiumKind(stateWithStadium("Jamming Tower", {}))).toBe("jamming_tower");
    expect(getStadiumKind(stateWithStadium("Prism Tower", {}))).toBe("prism_tower");
  });

  it("Lively Stadium gives Basics +30 HP, not evolutions", () => {
    const state = stateWithStadium("Lively Stadium", {
      basic: mockPokemon("Pikachu"),
      stage2: mockPokemon("Charizard", { subtypes: ["Stage 2"] }),
    });
    expect(getStadiumHpModifier(state, inst("basic"))).toBe(30);
    expect(getStadiumHpModifier(state, inst("stage2"))).toBe(0);
  });

  it("Full Metal Lab reduces damage to Metal Pokémon by 30", () => {
    const state = stateWithStadium("Full Metal Lab", {
      metal: mockPokemon("Metagross", { types: ["Metal"] }),
      fire: mockPokemon("Charmander", { types: ["Fire"] }),
    });
    expect(getStadiumDamageReduction(state, inst("metal"))).toBe(30);
    expect(getStadiumDamageReduction(state, inst("fire"))).toBe(0);
  });

  it("Postwick adds +30 to Hop's attackers only", () => {
    const state = stateWithStadium("Postwick", {
      hops: mockPokemon("Hop's Zacian ex"),
      other: mockPokemon("Pikachu"),
    });
    expect(getStadiumAttackBonus(state, inst("hops"))).toBe(30);
    expect(getStadiumAttackBonus(state, inst("other"))).toBe(0);
  });

  it("Paradise Resort cuts each Psyduck's retreat by 1", () => {
    const state = stateWithStadium("Paradise Resort", {
      psyduck: mockPokemon("Psyduck"),
      other: mockPokemon("Pikachu"),
    });
    expect(getStadiumRetreatReduction(state, inst("psyduck"))).toBe(1);
    expect(getStadiumRetreatReduction(state, inst("other"))).toBe(0);
  });

  it("Jamming Tower disables all Tool effects", () => {
    const state = stateWithStadium("Jamming Tower", {
      balloon: { ...mockPokemon("Air Balloon"), supertype: "Trainer", subtypes: ["Tool"] } as CardDefinition,
    });
    expect(areToolEffectsDisabled(state)).toBe(true);
    expect(getToolKind(state, inst("balloon"))).toBe("unknown");
  });
});
