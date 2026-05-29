import { describe, expect, it } from "vitest";
import { pickBestEnergyForTarget } from "./metaGameRunner";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { emptyTurnFlags, type EngineState } from "../engine/types";
import type { CardDefinition } from "../models/definition";

function mockPokemon(
  name: string,
  attacks: { name: string; cost: string[]; convertedEnergyCost: number; damage: string }[],
  types: string[],
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

  it("returns null when hand has no energies", () => {
    const def = mockPokemon("X", [{ name: "Hit", cost: ["Water"], convertedEnergyCost: 1, damage: "10" }], ["Water"]);
    const target = createCardInstance("X", PlayerId.P1, Zone.Active);
    const state = buildState({ X: def }, target, []);

    expect(pickBestEnergyForTarget(state, [], target)).toBeNull();
  });
});
