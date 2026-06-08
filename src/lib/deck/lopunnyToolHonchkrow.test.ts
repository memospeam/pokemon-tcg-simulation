import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAutoToolAction, pickBestAttack } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

function mockPokemon(
  name: string,
  opts: { hp?: string; types?: string[]; attacks?: CardDefinition["attacks"]; subtypes?: string[] } = {},
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: opts.subtypes ?? ["Basic"],
    hp: opts.hp ?? "120",
    types: opts.types ?? ["Colorless"],
    abilities: [],
    attacks: opts.attacks ?? [],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockAirBalloon(): CardDefinition {
  return {
    apiId: "air-balloon",
    name: "Air Balloon",
    supertype: "Trainer",
    subtypes: ["Pokémon Tool"],
    rules: ["The Pokémon this card is attached to has no Retreat Cost."],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function baseState(
  definitions: Record<string, CardDefinition>,
  p1: { active: ReturnType<typeof createCardInstance>; bench?: ReturnType<typeof createCardInstance>[]; hand?: ReturnType<typeof createCardInstance>[] },
  p2Active: ReturnType<typeof createCardInstance>,
  turnNumber = 3,
): EngineState {
  return {
    phase: GamePhase.Active,
    turnNumber,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1, name: "P1",
        deck: Array.from({ length: 20 }, () => createCardInstance("filler", PlayerId.P1, Zone.Deck)),
        hand: p1.hand ?? [], active: p1.active, bench: p1.bench ?? [],
        prizes: [], discard: [], lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2, name: "P2", deck: [], hand: [], active: p2Active, bench: [],
        prizes: [], discard: [], lostZone: [],
      },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { ...definitions, filler: mockPokemon("Filler") },
    log: [], actionLog: [], winnerId: null, rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("pickAutoToolAction — Air Balloon onto Mega Lopunny ex", () => {
  it("attaches Air Balloon to bench Mega Lopunny ex over a non-Lopunny active", () => {
    const defs = {
      "lopunny-def": mockPokemon("Mega Lopunny ex", { hp: "330", subtypes: ["Stage 2", "MEGA", "ex"] }),
      "dunsparce-def": mockPokemon("Dudunsparce", { hp: "140" }),
      "air-balloon": mockAirBalloon(),
      "opp-def": mockPokemon("Opponent"),
    };
    const active = createCardInstance("dunsparce-def", PlayerId.P1, Zone.Active);
    const lopunny = createCardInstance("lopunny-def", PlayerId.P1, Zone.Bench);
    const balloon = createCardInstance("air-balloon", PlayerId.P1, Zone.Hand);
    const oppActive = createCardInstance("opp-def", PlayerId.P2, Zone.Active);

    const state = baseState(defs, { active, bench: [lopunny], hand: [balloon] }, oppActive);
    const ctx = buildStrategyContext(["Mega Lopunny ex", "Dudunsparce", "Buneary"]);

    const action = pickAutoToolAction(state, ctx);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("ATTACH_TOOL");
    expect(action!.toolId).toBe(balloon.instanceId);
    expect(action!.targetId).toBe(lopunny.instanceId); // → the Lopunny, not the active Dudunsparce
  });
});

describe("Honchkrow — Rocket Feathers fires only when lethal", () => {
  function honchkrowState(trSupportersInHand: number, oppHp: string, turnNumber = 4): EngineState {
    const honchkrow = mockPokemon("Team Rocket's Honchkrow", {
      hp: "150",
      types: ["Darkness"],
      attacks: [{ name: "Rocket Feathers", cost: ["Darkness"], convertedEnergyCost: 1, damage: "60", text: "Discard any number of Team Rocket Supporter cards from your hand. This attack does 60 damage for each card discarded." }],
    });
    const ariana = mockPokemon("Team Rocket's Ariana"); // placeholder def; replaced below for supporters
    const supporterDef: CardDefinition = {
      apiId: "tr-ariana", name: "Team Rocket's Ariana", supertype: "Trainer", subtypes: ["Supporter"],
      set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" },
    };
    void ariana;

    const active = createCardInstance("honchkrow-def", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [createCardInstance("dark-energy", PlayerId.P1, Zone.Active)];
    const hand = Array.from({ length: trSupportersInHand }, () =>
      createCardInstance("tr-ariana", PlayerId.P1, Zone.Hand),
    );
    const oppActive = createCardInstance("opp-def", PlayerId.P2, Zone.Active);

    const defs = {
      "honchkrow-def": honchkrow,
      "tr-ariana": supporterDef,
      "dark-energy": { apiId: "dark-energy", name: "Darkness Energy", supertype: "Energy", subtypes: ["Basic"], types: ["Darkness"], set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" } } as CardDefinition,
      "opp-def": mockPokemon("Opponent", { hp: oppHp }),
    };
    return baseState(defs, { active, bench: [], hand }, oppActive, turnNumber);
  }

  const ctx = buildStrategyContext(["Team Rocket's Honchkrow", "Team Rocket's Murkrow", "Team Rocket's Ariana"]);

  it("does NOT attack when Rocket Feathers can't KO (keeps loading the hand)", () => {
    // 2 supporters → 120 damage vs 200 HP opponent → not lethal.
    const state = honchkrowState(2, "200");
    expect(pickBestAttack(state, PlayerId.P1, ctx)).toBeNull();
  });

  it("attacks when Rocket Feathers is lethal", () => {
    // 4 supporters → 240 damage vs 200 HP opponent → lethal.
    const state = honchkrowState(4, "200");
    expect(pickBestAttack(state, PlayerId.P1, ctx)).toBe("Rocket Feathers");
  });
});
