import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone, GamePhase } from "../../models/enums";
import type { CardInstance } from "../../models/instance";
import { createCardInstance } from "../../models/instance";
import {
  areToolEffectsDisabled,
  canPlayAngeFloetteStadium,
  getStadiumAttackBonus,
  getStadiumDamageReduction,
  getStadiumHpModifier,
  getStadiumKind,
  getStadiumRetreatReduction,
  getStatusConditionsAfterEvolution,
} from "./stadiumEffects";
import { transferPokemonStateOntoEvolution } from "./toolEffects";
import {
  canUsePrismTower,
  continuePrismTowerPick,
  startPrismTower,
} from "./stadiumOptionalEffects";
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

  it("Dizzying Valley keeps Confused on evolution but clears other conditions", () => {
    const state = stateWithStadium("Dizzying Valley", {
      basic: mockPokemon("Abra", { types: ["Psychic"] }),
    });
    const from = inst("basic");
    from.statusConditions = ["Confused", "Burned"];
    const to = createCardInstance("evo", PlayerId.P1, Zone.Active);
    transferPokemonStateOntoEvolution(state, from, to, PlayerId.P1);
    expect(to.statusConditions).toEqual(["Confused"]);
    expect(getStatusConditionsAfterEvolution(state, from)).toEqual(["Confused"]);

    from.statusConditions = ["Burned"];
    expect(getStatusConditionsAfterEvolution(state, from)).toEqual([]);
  });

  it("Ange Floette gives Mega Floette ex +150 HP", () => {
    const state = stateWithStadium("Ange Floette", {
      floette: mockPokemon("Mega Floette ex"),
      other: mockPokemon("Pikachu"),
    });
    expect(getStadiumHpModifier(state, inst("floette"))).toBe(150);
    expect(getStadiumHpModifier(state, inst("other"))).toBe(0);
  });

  it("Ange Floette requires Prism Tower in play", () => {
    const noStadium = stateWithStadium("Lively Stadium", {});
    noStadium.stadium = null;
    expect(canPlayAngeFloetteStadium(noStadium).ok).toBe(false);

    const withPrism = stateWithStadium("Prism Tower", {});
    expect(canPlayAngeFloetteStadium(withPrism).ok).toBe(true);
  });

  it("classifies batch-3 stadium names", () => {
    expect(getStadiumKind(stateWithStadium("Mystery Garden", {}))).toBe("mystery_garden");
    expect(getStadiumKind(stateWithStadium("Dizzying Valley", {}))).toBe("dizzying_valley");
    expect(getStadiumKind(stateWithStadium("Ange Floette", {}))).toBe("ange_floette");
    expect(getStadiumKind(stateWithStadium("Nighttime Mine", {}))).toBe("nighttime_mine");
    expect(getStadiumKind(stateWithStadium("Perilous Jungle", {}))).toBe("perilous_jungle");
  });

  it("Prism Tower discards 2 hand cards then draws 1", () => {
    const state = stateWithStadium("Prism Tower", {
      c1: mockPokemon("Card 1"),
      c2: mockPokemon("Card 2"),
      c3: mockPokemon("Card 3"),
      deck1: mockPokemon("Deck 1"),
    });
    const player = state.players[PlayerId.P1];
    player.hand = [
      createCardInstance("c1", PlayerId.P1, Zone.Hand),
      createCardInstance("c2", PlayerId.P1, Zone.Hand),
      createCardInstance("c3", PlayerId.P1, Zone.Hand),
    ];
    player.deck = [createCardInstance("deck1", PlayerId.P1, Zone.Deck)];
    expect(canUsePrismTower(state, PlayerId.P1)).toBe(true);
    startPrismTower(state, PlayerId.P1);
    continuePrismTowerPick(state, PlayerId.P1, player.hand[0]!.instanceId);
    continuePrismTowerPick(state, PlayerId.P1, player.hand[0]!.instanceId);
    expect(player.hand).toHaveLength(2);
    expect(player.discard).toHaveLength(2);
    expect(state.turnFlags.stadiumOncePerTurnUsed).toBe(true);
    expect(state.pendingAction).toBeNull();
  });
});
