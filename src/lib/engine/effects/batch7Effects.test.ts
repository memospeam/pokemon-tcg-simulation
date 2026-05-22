import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { canAffordAttack, getAttachedEnergyPool } from "../energy";
import { getToolHpBonus } from "./toolEffects";
import { parseToolKindFromText } from "./parseTextTool";
import { parseTrainerFullText } from "./parseTextTrainer";
import {
  applyMasterBall,
  applyPrimeCatcher,
  resolvePrimeCatcherOpponentBench,
  resolvePrimeCatcherOwnBench,
} from "./trainerBatch7Effects";
import { applyAttackDamagePhase } from "./attackFlow";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(name: string, hp = "70", attacks?: CardDefinition["attacks"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types: ["Fire"],
    attacks: attacks ?? [{ name: "Ember", cost: ["Fire"], convertedEnergyCost: 1, damage: "30", text: "" }],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Fire"]): CardDefinition {
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

function minimalBattleState(): EngineState {
  const active = mockBasic("Active", "120");
  const benchA = mockBasic("BenchA", "90");
  const benchB = mockBasic("BenchB", "80");
  const oppActive = mockBasic("OppActive", "100");
  const oppBench = mockBasic("OppBench", "70");

  const activeInst = createCardInstance("active", PlayerId.P1, Zone.Active);
  const benchAInst = createCardInstance("bench-a", PlayerId.P1, Zone.Bench);
  const benchBInst = createCardInstance("bench-b", PlayerId.P1, Zone.Bench);
  const oppActiveInst = createCardInstance("opp-active", PlayerId.P2, Zone.Active);
  const oppBenchInst = createCardInstance("opp-bench", PlayerId.P2, Zone.Bench);

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
        active: activeInst,
        bench: [benchAInst, benchBInst],
        prizes: [],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: oppActiveInst,
        bench: [oppBenchInst],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      active,
      "bench-a": benchA,
      "bench-b": benchB,
      "opp-active": oppActive,
      "opp-bench": oppBench,
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
  };
}

describe("batch 7 ace spec / special energy", () => {
  it("parses Prime Catcher and Master Ball trainer text", () => {
    expect(
      parseTrainerFullText(
        "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, switch your Active Pokémon with 1 of your Benched Pokémon.",
      ),
    ).toEqual([{ kind: "trainer_prime_catcher" }]);
    expect(
      parseTrainerFullText(
        "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([{ kind: "trainer_master_ball" }]);
  });

  it("parses Hero's Cape tool text", () => {
    expect(parseToolKindFromText("The Pokémon this card is attached to gets +100 HP.")).toBe("heroes_cape");
  });

  it("Prime Catcher switches opponent then own active", () => {
    const state = minimalBattleState();
    const oppBenchId = getPlayer(state, PlayerId.P2).bench[0]!.instanceId;
    const ownBenchId = getPlayer(state, PlayerId.P1).bench[0]!.instanceId;
    const oppActiveId = getPlayer(state, PlayerId.P2).active!.instanceId;
    const ownActiveId = getPlayer(state, PlayerId.P1).active!.instanceId;

    applyPrimeCatcher(state, PlayerId.P1);
    resolvePrimeCatcherOpponentBench(state, PlayerId.P1, oppBenchId);
    resolvePrimeCatcherOwnBench(state, PlayerId.P1, ownBenchId);

    const p1 = getPlayer(state, PlayerId.P1);
    const p2 = getPlayer(state, PlayerId.P2);
    expect(p2.active?.instanceId).toBe(oppBenchId);
    expect(p2.bench[0]?.instanceId).toBe(oppActiveId);
    expect(p1.active?.instanceId).toBe(ownBenchId);
    expect(p1.bench.some((entry) => entry.instanceId === ownActiveId)).toBe(true);
    expect(state.pendingAction).toBeNull();
  });

  it("Master Ball searches a Pokémon into hand", () => {
    const target = mockBasic("DeckMon", "60");
    const target2 = mockBasic("DeckMon2", "60");
    const deckCard = createCardInstance("deck-mon", PlayerId.P1, Zone.Deck);
    const deckCard2 = createCardInstance("deck-mon-2", PlayerId.P1, Zone.Deck);
    const filler = createCardInstance("filler", PlayerId.P1, Zone.Deck);
    const state: EngineState = {
      ...minimalBattleState(),
      players: {
        ...minimalBattleState().players,
        [PlayerId.P1]: {
          ...minimalBattleState().players[PlayerId.P1],
          deck: [deckCard, deckCard2, filler],
        },
      },
      definitions: {
        ...minimalBattleState().definitions,
        "deck-mon": target,
        "deck-mon-2": target2,
        filler: mockEnergy("Filler Energy"),
      },
    };

    applyMasterBall(state, PlayerId.P1);
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
  });

  it("Hero's Cape adds 100 HP", () => {
    const state = minimalBattleState();
    const active = getPlayer(state, PlayerId.P1).active!;
    const toolDef: CardDefinition = {
      apiId: "heroes-cape",
      name: "Hero's Cape",
      supertype: "Trainer",
      subtypes: ["Tool", "ACE SPEC"],
      rules: ["The Pokémon this card is attached to gets +100 HP."],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const tool = createCardInstance("heroes-cape", PlayerId.P1, Zone.Active);
    state.definitions["heroes-cape"] = toolDef;
    active.attachedTools = [tool];
    expect(getToolHpBonus(state, active)).toBe(100);
  });

  it("Prism Energy on Basic provides rainbow energy", () => {
    const basic = mockBasic("Basic", "70", [
      { name: "Splash", cost: ["Water"], convertedEnergyCost: 1, damage: "10", text: "" },
    ]);
    const prism = mockEnergy("Prism Energy", ["Colorless"]);
    const state = minimalBattleState();
    const active = getPlayer(state, PlayerId.P1).active!;
    const prismInst = createCardInstance("prism", PlayerId.P1, Zone.Active);
    state.definitions.prism = prism;
    state.definitions.active = basic;
    active.attachedEnergy = [prismInst];

    const pool = getAttachedEnergyPool(state, active);
    expect(pool.rainbow).toBe(1);
    expect(canAffordAttack(state, active, basic.attacks![0]!)).toBe(true);
  });

  it("Prism Energy on non-Basic provides Colorless only", () => {
    const stage1: CardDefinition = {
      ...mockBasic("Stage1", "90"),
      subtypes: ["Stage 1"],
    };
    const prism = mockEnergy("Prism Energy", ["Colorless"]);
    const state = minimalBattleState();
    const active = getPlayer(state, PlayerId.P1).active!;
    const prismInst = createCardInstance("prism", PlayerId.P1, Zone.Active);
    state.definitions.prism = prism;
    state.definitions.active = stage1;
    active.attachedEnergy = [prismInst];

    const pool = getAttachedEnergyPool(state, active);
    expect(pool.colors.Colorless).toBe(1);
    expect(pool.rainbow).toBe(0);
  });

  it("Mist Energy blocks post-damage attack effects when damaged", () => {
    const attackerDef = mockBasic("Attacker", "120", [
      {
        name: "Burn Strike",
        cost: ["Fire"],
        convertedEnergyCost: 1,
        damage: "30",
        text: "Your opponent's Active Pokémon is now Burned.",
      },
    ]);
    const defenderDef = mockBasic("Defender", "120");
    const mist = mockEnergy("Mist Energy", ["Water"]);

    const attacker = createCardInstance("attacker", PlayerId.P2, Zone.Active);
    const defender = createCardInstance("defender", PlayerId.P1, Zone.Active);
    const mistInst = createCardInstance("mist", PlayerId.P1, Zone.Active);
    defender.attachedEnergy = [mistInst];

    const state: EngineState = {
      ...minimalBattleState(),
      currentPlayerId: PlayerId.P2,
      players: {
        [PlayerId.P1]: {
          ...minimalBattleState().players[PlayerId.P1],
          active: defender,
          bench: [],
        },
        [PlayerId.P2]: {
          ...minimalBattleState().players[PlayerId.P2],
          active: attacker,
          bench: [],
        },
      },
      definitions: {
        attacker: attackerDef,
        defender: defenderDef,
        mist,
      },
    };

    applyAttackDamagePhase(state, PlayerId.P2, "Burn Strike");
    expect(defender.damageCounters).toBeGreaterThan(0);
    expect(defender.statusConditions).not.toContain("Burned");
  });
});
