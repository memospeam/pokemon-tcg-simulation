import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { gameReducer } from "../reducer";
import { parseAbilityText } from "./parseText";
import { canUseAbilityNow, hasActivatableAbility } from "./abilities";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(name: string, hp = "70", types: string[] = ["Colorless"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockFanRotom(): CardDefinition {
  return {
    ...mockBasic("Fan Rotom", "70", ["Colorless"]),
    abilities: [
      {
        name: "Fan Call",
        type: "Ability",
        text: "Once during your first turn, you may search your deck for up to 3 Colorless Pokémon with 100 HP or less, reveal them, and put them into your hand. Then, shuffle your deck. You can't use more than 1 Fan Call Ability during your turn.",
      },
    ],
  };
}

function mockRotom(): CardDefinition {
  return {
    ...mockBasic("Rotom", "70", ["Lightning"]),
    abilities: [
      {
        name: "Roto Motor",
        type: "Ability",
        text: 'You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.',
      },
    ],
  };
}

function battleState(overrides: Partial<EngineState> = {}): EngineState {
  const fanRotomDef = mockFanRotom();
  const fanRotom = createCardInstance("fan-rotom", PlayerId.P1, Zone.Active);
  const bunearyDef = mockBasic("Buneary", "70", ["Colorless"]);
  const dunsparceDef = mockBasic("Dunsparce", "60", ["Colorless"]);
  const deckBuneary = createCardInstance("deck-buneary", PlayerId.P1, Zone.Deck);
  const deckDunsparce = createCardInstance("deck-dunsparce", PlayerId.P1, Zone.Deck);

  return {
    phase: GamePhase.Active,
    turnNumber: 1,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [deckBuneary, deckDunsparce],
        hand: [],
        active: fanRotom,
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
        active: createCardInstance("p2-active", PlayerId.P2, Zone.Active),
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      "fan-rotom": fanRotomDef,
      "p2-active": mockBasic("Target", "70", ["Fire"]),
      "deck-buneary": bunearyDef,
      "deck-dunsparce": dunsparceDef,
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

describe("batch 10 effects", () => {
  it("parses Fan Call ability with searchable effects", () => {
    const parsed = parseAbilityText(mockFanRotom().abilities![0]!);
    expect(hasActivatableAbility(parsed)).toBe(true);
    expect(parsed.effects.some((effect) => effect.kind === "once_during_first_turn")).toBe(true);
    expect(parsed.effects.some((effect) => effect.kind === "search_typed_pokemon_max_hp_to_hand")).toBe(true);
    expect(parsed.effects.some((effect) => effect.kind === "ability_use_limit_per_turn")).toBe(true);
  });

  it("Fan Call is usable on the first turn only", () => {
    const state = battleState();
    const fanRotom = getPlayer(state, PlayerId.P1).active!;
    const parsed = parseAbilityText(state.definitions["fan-rotom"]!.abilities![0]!);
    expect(canUseAbilityNow(state, fanRotom, parsed)).toBe(true);

    const turnTwo = { ...state, turnNumber: 2 };
    expect(canUseAbilityNow(turnTwo, fanRotom, parsed)).toBe(false);
  });

  it("Fan Call searches Colorless Pokémon up to 100 HP into hand", () => {
    const state = battleState();
    const fanRotom = getPlayer(state, PlayerId.P1).active!;
    const playerBefore = getPlayer(state, PlayerId.P1);
    const bunearyId = playerBefore.deck.find((c) => c.definitionId === "deck-buneary")!.instanceId;

    const afterUse = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: fanRotom.instanceId,
      abilityName: "Fan Call",
    });
    expect(afterUse.pendingAction?.type).toBe("SEARCH_DECK");
    if (afterUse.pendingAction?.type === "SEARCH_DECK") {
      expect(afterUse.pendingAction.filter).toBe("TYPED_POKEMON_MAX_HP_HAND");
      expect(afterUse.pendingAction.options).toHaveLength(2);
    }

    const afterPick = gameReducer(afterUse, {
      type: "PICK_DECK_CARD",
      playerId: PlayerId.P1,
      instanceId: bunearyId,
    });
    const player = getPlayer(afterPick, PlayerId.P1);
    expect(player.hand.some((card) => card.instanceId === bunearyId)).toBe(true);
  });

  it("parses Rotom bench search ability", () => {
    const parsed = parseAbilityText(mockRotom().abilities![0]!);
    expect(parsed.effects.some((effect) => effect.kind === "search_named_pokemon_to_bench")).toBe(true);
  });
});
