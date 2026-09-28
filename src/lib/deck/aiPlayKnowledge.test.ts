import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAttachForKnockout, pickAutoTrainerAction, pickHeuristicMainAction } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";

function mockPokemon(
  name: string,
  opts: { hp?: string; types?: string[]; attacks?: CardDefinition["attacks"] } = {},
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: opts.hp ?? "200",
    types: opts.types ?? ["Colorless"],
    abilities: [],
    attacks: opts.attacks ?? [],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, type: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    types: [type],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockTrainer(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Supporter"],
    rules: name.includes("Crispin")
      ? ["Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Pokémon. Then, shuffle your deck."]
      : ["Shuffle your hand into your deck. Then, draw 6 cards."],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function fillerCard(): CardDefinition {
  return mockPokemon("Deck Filler");
}

function stateWith(defs: Record<string, CardDefinition>, hand: CardDefinition[], deck: CardDefinition[]): EngineState {
  const dragapult = mockPokemon("Dragapult ex", {
    hp: "320",
    types: ["Dragon"],
    attacks: [{ name: "Phantom Dive", cost: ["Fire", "Psychic"], damage: "200", text: "" }],
  });
  const wall = mockPokemon("Wall", { hp: "200", types: ["Colorless"] });
  const active = createCardInstance(dragapult.apiId, PlayerId.P1, Zone.Active);
  active.enteredPlayTurn = 1;
  return {
    phase: GamePhase.Active,
    turnNumber: 4,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P2,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: deck.map((def) => createCardInstance(def.apiId, PlayerId.P1, Zone.Deck)),
        hand: hand.map((def) => createCardInstance(def.apiId, PlayerId.P1, Zone.Hand)),
        active,
        bench: [],
        prizes: [createCardInstance("filler", PlayerId.P1, Zone.Prizes)],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: createCardInstance(wall.apiId, PlayerId.P2, Zone.Active),
        bench: [],
        prizes: [createCardInstance("filler", PlayerId.P2, Zone.Prizes)],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: { ...defs, [dragapult.apiId]: dragapult, [wall.apiId]: wall, filler: mockPokemon("Filler") },
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
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("AI play knowledge", () => {
  it("attaches the Energy that KOs this turn before playing a draw supporter", () => {
    const fire = mockEnergy("Fire Energy", "Fire");
    const psychic = mockEnergy("Psychic Energy", "Psychic");
    const lillie = mockTrainer("Lillie's Determination");
    const filler = mockPokemon("Filler Card");
    const state = stateWith(
      { [fire.apiId]: fire, [psychic.apiId]: psychic, [lillie.apiId]: lillie, [filler.apiId]: filler },
      [fire, psychic, lillie, filler],
      [fire],
    );
    const active = getPlayer(state, PlayerId.P1).active!;
    active.attachedEnergy = [createCardInstance(psychic.apiId, PlayerId.P1, Zone.Attached)];

    const action = pickHeuristicMainAction(state, PlayerId.P1, buildStrategyContext(["Dragapult ex"]));
    expect(action?.type).toBe("ATTACH_ENERGY");
    if (action?.type !== "ATTACH_ENERGY") return;
    expect(action.energyId).toBe(getPlayer(state, PlayerId.P1).hand.find((card) => card.definitionId === fire.apiId)?.instanceId);
    expect(pickAttachForKnockout(state, PlayerId.P1)?.type).toBe("ATTACH_ENERGY");
  });

  it("plays Crispin from the deck over a hand refresh when the attacker is short on Energy", () => {
    const fire = mockEnergy("Fire Energy", "Fire");
    const psychic = mockEnergy("Psychic Energy", "Psychic");
    const crispin = mockTrainer("Crispin");
    const lillie = mockTrainer("Lillie's Determination");
    const state = stateWith(
      { [fire.apiId]: fire, [psychic.apiId]: psychic, [crispin.apiId]: crispin, [lillie.apiId]: lillie },
      [crispin, lillie, fire, psychic],
      [fire, psychic, ...Array.from({ length: 12 }, () => fillerCard())],
    );
    getPlayer(state, PlayerId.P1).discard = [
      createCardInstance(fire.apiId, PlayerId.P1, Zone.Discard),
      createCardInstance(fire.apiId, PlayerId.P1, Zone.Discard),
    ];

    const action = pickAutoTrainerAction(state, buildStrategyContext(["Dragapult ex"]));
    expect(action?.type).toBe("PLAY_TRAINER");
    const played = getPlayer(state, PlayerId.P1).hand.find((card) => card.instanceId === action?.instanceId);
    expect(played?.definitionId).toBe(crispin.apiId);
  });

  it("does not play Crispin just because Energy is in the discard", () => {
    const fire = mockEnergy("Fire Energy", "Fire");
    const crispin = mockTrainer("Crispin");
    const lillie = mockTrainer("Lillie's Determination");
    const filler = mockPokemon("Filler Card");
    const state = stateWith(
      { [fire.apiId]: fire, [crispin.apiId]: crispin, [lillie.apiId]: lillie, [filler.apiId]: filler },
      [crispin, lillie, filler, filler],
      [filler],
    );
    getPlayer(state, PlayerId.P1).discard = [
      createCardInstance(fire.apiId, PlayerId.P1, Zone.Discard),
      createCardInstance(fire.apiId, PlayerId.P1, Zone.Discard),
    ];

    const action = pickAutoTrainerAction(state, buildStrategyContext(["Dragapult ex"]));
    const played = getPlayer(state, PlayerId.P1).hand.find((card) => card.instanceId === action?.instanceId);
    expect(played?.definitionId).toBe(lillie.apiId);
  });
});
