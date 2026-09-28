import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import {
  applyRareCandy,
  applyTrainerEffect,
  applyWallysCompassion,
  canPlayTrainerEffect,
  continueNightStretcherPick,
} from "./trainerEffects";
import { gameReducer } from "./reducer";
import { createInitialGame } from "./rules";
import { getPlayer } from "./types";

function mockTrainer(name: string, subtypes: string[] = ["Item"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockBasic(name: string, hp = "70"): CardDefinition {
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

function mockSpecialEnergy(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Special"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name = "Fire Energy"): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

describe("trainerEffects", () => {
  it("Lillie's Determination shuffles hand into deck and draws 6", () => {
    const lillie = mockTrainer("Lillie's Determination", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [
      createCardInstance(mockBasic("A").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("B").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("C").apiId, PlayerId.P1, Zone.Hand),
    ];
    player.deck = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(mockEnergy(`Deck${i}`).apiId, PlayerId.P1, Zone.Deck),
    );

    applyTrainerEffect(state, PlayerId.P1, lillie);
    expect(player.hand.length).toBe(6);
  });

  it("Lillie's Determination draws 8 with exactly 6 Prize cards remaining", () => {
    const lillie = mockTrainer("Lillie's Determination", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.prizes = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(mockEnergy(`P${i}`).apiId, PlayerId.P1, Zone.Prizes),
    );
    player.deck = Array.from({ length: 12 }, (_, i) =>
      createCardInstance(mockEnergy(`Deck${i}`).apiId, PlayerId.P1, Zone.Deck),
    );

    applyTrainerEffect(state, PlayerId.P1, lillie);
    expect(player.hand.length).toBe(8);
  });

  it("Poké Pad searches Pokémon without Rule Box", () => {
    const pokePad = mockTrainer("Poké Pad");
    const dreepy = mockBasic("Dreepy");
    const dragapult = {
      ...mockBasic("Dragapult ex", "320"),
      name: "Dragapult ex",
      subtypes: ["Stage 2", "ex"],
    };
    const cards = [
      dreepy,
      dragapult,
      ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`)),
    ];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.deck = [
      createCardInstance(dragapult.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Deck),
    ];

    applyTrainerEffect(state, PlayerId.P1, pokePad);
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
    if (state.pendingAction?.type === "SEARCH_DECK") {
      expect(state.pendingAction.filter).toBe("POKEMON_NO_RULE_BOX");
      expect(state.pendingAction.options).toHaveLength(2);
    }
  });

  it("Ultra Ball requires discarding 2 cards first", () => {
    const ultraBall = mockTrainer("Ultra Ball");
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [
      createCardInstance(mockBasic("A").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("B").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("C").apiId, PlayerId.P1, Zone.Hand),
    ];

    expect(canPlayTrainerEffect(state, PlayerId.P1, ultraBall).ok).toBe(true);
    applyTrainerEffect(state, PlayerId.P1, ultraBall);
    expect(state.pendingAction?.type).toBe("ULTRA_BALL_DISCARD");
  });

  it("Ultra Ball cannot be played with fewer than 3 cards in hand", () => {
    const ultraBall = mockTrainer("Ultra Ball");
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [
      createCardInstance(mockBasic("A").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("B").apiId, PlayerId.P1, Zone.Hand),
    ];

    expect(canPlayTrainerEffect(state, PlayerId.P1, ultraBall).ok).toBe(false);
  });

  it("Boss's Orders requires opponent Bench", () => {
    const boss = mockTrainer("Boss's Orders", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    getPlayer(state, PlayerId.P2).bench = [];

    expect(canPlayTrainerEffect(state, PlayerId.P1, boss).ok).toBe(false);
  });

  it("Lillie's Pearl does not trigger Lillie's Determination effect", () => {
    const pearl = mockTrainer("Lillie's Pearl", ["Item"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [createCardInstance(mockBasic("A").apiId, PlayerId.P1, Zone.Hand)];

    applyTrainerEffect(state, PlayerId.P1, pearl);
    expect(player.hand).toHaveLength(1);
  });

  it("Night Stretcher can pick up to 3 Pokémon", () => {
    const stretcher = mockTrainer("Night Stretcher");
    const dreepy = mockBasic("Dreepy");
    const cards = [dreepy, ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    const p1 = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Discard);
    const p2 = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Discard);
    const p3 = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Discard);
    player.discard = [p1, p2, p3];

    applyTrainerEffect(state, PlayerId.P1, stretcher);
    expect(state.pendingAction?.type).toBe("PICK_DISCARD");
    if (state.pendingAction?.type === "PICK_DISCARD") {
      expect(state.pendingAction.slotsRemaining).toBe(3);
    }

    continueNightStretcherPick(state, PlayerId.P1, p1.instanceId);
    expect(player.hand).toHaveLength(1);
    expect(state.pendingAction?.type).toBe("PICK_DISCARD");
    if (state.pendingAction?.type === "PICK_DISCARD") {
      expect(state.pendingAction.slotsRemaining).toBe(2);
    }
  });

  it("Iono puts hand cards on deck bottom and draws 3 when ahead on Prizes", () => {
    const iono = mockTrainer("Iono", ["Supporter"]);
    const filler = mockEnergy("Filler Energy");
    const cards = [mockBasic("Dreepy"), filler, ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 3;
    const player = getPlayer(state, PlayerId.P1);
    const opponent = getPlayer(state, PlayerId.P2);
    player.prizes = Array.from({ length: 6 }, () =>
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Prizes),
    );
    opponent.prizes = Array.from({ length: 4 }, () =>
      createCardInstance(filler.apiId, PlayerId.P2, Zone.Prizes),
    );
    player.hand = [createCardInstance(filler.apiId, PlayerId.P1, Zone.Hand)];
    opponent.hand = [createCardInstance(filler.apiId, PlayerId.P2, Zone.Hand)];
    player.deck = Array.from({ length: 8 }, () =>
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Deck),
    );
    opponent.deck = Array.from({ length: 8 }, () =>
      createCardInstance(filler.apiId, PlayerId.P2, Zone.Deck),
    );

    applyTrainerEffect(state, PlayerId.P1, iono);
    expect(state.pendingAction).toBeNull();
    expect(player.hand.length).toBe(3);
    expect(opponent.hand.length).toBe(1);
  });

  it("Hilda searches an Evolution Pokémon and an Energy card", () => {
    const hilda = mockTrainer("Hilda", ["Supporter"]);
    const drakloak = {
      ...mockBasic("Drakloak", "90"),
      subtypes: ["Stage 1"],
      evolvesFrom: "Dreepy",
    };
    const fireEnergy = mockEnergy("Fire Energy");
    const cards = [
      mockBasic("Dreepy"),
      drakloak,
      hilda,
      fireEnergy,
      ...Array.from({ length: 55 }, (_, i) => mockEnergy(`E${i}`)),
    ];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
      extraDefinitions: [drakloak],
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.deck = [
      createCardInstance(drakloak.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(fireEnergy.apiId, PlayerId.P1, Zone.Deck),
    ];

    applyTrainerEffect(state, PlayerId.P1, hilda);
    expect(player.hand.some((card) => card.definitionId === drakloak.apiId)).toBe(true);
    expect(player.hand.some((card) => card.definitionId === fireEnergy.apiId)).toBe(true);
    expect(state.pendingAction).toBeNull();
  });

  it("Hilda can be played with only Energy in deck", () => {
    const hilda = mockTrainer("Hilda", ["Supporter"]);
    const fireEnergy = mockEnergy("Fire Energy");
    const cards = [mockBasic("Dreepy"), hilda, fireEnergy, ...Array.from({ length: 57 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.deck = [createCardInstance(fireEnergy.apiId, PlayerId.P1, Zone.Deck)];

    expect(canPlayTrainerEffect(state, PlayerId.P1, hilda).ok).toBe(true);
    applyTrainerEffect(state, PlayerId.P1, hilda);
    expect(player.hand.some((card) => card.definitionId === fireEnergy.apiId)).toBe(true);
  });

  it("Wally's Compassion heals ALL damage and puts energy into hand; Pokémon stays in play", () => {
    const wally = mockTrainer("Wally's Compassion", ["Supporter"]);
    const lopunny: CardDefinition = {
      apiId: "Mega Lopunny ex",
      name: "Mega Lopunny ex",
      supertype: "Pokémon",
      subtypes: ["Basic", "ex"],
      hp: "330",
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const fireEnergy = mockEnergy("Fire Energy");
    const cards = [lopunny, wally, ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    const lopunnyInstance = createCardInstance(lopunny.apiId, PlayerId.P1, Zone.Active);
    lopunnyInstance.damageCounters = 160;
    // Attach an energy to verify it goes to hand
    const energyInst = createCardInstance(fireEnergy.apiId, PlayerId.P1, Zone.Active);
    lopunnyInstance.attachedEnergy = [energyInst];
    player.active = lopunnyInstance;

    applyWallysCompassion(state, PlayerId.P1, lopunnyInstance.instanceId);

    // Pokémon stays in play (not shuffled to deck)
    expect(player.active).not.toBeNull();
    expect(player.active!.instanceId).toBe(lopunnyInstance.instanceId);
    // ALL damage healed
    expect(player.active!.damageCounters).toBe(0);
    // Energy went to hand (not deck)
    expect(player.active!.attachedEnergy).toHaveLength(0);
    expect(player.hand.some((c) => c.instanceId === energyInst.instanceId)).toBe(true);
  });

  it("Wally's Compassion on undamaged Pokémon: heals nothing, energy stays attached", () => {
    const lopunny: CardDefinition = {
      apiId: "Mega Lopunny ex",
      name: "Mega Lopunny ex",
      supertype: "Pokémon",
      subtypes: ["Basic", "ex"],
      hp: "330",
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const fireEnergy = mockEnergy("Fire Energy");
    const cards = [lopunny, ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    const lopunnyInstance = createCardInstance(lopunny.apiId, PlayerId.P1, Zone.Active);
    lopunnyInstance.damageCounters = 0; // no damage
    const energyInst = createCardInstance(fireEnergy.apiId, PlayerId.P1, Zone.Active);
    lopunnyInstance.attachedEnergy = [energyInst];
    player.active = lopunnyInstance;

    applyWallysCompassion(state, PlayerId.P1, lopunnyInstance.instanceId);

    // Pokémon stays, energy stays (no damage was healed)
    expect(player.active).not.toBeNull();
    expect(player.active!.attachedEnergy).toHaveLength(1);
  });

  it("Judge shuffles both hands and draws 4", () => {
    const judge = mockTrainer("Judge", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      const player = getPlayer(state, playerId);
      player.hand = Array.from({ length: 5 }, (_, i) =>
        createCardInstance(mockEnergy(`H${playerId}${i}`).apiId, playerId, Zone.Hand),
      );
      player.deck = Array.from({ length: 20 }, (_, i) =>
        createCardInstance(mockEnergy(`D${playerId}${i}`).apiId, playerId, Zone.Deck),
      );
    }

    applyTrainerEffect(state, PlayerId.P1, judge);
    expect(getPlayer(state, PlayerId.P1).hand.length).toBe(4);
    expect(getPlayer(state, PlayerId.P2).hand.length).toBe(4);
  });

  it("Rare Candy evolves Basic to Stage 2 via evolution line (Dreepy → Dragapult ex)", () => {
    const dreepy = mockBasic("Dreepy");
    const drakloak = {
      ...mockBasic("Drakloak", "90"),
      subtypes: ["Stage 1"],
      evolvesFrom: "Dreepy",
    };
    const dragapult = {
      ...mockBasic("Dragapult ex", "320"),
      subtypes: ["Stage 2", "ex"],
      evolvesFrom: "Drakloak",
    };
    const rareCandy = mockTrainer("Rare Candy");
    const cards = [
      dreepy,
      drakloak,
      dragapult,
      rareCandy,
      ...Array.from({ length: 55 }, (_, i) => mockEnergy(`E${i}`)),
    ];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
      extraDefinitions: [drakloak],
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 2;
    const player = getPlayer(state, PlayerId.P1);
    player.active = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Active);
    player.active!.enteredPlayTurn = 1;
    player.hand = [createCardInstance(dragapult.apiId, PlayerId.P1, Zone.Hand)];

    applyRareCandy(state, PlayerId.P1, player.active!.instanceId);
    expect(player.active?.definitionId).toBe(dragapult.apiId);
    expect(player.hand).toHaveLength(0);
  });

  it("Buddy-Buddy Poffin can be played when the deck has no Basic Pokémon with 70 HP or less", () => {
    const poffin = {
      ...mockTrainer("Buddy-Buddy Poffin"),
      rules: [
        "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.",
      ],
    };
    const fez = mockBasic("Fezandipiti ex", "210");
    const cards = [poffin, fez, ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 2;
    const player = getPlayer(state, PlayerId.P1);
    const poffinCard = createCardInstance(poffin.apiId, PlayerId.P1, Zone.Hand);
    player.hand = [poffinCard];
    player.deck = [createCardInstance(fez.apiId, PlayerId.P1, Zone.Deck)];
    player.active = createCardInstance(fez.apiId, PlayerId.P1, Zone.Active);

    expect(canPlayTrainerEffect(state, PlayerId.P1, poffin).ok).toBe(true);
    const next = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: poffinCard.instanceId });
    expect(getPlayer(next, PlayerId.P1).hand.some((card) => card.instanceId === poffinCard.instanceId)).toBe(false);
    expect(next.pendingAction).toBeNull();
    expect(getPlayer(next, PlayerId.P1).bench).toHaveLength(0);
  });

  it("Buddy-Buddy Poffin can be played when the Bench is full", () => {
    const poffin = mockTrainer("Buddy-Buddy Poffin");
    const dreepy = mockBasic("Dreepy", "70");
    const cards = [poffin, dreepy, ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 2;
    const player = getPlayer(state, PlayerId.P1);
    player.active = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Active);
    player.bench = Array.from({ length: 5 }, () => createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Bench));
    player.deck = [createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Deck)];
    const poffinCard = createCardInstance(poffin.apiId, PlayerId.P1, Zone.Hand);
    player.hand = [poffinCard];

    expect(canPlayTrainerEffect(state, PlayerId.P1, poffin).ok).toBe(true);
    const next = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: poffinCard.instanceId });
    expect(next.pendingAction).toBeNull();
    expect(getPlayer(next, PlayerId.P1).bench).toHaveLength(5);
  });

  it("Buddy-Buddy Poffin does not bench a Pokémon over 70 HP", () => {
    const fez = mockBasic("Fezandipiti ex", "210");
    const cards = [fez, ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    const deckCard = createCardInstance(fez.apiId, PlayerId.P1, Zone.Deck);
    player.deck = [deckCard];
    player.active = createCardInstance(fez.apiId, PlayerId.P1, Zone.Active);
    state.pendingAction = {
      type: "SEARCH_DECK",
      playerId: PlayerId.P1,
      filter: "POFFIN",
      options: [deckCard.instanceId],
      slotsRemaining: 2,
    };

    const next = gameReducer(state, {
      type: "PICK_DECK_CARD",
      playerId: PlayerId.P1,
      instanceId: deckCard.instanceId,
    });
    expect(getPlayer(next, PlayerId.P1).bench).toHaveLength(0);
    expect(getPlayer(next, PlayerId.P1).deck.some((card) => card.instanceId === deckCard.instanceId)).toBe(true);
  });

  it("Ultra Ball can be played when the deck has no Pokémon", () => {
    const ultraBall = mockTrainer("Ultra Ball");
    const energy = mockEnergy("Fire Energy");
    const cards = [ultraBall, energy, ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [
      createCardInstance(ultraBall.apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(energy.apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(energy.apiId, PlayerId.P1, Zone.Hand),
    ];
    player.deck = [createCardInstance(energy.apiId, PlayerId.P1, Zone.Deck)];

    expect(canPlayTrainerEffect(state, PlayerId.P1, ultraBall).ok).toBe(true);
  });

  it("Crispin can be played when the deck has no Basic Energy", () => {
    const crispin = {
      ...mockTrainer("Crispin", ["Supporter"]),
      rules: [
        "Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Pokémon.",
      ],
    };
    const dreepy = mockBasic("Dreepy", "70");
    const cards = [crispin, dreepy, ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 2;
    const player = getPlayer(state, PlayerId.P1);
    player.active = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Active);
    player.hand = [createCardInstance(crispin.apiId, PlayerId.P1, Zone.Hand)];
    player.deck = [createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Deck)];

    expect(canPlayTrainerEffect(state, PlayerId.P1, crispin).ok).toBe(true);
    const crispinCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const next = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: crispinCard.instanceId });
    expect(next.pendingAction).toBeNull();
    expect(getPlayer(next, PlayerId.P1).hand).toHaveLength(0);
  });

  function enhancedHammerState(attached: { def: CardDefinition; on: "active" | "bench" }[]) {
    const hammer = {
      ...mockTrainer("Enhanced Hammer"),
      rules: [
        "Discard a Special Energy from 1 of your opponent's Pokémon. You may play any number of Item cards during your turn.",
      ],
    };
    const dreepy = mockBasic("Dreepy", "70");
    const cards = [
      hammer,
      dreepy,
      ...attached.map((entry) => entry.def),
      ...Array.from({ length: 50 }, (_, i) => mockEnergy(`Fill${i}`)),
    ];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 2;
    const player = getPlayer(state, PlayerId.P1);
    const opponent = getPlayer(state, PlayerId.P2);
    const hammerCard = createCardInstance(hammer.apiId, PlayerId.P1, Zone.Hand);
    player.hand = [hammerCard];
    player.active = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Active);
    const active = createCardInstance(dreepy.apiId, PlayerId.P2, Zone.Active);
    const bench = createCardInstance(dreepy.apiId, PlayerId.P2, Zone.Bench);
    opponent.active = active;
    opponent.bench = [];
    for (const entry of attached) {
      const energy = createCardInstance(entry.def.apiId, PlayerId.P2, Zone.Attached);
      if (entry.on === "active") active.attachedEnergy.push(energy);
      else {
        if (opponent.bench.length === 0) opponent.bench.push(bench);
        bench.attachedEnergy.push(energy);
      }
    }
    return { state, hammer, hammerCard };
  }

  it("Enhanced Hammer cannot discard Basic Energy", () => {
    const fire = mockEnergy("Fire Energy");
    const { state, hammer, hammerCard } = enhancedHammerState([{ def: fire, on: "active" }]);
    const opponent = getPlayer(state, PlayerId.P2);

    expect(canPlayTrainerEffect(state, PlayerId.P1, hammer).ok).toBe(false);
    const next = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: hammerCard.instanceId });
    expect(getPlayer(next, PlayerId.P1).hand.some((card) => card.instanceId === hammerCard.instanceId)).toBe(true);
    expect(getPlayer(next, PlayerId.P2).active?.attachedEnergy.map((energy) => energy.definitionId)).toEqual(
      opponent.active?.attachedEnergy.map((energy) => energy.definitionId),
    );
  });

  it("Enhanced Hammer discards one Special Energy and leaves Basic Energy attached", () => {
    const fire = mockEnergy("Fire Energy");
    const mist = mockSpecialEnergy("Mist Energy");
    const { state, hammerCard } = enhancedHammerState([
      { def: fire, on: "active" },
      { def: mist, on: "active" },
    ]);

    const next = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: hammerCard.instanceId });
    const attached = getPlayer(next, PlayerId.P2).active?.attachedEnergy ?? [];
    expect(next.pendingAction).toBeNull();
    expect(attached.map((energy) => energy.definitionId)).toEqual(["Fire Energy"]);
  });

  it("Enhanced Hammer offers only Special Energy when several are attached", () => {
    const fire = mockEnergy("Fire Energy");
    const mist = mockSpecialEnergy("Mist Energy");
    const jet = mockSpecialEnergy("Jet Energy");
    const { state, hammerCard } = enhancedHammerState([
      { def: fire, on: "active" },
      { def: mist, on: "active" },
      { def: jet, on: "active" },
    ]);

    const choosing = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: hammerCard.instanceId });
    expect(choosing.pendingAction?.type).toBe("ENHANCED_HAMMER");
    if (choosing.pendingAction?.type !== "ENHANCED_HAMMER") return;
    expect(choosing.pendingAction.options.map((option) => option.energyId)).toHaveLength(2);
    const optionIds = new Set(choosing.pendingAction.options.map((option) => option.energyId));
    const attached = getPlayer(choosing, PlayerId.P2).active?.attachedEnergy ?? [];
    expect(attached.filter((energy) => optionIds.has(energy.instanceId)).map((energy) => energy.definitionId).sort()).toEqual([
      "Jet Energy",
      "Mist Energy",
    ]);

    const mistId = attached.find((energy) => energy.definitionId === "Mist Energy")!.instanceId;
    const pokemonId = getPlayer(choosing, PlayerId.P2).active!.instanceId;
    const next = gameReducer(choosing, {
      type: "DISCARD_OPPONENT_ENERGY",
      playerId: PlayerId.P1,
      pokemonId,
      energyId: mistId,
    });
    expect(getPlayer(next, PlayerId.P2).active?.attachedEnergy.map((energy) => energy.definitionId).sort()).toEqual([
      "Fire Energy",
      "Jet Energy",
    ]);
  });

  it("Gwynn discards only Pokémon without a Rule Box and draws 3 cards for each", () => {
    const abra = mockBasic("Abra");
    const duskull = mockBasic("Duskull");
    const fez = mockBasic("Fezandipiti ex");
    fez.subtypes = ["Basic", "ex"];
    const energy = mockEnergy("Fire Energy");
    const gwynn = mockTrainer("Gwynn", ["Supporter"]);
    gwynn.rules = [
      "Discard up to 2 Pokémon that don't have a Rule Box from your hand, and draw 3 cards for each card you discarded in this way. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
    ];
    const fillers = Array.from({ length: 55 }, (_, i) => mockEnergy(`E${i}`));
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: [abra, duskull, fez, energy, gwynn, ...fillers],
      player2Cards: [abra, duskull, fez, energy, gwynn, ...fillers],
    });
    state.phase = GamePhase.Active;
    state.currentPlayerId = PlayerId.P1;
    const player = getPlayer(state, PlayerId.P1);
    const handAbra = createCardInstance(abra.apiId, PlayerId.P1, Zone.Hand);
    const handDuskull = createCardInstance(duskull.apiId, PlayerId.P1, Zone.Hand);
    const handFez = createCardInstance(fez.apiId, PlayerId.P1, Zone.Hand);
    const handEnergy = createCardInstance(energy.apiId, PlayerId.P1, Zone.Hand);
    player.hand = [handAbra, handDuskull, handFez, handEnergy];
    player.deck = Array.from({ length: 10 }, () => createCardInstance(energy.apiId, PlayerId.P1, Zone.Deck));

    applyTrainerEffect(state, PlayerId.P1, gwynn);
    expect(state.pendingAction?.type).toBe("GWYNN");
    if (state.pendingAction?.type !== "GWYNN") return;
    expect(state.pendingAction.options.sort()).toEqual([handAbra.instanceId, handDuskull.instanceId].sort());

    const afterFirst = gameReducer(state, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: handAbra.instanceId,
    });
    expect(afterFirst.pendingAction?.type).toBe("GWYNN");
    const afterSecond = gameReducer(afterFirst, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: handFez.instanceId,
    });
    expect(afterSecond.pendingAction?.type).toBe("GWYNN");
    const done = gameReducer(afterSecond, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: handDuskull.instanceId,
    });
    const donePlayer = getPlayer(done, PlayerId.P1);
    expect(done.pendingAction).toBeNull();
    expect(donePlayer.discard.map((card) => card.definitionId).sort()).toEqual(["Abra", "Duskull"]);
    expect(donePlayer.hand.some((card) => card.definitionId === "Fezandipiti ex")).toBe(true);
    expect(donePlayer.hand.filter((card) => card.definitionId === "Fire Energy")).toHaveLength(7);
    expect(donePlayer.deck).toHaveLength(4);
  });

  it("Gwynn can stop after discarding one Pokémon and still draws 3", () => {
    const abra = mockBasic("Abra");
    const duskull = mockBasic("Duskull");
    const energy = mockEnergy("Fire Energy");
    const gwynn = mockTrainer("Gwynn", ["Supporter"]);
    gwynn.rules = [
      "Discard up to 2 Pokémon that don't have a Rule Box from your hand, and draw 3 cards for each card you discarded in this way.",
    ];
    const fillers = Array.from({ length: 56 }, (_, i) => mockEnergy(`E${i}`));
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: [abra, duskull, energy, gwynn, ...fillers],
      player2Cards: [abra, duskull, energy, gwynn, ...fillers],
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    const handAbra = createCardInstance(abra.apiId, PlayerId.P1, Zone.Hand);
    const handDuskull = createCardInstance(duskull.apiId, PlayerId.P1, Zone.Hand);
    player.hand = [handAbra, handDuskull];
    player.deck = Array.from({ length: 6 }, () => createCardInstance(energy.apiId, PlayerId.P1, Zone.Deck));

    applyTrainerEffect(state, PlayerId.P1, gwynn);
    const afterDiscard = gameReducer(state, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: handAbra.instanceId,
    });
    const done = gameReducer(afterDiscard, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    const donePlayer = getPlayer(done, PlayerId.P1);
    expect(done.pendingAction).toBeNull();
    expect(donePlayer.discard.map((card) => card.definitionId)).toEqual(["Abra"]);
    expect(donePlayer.hand.filter((card) => card.definitionId === "Duskull")).toHaveLength(1);
    expect(donePlayer.hand.filter((card) => card.definitionId === "Fire Energy")).toHaveLength(3);
  });
});
