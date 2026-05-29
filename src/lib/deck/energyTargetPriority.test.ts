import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickBestEnergyTarget } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockBasic(
  name: string,
  attacks: { name: string; cost: string[]; convertedEnergyCost: number; damage: string }[] = [],
  hp = "60",
  types: string[] = ["Psychic"],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    abilities: [],
    attacks,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name = "Psychic Energy", types = ["Psychic"]): CardDefinition {
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

function baseState(
  defs: Record<string, CardDefinition>,
  active: ReturnType<typeof createCardInstance>,
  bench: ReturnType<typeof createCardInstance>[],
  hand: ReturnType<typeof createCardInstance>[],
): EngineState {
  const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
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
        hand,
        active,
        bench,
        prizes: [],
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
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      ...defs,
      "p2-active": mockBasic("OpponentBasic"),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pickBestEnergyTarget — primary attacker priority", () => {
  it("loads bench primary attacker over active one-away setup Pokémon", () => {
    // Dragapult ex on the bench (no energy yet, needs 3 for Phantom Dive)
    // Dreepy active with 0 energy, one-away from its 1-energy attack
    // The deck wants Dragapult fueled even though Dreepy is closer to attacking.
    const dragapultDef = mockBasic(
      "Dragapult ex",
      [{ name: "Phantom Dive", cost: ["Psychic", "Psychic", "Psychic"], convertedEnergyCost: 3, damage: "200" }],
      "320",
    );
    const dreepyDef = mockBasic(
      "Dreepy",
      [{ name: "Dragon Headbutt", cost: ["Psychic"], convertedEnergyCost: 1, damage: "10" }],
    );
    const energyDef = mockEnergy();

    const dragapult = createCardInstance("dragapult-def", PlayerId.P1, Zone.Bench);
    const dreepy = createCardInstance("dreepy-def", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("psy-energy", PlayerId.P1, Zone.Hand);

    const state = baseState(
      {
        "dragapult-def": dragapultDef,
        "dreepy-def": dreepyDef,
        "psy-energy": energyDef,
      },
      dreepy,
      [dragapult],
      [energy],
    );

    const ctx = buildStrategyContext(["Dragapult ex", "Dreepy", "Drakloak"]);
    const target = pickBestEnergyTarget(state, PlayerId.P1, ctx);
    // Primary attacker (Dragapult ex) on bench wins over one-away active Dreepy
    expect(target).toBe(dragapult.instanceId);
  });

  it("active primary attacker that's one-away from its finisher gets top priority", () => {
    // Dragapult ex active with 2 energy (one short of Phantom Dive)
    // Dreepy bench with 0 energy
    const dragapultDef = mockBasic(
      "Dragapult ex",
      [{ name: "Phantom Dive", cost: ["Psychic", "Psychic", "Psychic"], convertedEnergyCost: 3, damage: "200" }],
      "320",
    );
    const dreepyDef = mockBasic(
      "Dreepy",
      [{ name: "Dragon Headbutt", cost: ["Psychic"], convertedEnergyCost: 1, damage: "10" }],
    );

    const dragapult = createCardInstance("dragapult-def", PlayerId.P1, Zone.Active);
    // pre-attach 2 energy to Dragapult so it's one-away
    dragapult.attachedEnergy = [
      createCardInstance("e1", PlayerId.P1, Zone.Active),
      createCardInstance("e2", PlayerId.P1, Zone.Active),
    ];
    const dreepy = createCardInstance("dreepy-def", PlayerId.P1, Zone.Bench);
    const energy = createCardInstance("psy-energy", PlayerId.P1, Zone.Hand);

    const state = baseState(
      {
        "dragapult-def": dragapultDef,
        "dreepy-def": dreepyDef,
        "psy-energy": mockEnergy(),
        e1: mockEnergy(),
        e2: mockEnergy(),
      },
      dragapult,
      [dreepy],
      [energy],
    );

    const ctx = buildStrategyContext(["Dragapult ex", "Dreepy", "Drakloak"]);
    const target = pickBestEnergyTarget(state, PlayerId.P1, ctx);
    expect(target).toBe(dragapult.instanceId);
  });

  it("once primary attacker is fully loaded, energy goes to the next-best setup", () => {
    // Dragapult ex active with 3 energy (Phantom Dive ready)
    // Dreepy bench with 0 energy
    const dragapultDef = mockBasic(
      "Dragapult ex",
      [{ name: "Phantom Dive", cost: ["Psychic", "Psychic", "Psychic"], convertedEnergyCost: 3, damage: "200" }],
      "320",
    );
    const dreepyDef = mockBasic(
      "Dreepy",
      [{ name: "Dragon Headbutt", cost: ["Psychic"], convertedEnergyCost: 1, damage: "10" }],
    );

    const dragapult = createCardInstance("dragapult-def", PlayerId.P1, Zone.Active);
    dragapult.attachedEnergy = [
      createCardInstance("e1", PlayerId.P1, Zone.Active),
      createCardInstance("e2", PlayerId.P1, Zone.Active),
      createCardInstance("e3", PlayerId.P1, Zone.Active),
    ];
    const dreepy = createCardInstance("dreepy-def", PlayerId.P1, Zone.Bench);
    const energy = createCardInstance("psy-energy", PlayerId.P1, Zone.Hand);

    const state = baseState(
      {
        "dragapult-def": dragapultDef,
        "dreepy-def": dreepyDef,
        "psy-energy": mockEnergy(),
        e1: mockEnergy(),
        e2: mockEnergy(),
        e3: mockEnergy(),
      },
      dragapult,
      [dreepy],
      [energy],
    );

    const ctx = buildStrategyContext(["Dragapult ex", "Dreepy", "Drakloak"]);
    const target = pickBestEnergyTarget(state, PlayerId.P1, ctx);
    // Dragapult is fully loaded → focus shifts to Dreepy on the bench
    expect(target).toBe(dreepy.instanceId);
  });

  it("never picks a Pokémon with zero attacks", () => {
    // Dunsparce has no attacks (pure-ability). It must never receive energy.
    const dunsparceDef = mockBasic("Dunsparce", []);
    const dreepyDef = mockBasic(
      "Dreepy",
      [{ name: "Dragon Headbutt", cost: ["Psychic"], convertedEnergyCost: 1, damage: "10" }],
    );

    const dunsparce = createCardInstance("dunsparce-def", PlayerId.P1, Zone.Active);
    const dreepy = createCardInstance("dreepy-def", PlayerId.P1, Zone.Bench);
    const energy = createCardInstance("psy-energy", PlayerId.P1, Zone.Hand);

    const state = baseState(
      {
        "dunsparce-def": dunsparceDef,
        "dreepy-def": dreepyDef,
        "psy-energy": mockEnergy(),
      },
      dunsparce,
      [dreepy],
      [energy],
    );

    const target = pickBestEnergyTarget(state, PlayerId.P1);
    expect(target).toBe(dreepy.instanceId);
  });
});
