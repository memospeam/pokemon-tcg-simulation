import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone, GamePhase } from "../../models/enums";
import type { CardInstance } from "../../models/instance";
import { createCardInstance } from "../../models/instance";
import { parseToolKind, parseToolKindFromText } from "./parseTextTool";
import {
  attachToolToPokemon,
  countToolsOnPlayerPokemon,
  getToolHpBonus,
  getToolRetreatReduction,
  listAllAttachedTools,
} from "./toolEffects";
import type { EngineState } from "../types";
import { emptyTurnFlags, getPlayer } from "../types";

function mockTool(name: string, rules: string[]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Tool"],
    rules,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockPokemon(name: string, hp = "70"): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function minimalState(
  definitions: Record<string, CardDefinition>,
  active?: CardInstance,
): EngineState {
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
        active: active ?? null,
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
    stadium: null,
    stadiumOwnerId: null,
    definitions,
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
  };
}

describe("parseTextTool", () => {
  it("parses Air Balloon retreat reduction", () => {
    expect(
      parseToolKind(
        mockTool("Air Balloon", [
          "The Retreat Cost of the Pokémon this card is attached to is Colorless Colorless less.",
        ]),
      ),
    ).toBe("air_balloon");
  });

  it("parses Cynthia's Power Weight", () => {
    expect(
      parseToolKindFromText("The Cynthia's Pokémon this card is attached to gets +70 HP."),
    ).toBe("cynthias_power_weight");
  });

  it("parses Lucky Helmet and Handheld Fan", () => {
    expect(
      parseToolKindFromText(
        "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if it is Knocked Out), draw 2 cards.",
      ),
    ).toBe("lucky_helmet");
    expect(
      parseToolKindFromText(
        "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if it is Knocked Out), move an Energy from the Attacking Pokémon to 1 of your opponent's Benched Pokémon.",
      ),
    ).toBe("handheld_fan");
  });

  it("parses Binding Mochi and Lillie's Pearl", () => {
    expect(
      parseToolKindFromText(
        "Attacks used by the Poisoned Pokémon this card is attached to do 40 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      ),
    ).toBe("binding_mochi");
    expect(
      parseToolKindFromText(
        "If the Lillie's Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.",
      ),
    ).toBe("lillies_pearl");
  });
});

describe("toolEffects", () => {
  it("attaches tool and applies HP/retreat modifiers", () => {
    const balloonDef = mockTool("Air Balloon", [
      "The Retreat Cost of the Pokémon this card is attached to is Colorless Colorless less.",
    ]);
    const weightDef = mockTool("Cynthia's Power Weight", [
      "The Cynthia's Pokémon this card is attached to gets +70 HP.",
    ]);
    const cynthiaDef = mockPokemon("Cynthia's Gible", "110");
    const otherDef = mockPokemon("Pikachu", "60");

    const cynthia = createCardInstance("cynthia-gible", PlayerId.P1, Zone.Active);
    cynthia.attachedTools = [];
    const state = minimalState(
      {
        "air-balloon": balloonDef,
        "power-weight": weightDef,
        "cynthia-gible": cynthiaDef,
        "pikachu": otherDef,
      },
      cynthia,
    );

    const balloon = createCardInstance("air-balloon", PlayerId.P1, Zone.Hand);
    const weight = createCardInstance("power-weight", PlayerId.P1, Zone.Hand);

    expect(attachToolToPokemon(state, PlayerId.P1, balloon, cynthia)).toBe(true);
    expect(getToolRetreatReduction(state, cynthia)).toBe(2);
    expect(attachToolToPokemon(state, PlayerId.P1, weight, cynthia)).toBe(true);
    expect(getToolHpBonus(state, cynthia)).toBe(70);
    expect(countToolsOnPlayerPokemon(state, PlayerId.P1)).toBe(1);
    expect(listAllAttachedTools(state)).toHaveLength(1);
  });

  it("rejects Power Weight on non-Cynthia Pokémon", () => {
    const weightDef = mockTool("Cynthia's Power Weight", [
      "The Cynthia's Pokémon this card is attached to gets +70 HP.",
    ]);
    const pikaDef = mockPokemon("Pikachu", "60");
    const pika = createCardInstance("pikachu", PlayerId.P1, Zone.Active);
    pika.attachedTools = [];
    const state = minimalState({ "power-weight": weightDef, pikachu: pikaDef }, pika);
    const weight = createCardInstance("power-weight", PlayerId.P1, Zone.Hand);
    expect(attachToolToPokemon(state, PlayerId.P1, weight, pika)).toBe(false);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(0);
  });
});
