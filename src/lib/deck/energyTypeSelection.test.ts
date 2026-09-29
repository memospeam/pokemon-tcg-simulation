import { describe, expect, it } from "vitest";
import { pickBestEnergyForTarget, pickBestEnergyTarget } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { emptyTurnFlags, type EngineState } from "../engine/types";
import type { CardDefinition } from "../models/definition";

function mockPokemon(
  name: string,
  attacks: { name: string; cost: string[]; convertedEnergyCost: number; damage: string }[],
  types: string[],
  retreatCost: string[] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "100",
    types,
    abilities: [],
    attacks: attacks.map((a) => ({ ...a, text: "" })),
    retreatCost,
    set: { id: "t", name: "t" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(type: string): CardDefinition {
  return {
    apiId: `${type}-energy`,
    name: `${type} Energy`,
    supertype: "Energy",
    subtypes: ["Basic"],
    types: [type],
    set: { id: "t", name: "t" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function buildState(defs: Record<string, CardDefinition>, target: ReturnType<typeof createCardInstance>, hand: ReturnType<typeof createCardInstance>[]): EngineState {
  const p2Active = createCardInstance("opp", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand, active: target, bench: [], prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: p2Active, bench: [], prizes: [], discard: [], lostZone: [] },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: { ...defs, opp: mockPokemon("Opp", [], []) },
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

describe("pickBestEnergyForTarget — choose energy by attack-cost shortfall", () => {
  it("Dragapult ex (1 Psychic attached) picks Fire over another Psychic for Phantom Dive", () => {
    // Real bug: AI used to keep attaching Psychic because Dragapult's TYPE is Psychic,
    // so Phantom Dive (Fire + Psychic) would never come online.
    const dragapultDef = mockPokemon(
      "Dragapult ex",
      [
        { name: "Jet Headbutt", cost: ["Colorless"], convertedEnergyCost: 1, damage: "70" },
        { name: "Phantom Dive", cost: ["Fire", "Psychic"], convertedEnergyCost: 2, damage: "200" },
      ],
      ["Psychic"],
    );
    const dragapult = createCardInstance("Dragapult ex", PlayerId.P1, Zone.Active);
    // One Psychic already attached.
    dragapult.attachedEnergy = [createCardInstance("Psychic-energy", PlayerId.P1, Zone.Active)];

    const psyInHand = createCardInstance("Psychic-energy", PlayerId.P1, Zone.Hand);
    const fireInHand = createCardInstance("Fire-energy", PlayerId.P1, Zone.Hand);

    const state = buildState(
      { "Dragapult ex": dragapultDef, "Psychic-energy": mockEnergy("Psychic"), "Fire-energy": mockEnergy("Fire") },
      dragapult,
      [psyInHand, fireInHand],
    );

    const picked = pickBestEnergyForTarget(state, [psyInHand, fireInHand], dragapult);
    expect(picked?.definitionId).toBe("Fire-energy");
  });

  it("Dragapult ex with 0 energy picks Psychic or Fire (either fills a Phantom Dive slot)", () => {
    const dragapultDef = mockPokemon(
      "Dragapult ex",
      [{ name: "Phantom Dive", cost: ["Fire", "Psychic"], convertedEnergyCost: 2, damage: "200" }],
      ["Psychic"],
    );
    const dragapult = createCardInstance("Dragapult ex", PlayerId.P1, Zone.Active);

    const psyInHand = createCardInstance("Psychic-energy", PlayerId.P1, Zone.Hand);
    const fireInHand = createCardInstance("Fire-energy", PlayerId.P1, Zone.Hand);
    const grassInHand = createCardInstance("Grass-energy", PlayerId.P1, Zone.Hand);

    const state = buildState(
      {
        "Dragapult ex": dragapultDef,
        "Psychic-energy": mockEnergy("Psychic"),
        "Fire-energy": mockEnergy("Fire"),
        "Grass-energy": mockEnergy("Grass"),
      },
      dragapult,
      [psyInHand, fireInHand, grassInHand],
    );

    const picked = pickBestEnergyForTarget(state, [psyInHand, fireInHand, grassInHand], dragapult);
    // Must pick Fire or Psychic — both fill an unmet attack cost slot.
    // Must NOT pick Grass — wrong type entirely.
    expect(picked?.definitionId).not.toBe("Grass-energy");
    expect(["Fire-energy", "Psychic-energy"]).toContain(picked?.definitionId);
  });

  it("Colorless-cost attack (Mega Lopunny Gale Thrust) accepts any energy", () => {
    const lopunnyDef = mockPokemon(
      "Mega Lopunny ex",
      [{ name: "Gale Thrust", cost: ["Colorless"], convertedEnergyCost: 1, damage: "60+" }],
      ["Colorless"],
    );
    const lopunny = createCardInstance("Mega Lopunny ex", PlayerId.P1, Zone.Active);

    const psyInHand = createCardInstance("Psychic-energy", PlayerId.P1, Zone.Hand);
    const fireInHand = createCardInstance("Fire-energy", PlayerId.P1, Zone.Hand);

    const state = buildState(
      { "Mega Lopunny ex": lopunnyDef, "Psychic-energy": mockEnergy("Psychic"), "Fire-energy": mockEnergy("Fire") },
      lopunny,
      [psyInHand, fireInHand],
    );

    const picked = pickBestEnergyForTarget(state, [psyInHand, fireInHand], lopunny);
    // Any energy is valid for a Colorless slot — should not error and should return something.
    expect(picked).not.toBeNull();
  });

  it("returns single card if hand only has one energy", () => {
    const anyDef = mockPokemon("X", [{ name: "Hit", cost: ["Water"], convertedEnergyCost: 1, damage: "10" }], ["Water"]);
    const target = createCardInstance("X", PlayerId.P1, Zone.Active);
    const onlyOne = createCardInstance("Water-energy", PlayerId.P1, Zone.Hand);

    const state = buildState(
      { X: anyDef, "Water-energy": mockEnergy("Water") },
      target,
      [onlyOne],
    );

    const picked = pickBestEnergyForTarget(state, [onlyOne], target);
    expect(picked).toBe(onlyOne);
  });

  it("holds an off-color Energy that does not pay an attack or a retreat", () => {
    const attacker = mockPokemon(
      "Attacker",
      [{ name: "Hit", cost: ["Fire"], convertedEnergyCost: 1, damage: "30" }],
      ["Fire"],
    );
    const target = createCardInstance("Attacker", PlayerId.P1, Zone.Active);
    const grass = createCardInstance("Grass-energy", PlayerId.P1, Zone.Hand);
    const state = buildState(
      { Attacker: attacker, "Grass-energy": mockEnergy("Grass") },
      target,
      [grass],
    );

    expect(pickBestEnergyForTarget(state, [grass], target)).toBeNull();
  });

  it("attaches off-color Energy only when the Pokémon still cannot retreat", () => {
    const attacker = mockPokemon(
      "Attacker",
      [{ name: "Hit", cost: ["Fire"], convertedEnergyCost: 1, damage: "30" }],
      ["Fire"],
      ["Colorless"],
    );
    const target = createCardInstance("Attacker", PlayerId.P1, Zone.Active);
    const grass = createCardInstance("Grass-energy", PlayerId.P1, Zone.Hand);
    const state = buildState(
      { Attacker: attacker, "Grass-energy": mockEnergy("Grass") },
      target,
      [grass],
    );

    expect(pickBestEnergyForTarget(state, [grass], target)?.definitionId).toBe("Grass-energy");
  });

  it("prefers the attack's color over an off-color Energy that could also pay retreat", () => {
    const attacker = mockPokemon(
      "Attacker",
      [{ name: "Hit", cost: ["Fire"], convertedEnergyCost: 1, damage: "30" }],
      ["Fire"],
      ["Colorless"],
    );
    const target = createCardInstance("Attacker", PlayerId.P1, Zone.Active);
    const fire = createCardInstance("Fire-energy", PlayerId.P1, Zone.Hand);
    const grass = createCardInstance("Grass-energy", PlayerId.P1, Zone.Hand);
    const state = buildState(
      { Attacker: attacker, "Fire-energy": mockEnergy("Fire"), "Grass-energy": mockEnergy("Grass") },
      target,
      [fire, grass],
    );

    expect(pickBestEnergyForTarget(state, [fire, grass], target)?.definitionId).toBe("Fire-energy");
  });

  it("loads the deck attacker with its attack color before a bench Pokémon", () => {
    const dragapult = mockPokemon(
      "Dragapult ex",
      [{ name: "Phantom Dive", cost: ["Fire", "Psychic"], convertedEnergyCost: 2, damage: "200" }],
      ["Psychic"],
    );
    const dreepy = mockPokemon(
      "Dreepy",
      [{ name: "Headbutt", cost: ["Psychic"], convertedEnergyCost: 1, damage: "10" }],
      ["Psychic"],
    );
    const active = createCardInstance("Dreepy", PlayerId.P1, Zone.Active);
    const bench = createCardInstance("Dragapult ex", PlayerId.P1, Zone.Bench);
    const psychic = createCardInstance("Psychic-energy", PlayerId.P1, Zone.Hand);
    const state = buildState(
      {
        "Dragapult ex": dragapult,
        Dreepy: dreepy,
        "Psychic-energy": mockEnergy("Psychic"),
      },
      active,
      [psychic],
    );
    state.players[PlayerId.P1].bench = [bench];
    const ctx = buildStrategyContext(["Dragapult ex", "Dreepy", "Drakloak"]);

    expect(pickBestEnergyTarget(state, PlayerId.P1, ctx)).toBe(bench.instanceId);
    expect(pickBestEnergyForTarget(state, [psychic], bench)?.definitionId).toBe("Psychic-energy");
  });

  it("does not put an off-color Energy on the deck attacker when retreat is already paid", () => {
    const dragapult = mockPokemon(
      "Dragapult ex",
      [{ name: "Phantom Dive", cost: ["Psychic"], convertedEnergyCost: 1, damage: "200" }],
      ["Psychic"],
    );
    const munkidori = mockPokemon(
      "Munkidori",
      [{ name: "Adrena-Brain", cost: ["Darkness"], convertedEnergyCost: 1, damage: "0" }],
      ["Darkness"],
    );
    const active = createCardInstance("Dragapult ex", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [createCardInstance("Psychic-energy", PlayerId.P1, Zone.Active)];
    const bench = createCardInstance("Munkidori", PlayerId.P1, Zone.Bench);
    const darkness = createCardInstance("Darkness-energy", PlayerId.P1, Zone.Hand);
    const state = buildState(
      {
        "Dragapult ex": dragapult,
        Munkidori: munkidori,
        "Psychic-energy": mockEnergy("Psychic"),
        "Darkness-energy": mockEnergy("Darkness"),
      },
      active,
      [darkness],
    );
    state.players[PlayerId.P1].bench = [bench];
    const ctx = buildStrategyContext(["Dragapult ex", "Dreepy", "Munkidori"]);

    expect(pickBestEnergyTarget(state, PlayerId.P1, ctx)).toBeNull();
    expect(pickBestEnergyForTarget(state, [darkness], active)).toBeNull();
  });

  it("returns null when hand has no energies", () => {
    const def = mockPokemon("X", [{ name: "Hit", cost: ["Water"], convertedEnergyCost: 1, damage: "10" }], ["Water"]);
    const target = createCardInstance("X", PlayerId.P1, Zone.Active);
    const state = buildState({ X: def }, target, []);

    expect(pickBestEnergyForTarget(state, [], target)).toBeNull();
  });
});
