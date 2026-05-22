import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { getAttachedEnergyPool } from "../energy";
import { applyAttackDamagePhase } from "./attackFlow";
import { getModifiedPrizeCount } from "./abilityHooks";
import {
  isJetEnergy,
  isLegacyEnergy,
  onSpecialEnergyAttachedFromHand,
} from "./specialEnergyEffects";
import {
  canReturnCardFromDiscardToHandOrDeck,
  getStadiumKind,
  shouldNeutralizationZonePreventDamage,
} from "./stadiumEffects";
import {
  applyTreasureTracker,
  canPlayTrainerBatch9Kind,
} from "./trainerBatch9Effects";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Fire"],
  extra?: Partial<CardDefinition>,
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks: [{ name: "Hit", cost: ["Colorless"], convertedEnergyCost: 1, damage: "20", text: "" }],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
    ...extra,
  };
}

function mockEnergy(name: string, types: string[] = ["Colorless"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: types.includes("Grass") ? ["Basic"] : ["Special"],
    types,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockTool(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Tool"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockStadium(name: string, rules: string[]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Stadium", "ACE SPEC"],
    rules,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  const active = mockBasic("Target", "120", ["Grass"]);
  const activeInst = createCardInstance("active", PlayerId.P2, Zone.Active);
  const attackerInst = createCardInstance("attacker", PlayerId.P1, Zone.Active);

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
        active: attackerInst,
        bench: [],
        prizes: Array.from({ length: 2 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: activeInst,
        bench: [],
        prizes: Array.from({ length: 2 }, (_, i) => createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      active,
      attacker: mockBasic("Attacker ex", "120", ["Fire"], {
        subtypes: ["Basic", "ex"],
        attacks: [{ name: "Blast", cost: ["Fire"], convertedEnergyCost: 1, damage: "100", text: "" }],
      }),
      "grass-energy": mockEnergy("Grass Energy", ["Grass"]),
      "legacy-energy": mockEnergy("Legacy Energy"),
      "jet-energy": mockEnergy("Jet Energy"),
      "wild-growth-mon": mockBasic("Exeggcute", "60", ["Grass"], {
        abilities: [
          {
            name: "Wild Growth",
            text: "Each Basic Grass Energy attached to all of your Pokémon provides GrassGrass Energy.",
            type: "Ability",
          },
        ],
      }),
      "lucky-helmet": mockTool("Lucky Helmet"),
      "neutralization-zone": mockStadium("Neutralization Zone", [
        "Prevent all damage done to Pokémon that don't have a Rule Box (both yours and your opponent's) by attacks from the opponent's Pokémon ex and Pokémon V.",
        "This card can't be put into your hand or deck from the discard pile.",
      ]),
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
    ...overrides,
  };
}

describe("batch 9 effects", () => {
  it("detects Legacy and Jet energy by name", () => {
    expect(isLegacyEnergy({ name: "Legacy Energy" } as CardDefinition)).toBe(true);
    expect(isJetEnergy({ name: "Jet Energy" } as CardDefinition)).toBe(true);
  });

  it("Legacy Energy provides rainbow energy", () => {
    const state = baseState();
    const active = getPlayer(state, PlayerId.P2).active!;
    const energy = createCardInstance("legacy-energy", PlayerId.P2, Zone.Active);
    active.attachedEnergy.push(energy);
    const pool = getAttachedEnergyPool(state, active);
    expect(pool.rainbow).toBe(1);
  });

  it("Wild Growth doubles Basic Grass Energy contribution", () => {
    const state = baseState();
    const player = getPlayer(state, PlayerId.P2);
    const wildGrowth = createCardInstance("wg", PlayerId.P2, Zone.Bench);
    player.bench.push(wildGrowth);
    state.definitions[wildGrowth.definitionId] = state.definitions["wild-growth-mon"]!;

    const active = player.active!;
    const grass = createCardInstance("grass", PlayerId.P2, Zone.Active);
    active.attachedEnergy.push(grass);
    state.definitions[grass.definitionId] = state.definitions["grass-energy"]!;

    const pool = getAttachedEnergyPool(state, active);
    expect(pool.colors.Grass).toBe(2);
  });

  it("Neutralization Zone prevents ex/V attack damage to non-Rule Box Pokémon", () => {
    const state = baseState();
    const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);
    state.stadium = stadium;
    state.stadiumOwnerId = PlayerId.P1;
    state.definitions[stadium.definitionId] = state.definitions["neutralization-zone"]!;
    expect(getStadiumKind(state)).toBe("neutralization_zone");

    const attacker = getPlayer(state, PlayerId.P1).active!;
    const defender = getPlayer(state, PlayerId.P2).active!;
    expect(shouldNeutralizationZonePreventDamage(state, defender, attacker)).toBe(true);

    const result = applyAttackDamagePhase(state, PlayerId.P1, "Blast");
    expect(result).toBe("complete");
    expect(defender.damageCounters).toBe(0);
  });

  it("blocks returning Neutralization Zone from discard to hand", () => {
    const state = baseState();
    const card = createCardInstance("nz-discard", PlayerId.P1, Zone.Discard);
    state.definitions[card.definitionId] = state.definitions["neutralization-zone"]!;
    expect(canReturnCardFromDiscardToHandOrDeck(state, card)).toBe(false);
  });

  it("Legacy Energy reduces prize count once per game on attack KO", () => {
    const state = baseState();
    state.turnFlags.attacked = true;
    const defender = getPlayer(state, PlayerId.P2).active!;
    const legacy = createCardInstance("legacy-energy", PlayerId.P2, Zone.Active);
    defender.attachedEnergy.push(legacy);

    expect(getModifiedPrizeCount(state, defender, PlayerId.P1, 1)).toBe(0);
    expect(state.legacyEnergyPrizeReductionUsed[PlayerId.P2]).toBe(true);
    expect(getModifiedPrizeCount(state, defender, PlayerId.P1, 1)).toBe(1);
  });

  it("Jet Energy switches bench Pokémon with active when attached from hand", () => {
    const state = baseState();
    const player = getPlayer(state, PlayerId.P1);
    const benchMon = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    benchMon.zone = Zone.Bench;
    player.bench.push(benchMon);
    state.definitions[benchMon.definitionId] = mockBasic("Bench Mon", "70", ["Water"]);

    const activeId = player.active!.instanceId;
    const energy = createCardInstance("jet", PlayerId.P1, Zone.Hand);
    state.definitions[energy.definitionId] = state.definitions["jet-energy"]!;

    onSpecialEnergyAttachedFromHand(state, PlayerId.P1, energy, benchMon);
    expect(player.active?.instanceId).toBe(benchMon.instanceId);
    expect(player.bench.some((entry) => entry.instanceId === activeId)).toBe(true);
  });

  it("Treasure Tracker searches tools from deck", () => {
    const state = baseState();
    const player = getPlayer(state, PlayerId.P1);
    const tool1 = createCardInstance("tool1", PlayerId.P1, Zone.Deck);
    const tool2 = createCardInstance("tool2", PlayerId.P1, Zone.Deck);
    player.deck.push(tool1, tool2);
    state.definitions[tool1.definitionId] = state.definitions["lucky-helmet"]!;
    state.definitions[tool2.definitionId] = mockTool("Exp. Share");

    expect(canPlayTrainerBatch9Kind(state, PlayerId.P1, "trainer_treasure_tracker").ok).toBe(true);
    applyTreasureTracker(state, PlayerId.P1, 5);
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
    if (state.pendingAction?.type === "SEARCH_DECK") {
      expect(state.pendingAction.filter).toBe("TOOL_HAND");
      expect(state.pendingAction.slotsRemaining).toBe(2);
    }
  });
});
