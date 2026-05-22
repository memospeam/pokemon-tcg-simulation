import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";
import { executeEffects } from "./execute";
import { parseEffectClauses } from "./parseText";

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

function battleState(active: ReturnType<typeof createCardInstance>, deckCount = 5): EngineState {
  const deck = Array.from({ length: deckCount }, (_, index) =>
    createCardInstance(`deck-${index}`, PlayerId.P1, Zone.Deck),
  );
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
        deck,
        hand: [],
        active,
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
      active: mockBasic("Active"),
      "p2-active": mockBasic("Target"),
      ...Object.fromEntries(deck.map((card) => [card.definitionId, mockBasic("Deck Card")])),
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

describe("meta pokemon zone effects", () => {
  it("Run Away Draw shuffles Dudunsparce into deck after drawing", () => {
    const dudunsparce = createCardInstance("dudunsparce", PlayerId.P1, Zone.Active);
    const state = battleState(dudunsparce, 5);
    state.definitions["dudunsparce"] = mockBasic("Dudunsparce", "140", ["Colorless"]);

    const attackText =
      "Draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.";
    const effects = parseEffectClauses(attackText);
    expect(effects.some((effect) => effect.kind === "draw")).toBe(true);
    expect(effects.some((effect) => effect.kind === "shuffle_self_to_deck_if_drew")).toBe(true);

    const playerBefore = getPlayer(state, PlayerId.P1);
    expect(playerBefore.deck.length).toBe(5);
    expect(playerBefore.active?.instanceId).toBe(dudunsparce.instanceId);

    executeEffects(state, {
      playerId: PlayerId.P1,
      opponentId: PlayerId.P2,
      sourcePokemon: dudunsparce,
    }, effects);

    const playerAfter = getPlayer(state, PlayerId.P1);
    expect(playerAfter.hand.length).toBe(3);
    expect(playerAfter.active).toBeNull();
    expect(playerAfter.deck.length).toBe(3);
    expect(playerAfter.deck.some((card) => card.instanceId === dudunsparce.instanceId)).toBe(true);
    expect(state.log.some((entry) => entry.includes("Shuffled this Pokémon"))).toBe(true);
  });

  it("Run Away Draw does not shuffle when deck is empty", () => {
    const dudunsparce = createCardInstance("dudunsparce", PlayerId.P1, Zone.Active);
    const state = battleState(dudunsparce, 0);
    state.definitions["dudunsparce"] = mockBasic("Dudunsparce", "140", ["Colorless"]);

    const effects = parseEffectClauses(
      "Draw 3 cards. If you drew any cards in this way, shuffle this Pokémon and all attached cards into your deck.",
    );

    executeEffects(state, {
      playerId: PlayerId.P1,
      opponentId: PlayerId.P2,
      sourcePokemon: dudunsparce,
    }, effects);

    const playerAfter = getPlayer(state, PlayerId.P1);
    expect(playerAfter.hand.length).toBe(0);
    expect(playerAfter.active?.instanceId).toBe(dudunsparce.instanceId);
  });

  it("Tuck Tail returns Meowth ex to hand", () => {
    const meowth = createCardInstance("meowth-ex", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("fire-energy", PlayerId.P1, Zone.Active);
    meowth.attachedEnergy = [energy];
    const state = battleState(meowth, 0);
    state.definitions["meowth-ex"] = mockBasic("Meowth ex", "160", ["Colorless"]);
    state.definitions["fire-energy"] = {
      apiId: "fire-energy",
      name: "Fire Energy",
      supertype: "Energy",
      subtypes: ["Basic"],
      types: ["Fire"],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };

    const effects = parseEffectClauses("You may put this Pokémon into your hand.");
    expect(effects[0]?.kind).toBe("return_self_to_hand");

    executeEffects(state, {
      playerId: PlayerId.P1,
      opponentId: PlayerId.P2,
      sourcePokemon: meowth,
    }, effects);

    const playerAfter = getPlayer(state, PlayerId.P1);
    expect(playerAfter.active).toBeNull();
    expect(playerAfter.hand.some((card) => card.instanceId === meowth.instanceId)).toBe(true);
    expect(playerAfter.discard.some((card) => card.instanceId === energy.instanceId)).toBe(true);
    expect(meowth.attachedEnergy.length).toBe(0);
  });
});
