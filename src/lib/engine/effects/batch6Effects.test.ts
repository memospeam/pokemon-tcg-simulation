import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { beginGame, gameReducer, startActiveGame } from "../reducer";
import { getPlayer, type EngineState } from "../types";
import { parseAbilityText } from "./parseText";
import { parseStadiumFullText } from "./parseTextTrainer";
import {
  applySpecialCondition,
  clearFestivalGroundsSpecialConditions,
  hasFestivalGroundsSpecialConditionImmunity,
} from "./stadiumEffects";
import {
  canPlayAceSpecFromHand,
  canPlayItemFromHand,
  canPlayToolFromHand,
} from "./playRestrictions";

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

function fillerDeck(extra: CardDefinition[] = []): CardDefinition[] {
  const cards = [...extra];
  for (let i = cards.length; i < 60; i += 1) {
    cards.push({
      apiId: `energy-${i}`,
      name: `Fire Energy ${i}`,
      supertype: "Energy",
      subtypes: ["Basic"],
      types: ["Fire"],
      set: { id: "test", name: "Test" },
      number: `${i}`,
      images: { small: "", large: "" },
    });
  }
  return cards;
}

function setupActiveGame(cards: CardDefinition[], seed = 42): EngineState {
  let state = beginGame({
    player1Name: "Alice",
    player2Name: "Bob",
    player1Cards: cards,
    player2Cards: cards,
    seed,
  });
  while (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
    state = gameReducer(state, { type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
  }
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const basic = getPlayer(state, playerId).hand.find((card) => {
      const def = state.definitions[card.definitionId];
      return def?.supertype === "Pokémon" && def.subtypes.includes("Basic");
    });
    if (basic) {
      state = gameReducer(state, { type: "PLACE_ACTIVE", playerId, instanceId: basic.instanceId });
    }
  }
  return startActiveGame(state);
}

describe("batch 6 ace spec / niche items", () => {
  it("parses ACE Nullifier ability", () => {
    const parsed = parseAbilityText({
      name: "ACE Nullifier",
      type: "Ability",
      text: "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.",
    });
    expect(parsed.effects).toEqual([{ kind: "block_opponent_ace_spec_when_tool_attached" }]);
  });

  it("parses Festival Grounds stadium passive", () => {
    const parsed = parseStadiumFullText(
      "Each Pokémon that has any Energy attached recovers from all Special Conditions and can't be affected by any Special Conditions.",
    );
    expect(parsed).toEqual({ kind: "stadium_festival_grounds" });
  });

  it("blocks ACE SPEC items while opponent Genesect has a Tool (ACE Nullifier)", () => {
    const genesect = mockBasic("Genesect", "200", []);
    genesect.abilities = [
      {
        name: "ACE Nullifier",
        type: "Ability",
        text: "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.",
      },
    ];
    const primeCatcher: CardDefinition = {
      apiId: "prime-catcher",
      name: "Prime Catcher",
      supertype: "Trainer",
      subtypes: ["Item", "ACE SPEC"],
      set: { id: "test", name: "Test" },
      number: "157",
      images: { small: "", large: "" },
    };
    const tool: CardDefinition = {
      apiId: "lucky-helmet",
      name: "Lucky Helmet",
      supertype: "Trainer",
      subtypes: ["Tool"],
      rules: ["If the Pokémon this card is attached to is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, that player draws 1 fewer Prize card."],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };

    let state = setupActiveGame(fillerDeck([genesect, primeCatcher, tool]), 11);
    const p1 = getPlayer(state, PlayerId.P1);
    const p2 = getPlayer(state, PlayerId.P2);

    p1.active = createCardInstance("genesect", PlayerId.P1, Zone.Active);
    p1.active!.attachedTools = [createCardInstance("lucky-helmet", PlayerId.P1, Zone.Active)];
    state.definitions["genesect"] = genesect;
    state.definitions["prime-catcher"] = primeCatcher;
    state.definitions["lucky-helmet"] = tool;

    const aceCard = createCardInstance("prime-catcher", PlayerId.P2, Zone.Hand);
    p2.hand.push(aceCard);
    state.currentPlayerId = PlayerId.P2;

    expect(canPlayAceSpecFromHand(state, PlayerId.P2)).toBe(false);
    const beforeHand = p2.hand.length;
    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P2, instanceId: aceCard.instanceId });
    expect(getPlayer(state, PlayerId.P2).hand.length).toBe(beforeHand);
  });

  it("blocks Item and Tool cards while opponent Active has Oceanic Curse", () => {
    const jellicent = mockBasic("Jellicent ex", "200", []);
    jellicent.abilities = [
      {
        name: "Oceanic Curse",
        type: "Ability",
        text: "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards or Pokémon Tool cards from their hand.",
      },
    ];
    const pokePad: CardDefinition = {
      apiId: "poke-pad",
      name: "Poké Pad",
      supertype: "Trainer",
      subtypes: ["Item"],
      set: { id: "test", name: "Test" },
      number: "81",
      images: { small: "", large: "" },
    };
    const tool: CardDefinition = {
      apiId: "air-balloon",
      name: "Air Balloon",
      supertype: "Trainer",
      subtypes: ["Tool"],
      rules: ["The Retreat Cost of the Pokémon this card is attached to is Colorless Colorless less."],
      set: { id: "test", name: "Test" },
      number: "2",
      images: { small: "", large: "" },
    };

    let state = setupActiveGame(fillerDeck([jellicent, pokePad, tool]), 12);
    const p1 = getPlayer(state, PlayerId.P1);
    const p2 = getPlayer(state, PlayerId.P2);

    p1.active = createCardInstance("jellicent", PlayerId.P1, Zone.Active);
    state.definitions["jellicent"] = jellicent;
    state.definitions["poke-pad"] = pokePad;
    state.definitions["air-balloon"] = tool;

    const item = createCardInstance("poke-pad", PlayerId.P2, Zone.Hand);
    const toolCard = createCardInstance("air-balloon", PlayerId.P2, Zone.Hand);
    p2.hand.push(item, toolCard);
    state.currentPlayerId = PlayerId.P2;

    expect(canPlayItemFromHand(state, PlayerId.P2)).toBe(false);
    expect(canPlayToolFromHand(state, PlayerId.P2)).toBe(false);

    const beforeHand = p2.hand.length;
    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P2, instanceId: item.instanceId });
    expect(getPlayer(state, PlayerId.P2).hand.length).toBe(beforeHand);

    if (p2.active) {
      state = gameReducer(state, {
        type: "ATTACH_TOOL",
        playerId: PlayerId.P2,
        toolId: toolCard.instanceId,
        targetId: p2.active.instanceId,
      });
      expect(getPlayer(state, PlayerId.P2).hand.some((card) => card.instanceId === toolCard.instanceId)).toBe(true);
    }
  });

  it("Festival Grounds clears and prevents Special Conditions on Pokémon with Energy", () => {
    const festivalGrounds: CardDefinition = {
      apiId: "festival-grounds",
      name: "Festival Grounds",
      supertype: "Trainer",
      subtypes: ["Stadium"],
      rules: [
        "Each Pokémon that has any Energy attached recovers from all Special Conditions and can't be affected by any Special Conditions.",
      ],
      set: { id: "test", name: "Test" },
      number: "149",
      images: { small: "", large: "" },
    };

    const state = setupActiveGame(fillerDeck([festivalGrounds, mockBasic("Bench Filler", "60")]), 13);
    state.definitions["festival-grounds"] = festivalGrounds;
    state.stadium = createCardInstance("festival-grounds", PlayerId.P1, Zone.Stadium);
    state.stadiumOwnerId = PlayerId.P1;

    const p1 = getPlayer(state, PlayerId.P1);
    const mon = p1.active!;
    mon.statusConditions = ["Poisoned"];
    mon.attachedEnergy = [
      createCardInstance(
        Object.keys(state.definitions).find((id) => state.definitions[id]?.supertype === "Energy")!,
        PlayerId.P1,
        Zone.Active,
      ),
    ];

    clearFestivalGroundsSpecialConditions(state, mon);
    expect(mon.statusConditions).toEqual([]);
    expect(hasFestivalGroundsSpecialConditionImmunity(state, mon)).toBe(true);
    expect(applySpecialCondition(state, mon, "Burned")).toBe(false);
    expect(mon.statusConditions).toEqual([]);
  });

  it("grants a bonus attack after KO when Festival Grounds is in play and attack has Festival Lead text", () => {
    const festivalGrounds: CardDefinition = {
      apiId: "festival-grounds",
      name: "Festival Grounds",
      supertype: "Trainer",
      subtypes: ["Stadium"],
      rules: [
        "Each Pokémon that has any Energy attached recovers from all Special Conditions and can't be affected by any Special Conditions.",
      ],
      set: { id: "test", name: "Test" },
      number: "149",
      images: { small: "", large: "" },
    };
    const attacker = mockBasic("Festival Attacker", "200", [
      {
        name: "Festival Lead",
        cost: ["Fire"],
        convertedEnergyCost: 1,
        damage: "200",
        text: "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.",
      },
    ]);
    const weakTarget = mockBasic("Weak Target", "30");
    const benchMon = mockBasic("Bench Mon", "200");

    let state = setupActiveGame(fillerDeck([festivalGrounds, attacker, weakTarget, benchMon]), 14);
    state.definitions["festival-grounds"] = festivalGrounds;
    state.definitions["festival-attacker"] = attacker;
    state.definitions["weak-target"] = weakTarget;
    state.definitions["bench-mon"] = benchMon;
    state.stadium = createCardInstance("festival-grounds", PlayerId.P1, Zone.Stadium);
    state.stadiumOwnerId = PlayerId.P1;

    const p1 = getPlayer(state, PlayerId.P1);
    const p2 = getPlayer(state, PlayerId.P2);
    p1.active = createCardInstance("festival-attacker", PlayerId.P1, Zone.Active);
    const energyDefId = Object.keys(state.definitions).find((id) => state.definitions[id]?.supertype === "Energy")!;
    p1.active!.attachedEnergy = [createCardInstance(energyDefId, PlayerId.P1, Zone.Active)];
    p2.active = createCardInstance("weak-target", PlayerId.P2, Zone.Active);
    p2.bench = [createCardInstance("bench-mon", PlayerId.P2, Zone.Bench)];
    state.currentPlayerId = PlayerId.P1;
    state.turnNumber = 2;

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Festival Lead" });
    expect(state.turnFlags.attacked).toBe(false);
    expect(state.turnFlags.bonusAttackAvailable).toBe(true);
    expect(state.pendingAction?.type).toBe("PROMOTE");

    const benchId = p2.bench[0]!.instanceId;
    state = gameReducer(state, { type: "PROMOTE_BENCH", playerId: PlayerId.P2, instanceId: benchId });
    expect(state.turnFlags.bonusAttackAvailable).toBe(true);
    expect(state.turnFlags.attacked).toBe(false);

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Festival Lead" });
    expect(state.turnFlags.attacked).toBe(true);
    expect(state.turnFlags.bonusAttackAvailable).toBe(false);
  });
});
