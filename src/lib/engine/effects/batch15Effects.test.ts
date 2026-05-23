import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { applyAttackDamagePhase } from "./attackFlow";
import { computePreDamageBonus } from "./damageBonus";
import { confirmDrawUntilHand } from "./execute";
import { parseAttackText } from "./parseText";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Grass"]): CardDefinition {
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

function battleState(overrides: Partial<EngineState> = {}): EngineState {
  const active = createCardInstance("active", PlayerId.P1, Zone.Active);
  const deckCards = Array.from({ length: 8 }, (_, index) =>
    createCardInstance(`deck-${index}`, PlayerId.P1, Zone.Deck),
  );
  const p2DeckCards = Array.from({ length: 8 }, (_, index) =>
    createCardInstance(`p2-deck-${index}`, PlayerId.P2, Zone.Deck),
  );
  const deckFiller = mockBasic("Deck Filler", "60", ["Colorless"]);
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
        deck: deckCards,
        hand: [createCardInstance("hand-1", PlayerId.P1, Zone.Hand)],
        active,
        bench: [],
        prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: p2DeckCards,
        hand: [],
        active: createCardInstance("p2-active", PlayerId.P2, Zone.Active),
        bench: [],
        prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      active: mockBasic("Active"),
      "p2-active": mockBasic("Target", "200", ["Water"]),
      "hand-1": deckFiller,
      ...Object.fromEntries(deckCards.map((card) => [card.definitionId, deckFiller])),
      ...Object.fromEntries(p2DeckCards.map((card) => [card.definitionId, deckFiller])),
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
    ...overrides,
  };
}

describe("batch 15 effects", () => {
  it("Corkscrew Dive parses optional draw until 6 cards", () => {
    expect(parseAttackText("You may draw cards until you have 6 cards in your hand.")).toEqual([
      { kind: "draw_until_hand", targetCount: 6, optional: true },
    ]);
  });

  it("Corkscrew Dive waits for optional draw confirmation after damage", () => {
    const garchomp = mockBasic("Cynthia's Garchomp ex", "320", ["Fighting"], [
      {
        name: "Corkscrew Dive",
        cost: ["Fighting", "Fighting"],
        convertedEnergyCost: 2,
        damage: "100",
        text: "You may draw cards until you have 6 cards in your hand.",
      },
    ]);
    const fighting = mockEnergy("Fighting Energy", ["Fighting"]);
    const attacker = createCardInstance("garchomp", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    attacker.attachedEnergy = [energy1, energy2];

    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        garchomp,
        "energy-1": fighting,
        "energy-2": fighting,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: attacker,
        },
      },
    });

    const result = applyAttackDamagePhase(state, PlayerId.P1, "Corkscrew Dive");
    expect(result).toBe("pending");
    expect(state.pendingAction?.type).toBe("DRAW_UNTIL_HAND");
    if (state.pendingAction?.type === "DRAW_UNTIL_HAND") {
      expect(state.pendingAction.targetCount).toBe(6);
      expect(state.pendingAction.optional).toBe(true);
      expect(state.pendingAction.attackName).toBe("Corkscrew Dive");
    }
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
  });

  it("Corkscrew Dive optional draw can be confirmed or skipped", () => {
    const garchomp = mockBasic("Cynthia's Garchomp ex", "320", ["Fighting"], [
      {
        name: "Corkscrew Dive",
        cost: ["Fighting", "Fighting"],
        convertedEnergyCost: 2,
        damage: "100",
        text: "You may draw cards until you have 6 cards in your hand.",
      },
    ]);
    const fighting = mockEnergy("Fighting Energy", ["Fighting"]);
    const attacker = createCardInstance("garchomp", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    attacker.attachedEnergy = [energy1, energy2];

    const base = battleState();
    let state = battleState({
      definitions: {
        ...base.definitions,
        garchomp,
        "energy-1": fighting,
        "energy-2": fighting,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: attacker,
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Corkscrew Dive" });
    expect(state.pendingAction?.type).toBe("DRAW_UNTIL_HAND");

    state = gameReducer(state, { type: "CONFIRM_DRAW_UNTIL_HAND", playerId: PlayerId.P1 });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(6);
    expect(state.currentPlayerId).toBe(PlayerId.P2);

    state = battleState({
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: attacker,
        },
      },
      definitions: {
        ...base.definitions,
        garchomp,
        "energy-1": fighting,
        "energy-2": fighting,
      },
    });
    attacker.attachedEnergy = [energy1, energy2];
    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Corkscrew Dive" });
    state = gameReducer(state, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
    expect(state.currentPlayerId).toBe(PlayerId.P2);
  });

  it("mandatory draw until hand still draws immediately", () => {
    const state = battleState();
    expect(confirmDrawUntilHand(state, PlayerId.P1)).toBe("failed");

    state.pendingAction = {
      type: "DRAW_UNTIL_HAND",
      playerId: PlayerId.P1,
      targetCount: 4,
      optional: false,
    };
    expect(confirmDrawUntilHand(state, PlayerId.P1)).toBe("complete");
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(4);
  });

  it("Syrup Storm counts only Grass Energy across your Pokémon", () => {
    const parsed = parseAttackText(
      "This attack does 30 more damage for each Grass Energy attached to all of your Pokémon.",
    );
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const psychicEnergy = mockEnergy("Psychic Energy", ["Psychic"]);
    const grass1 = createCardInstance("grass-1", PlayerId.P1, Zone.Active);
    const grass2 = createCardInstance("grass-2", PlayerId.P1, Zone.Active);
    const psychic = createCardInstance("psychic-1", PlayerId.P1, Zone.Bench);
    const benchMon = createCardInstance("bench-mon", PlayerId.P1, Zone.Bench);

    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: mockBasic("Hydrapple ex", "330", ["Grass"]),
        "bench-mon": mockBasic("Bench Mon", "70", ["Grass"]),
        "grass-1": grassEnergy,
        "grass-2": grassEnergy,
        "psychic-1": psychicEnergy,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          bench: [benchMon],
        },
      },
    });

    const active = getPlayer(state, PlayerId.P1).active!;
    active.attachedEnergy = [grass1, grass2];
    benchMon.attachedEnergy = [psychic];

    const bonus = computePreDamageBonus(
      state,
      parsed[0]!,
      PlayerId.P1,
      active,
      PlayerId.P2,
    );
    expect(bonus).toBe(60);
  });
});
