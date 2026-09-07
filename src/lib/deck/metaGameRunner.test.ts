import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { getTournamentDeckById, TOURNAMENT_535_TOP16 } from "./tournamentPresets";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import {
  autoSetupEngineState,
  beginMatchFromBuiltDecks,
  pickAutoStadiumAction,
  scoreHandCardKeepValue,
  runEngineAutoPlay,
  runMatchFromBuiltDecks,
  runTournamentPresetMatch,
} from "./metaGameRunner";

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

function mockEnergy(name: string, types: string[] = ["Colorless"]): CardDefinition {
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

function mirrorMatchState(): EngineState {
  const p1Attack = mockBasic("Attacker A", "60", ["Colorless"], [
    { name: "Strike", cost: ["Colorless"], convertedEnergyCost: 1, damage: "60", text: "" },
  ]);
  const p2Attack = mockBasic("Attacker B", "60", ["Colorless"], [
    { name: "Strike", cost: ["Colorless"], convertedEnergyCost: 1, damage: "60", text: "" },
  ]);
  const energy = mockEnergy("Colorless Energy", ["Colorless"]);
  const p1Active = createCardInstance("p1-active", PlayerId.P1, Zone.Active);
  const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
  const p1Energy = createCardInstance("p1-energy", PlayerId.P1, Zone.Active);
  const p2Energy = createCardInstance("p2-energy", PlayerId.P2, Zone.Active);
  p1Active.attachedEnergy = [p1Energy];
  p2Active.attachedEnergy = [p2Energy];

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
        deck: [],
        hand: [],
        active: p1Active,
        bench: [],
        prizes: Array.from({ length: 1 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: p2Active,
        bench: [],
        prizes: Array.from({ length: 1 }, (_, i) => createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      "p1-active": p1Attack,
      "p2-active": p2Attack,
      "p1-energy": energy,
      "p2-energy": energy,
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

describe("metaGameRunner", () => {
  it("runs alternating attacks until a winner is declared", () => {
    const result = runEngineAutoPlay(mirrorMatchState(), { maxTurns: 20, maxActions: 80 });
    expect(result.stalled).toBe(false);
    expect(result.winnerId).not.toBeNull();
    expect(result.state.phase).toBe(GamePhase.Finished);
    expect(result.actionCount).toBeGreaterThan(0);
  });

  it("auto-resolves Mirage Barrage two-target damage during auto-play", () => {
    const base = mirrorMatchState();
    const greninjaDef = mockBasic("Greninja ex", "330", ["Water"], [
      {
        name: "Mirage Barrage",
        cost: [],
        convertedEnergyCost: 0,
        damage: "",
        text: "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ]);
    const water = mockEnergy("Water Energy", ["Water"]);
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const energies = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(`energy-${index}`, PlayerId.P1, Zone.Active),
    );
    greninja.attachedEnergy = energies;
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const bench = Array.from({ length: 2 }, (_, index) =>
      createCardInstance(`p2-bench-${index}`, PlayerId.P2, Zone.Bench),
    );

    const state: EngineState = {
      ...base,
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: greninja,
          prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: p2Active,
          bench,
        },
      },
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        "p2-active": mockBasic("Defender", "330", ["Lightning"]),
        "p2-bench-0": mockBasic("Bench A", "200", ["Colorless"]),
        "p2-bench-1": mockBasic("Bench B", "200", ["Colorless"]),
        ...Object.fromEntries(energies.map((card) => [card.definitionId, water])),
      },
    };

    const result = runEngineAutoPlay(state, { maxTurns: 5, maxActions: 20 });
    expect(result.stalled).toBe(false);
    expect(result.state.pendingAction).toBeNull();
    expect(getPlayer(result.state, PlayerId.P1).active!.attachedEnergy).toHaveLength(2);
  });

  it("builds a 60-card corpus deck from a tournament list", () => {
    const preset = TOURNAMENT_535_TOP16.decks[1];
    const deck = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
    expect(deck.resolveErrors).toEqual([]);
    expect(deck.cards).toHaveLength(60);
    expect(deck.validation.valid).toBe(true);
    expect(deck.cards.some((card) => card.name === "Dragapult ex")).toBe(true);
    expect(deck.cards.some((card) => card.name === "Lillie's Determination")).toBe(true);
  });

  it("auto-setups a match from Tournament Dragapult mirror decks", () => {
    const preset = getTournamentDeckById("utrecht-2-hasan-kunukcu")!;
    const deck = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
    let state = beginMatchFromBuiltDecks({
      player1Name: "P1",
      player2Name: "P2",
      player1Deck: deck,
      player2Deck: deck,
      seed: 42,
    });
    state = autoSetupEngineState(state, { seed: 42 });
    expect(state.phase).toBe(GamePhase.Active);
    expect(getPlayer(state, PlayerId.P1).active).toBeTruthy();
    expect(getPlayer(state, PlayerId.P2).active).toBeTruthy();
    expect(getPlayer(state, PlayerId.P1).prizes).toHaveLength(6);
    expect(getPlayer(state, PlayerId.P1).deck.length + getPlayer(state, PlayerId.P1).hand.length).toBeGreaterThan(0);
  });

  it("runs auto-play through setup for Dragapult vs Lopunny", async () => {
    const dragapult = getTournamentDeckById("utrecht-2-hasan-kunukcu")!;
    const lopunny = getTournamentDeckById("utrecht-1-miloslav-posledni")!;
    const result = await runTournamentPresetMatch(dragapult, lopunny, {
      seed: 7,
      run: { maxTurns: 15, maxActions: 120 },
    });
    expect(result.resolveErrors).toEqual([]);
    expect(result.setupComplete).toBe(true);
    expect(result.actionCount).toBeGreaterThan(0);
    expect([GamePhase.Active, GamePhase.Finished]).toContain(result.state.phase);
  });

  it("runs a full mirror match from built corpus decks", () => {
    const preset = getTournamentDeckById("utrecht-16-fabian-kern")!;
    const deck = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
    const result = runMatchFromBuiltDecks(
      {
        player1Name: "P1",
        player2Name: "P2",
        player1Deck: deck,
        player2Deck: deck,
        seed: 99,
      },
      {},
      { maxTurns: 20, maxActions: 160 },
    );
    expect(result.setupComplete).toBe(true);
    expect(result.resolveErrors).toEqual([]);
    expect(result.actionCount).toBeGreaterThan(0);
  });

  it("uses Mystery Garden when discarding Energy draws multiple cards", () => {
    const psychic = mockBasic("Abra", "60", ["Psychic"]);
    const energy = mockEnergy("Psychic Energy", ["Psychic"]);
    const filler = mockBasic("Filler", "60", ["Colorless"]);
    const stadiumDef: CardDefinition = {
      apiId: "Mystery Garden",
      name: "Mystery Garden",
      supertype: "Trainer",
      subtypes: ["Stadium"],
      rules: [],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);
    const active = createCardInstance("psy-0", PlayerId.P1, Zone.Active);
    const bench = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(`psy-${index + 1}`, PlayerId.P1, Zone.Bench),
    );
    const hand = [
      createCardInstance("hand-energy", PlayerId.P1, Zone.Hand),
      createCardInstance("hand-filler-1", PlayerId.P1, Zone.Hand),
      createCardInstance("hand-filler-2", PlayerId.P1, Zone.Hand),
    ];
    const deckCards = Array.from({ length: 8 }, (_, index) =>
      createCardInstance(`deck-${index}`, PlayerId.P1, Zone.Deck),
    );

    const state: EngineState = {
      ...mirrorMatchState(),
      stadium,
      stadiumOwnerId: PlayerId.P1,
      players: {
        ...mirrorMatchState().players,
        [PlayerId.P1]: {
          ...mirrorMatchState().players[PlayerId.P1],
          active,
          bench,
          hand,
          deck: deckCards,
        },
      },
      definitions: {
        stadium: stadiumDef,
        "psy-0": psychic,
        "psy-1": psychic,
        "psy-2": psychic,
        "psy-3": psychic,
        "hand-energy": energy,
        "hand-filler-1": filler,
        "hand-filler-2": filler,
        ...Object.fromEntries(deckCards.map((card) => [card.definitionId, filler])),
      },
    };

    const action = pickAutoStadiumAction(state, PlayerId.P1);
    expect(action).toEqual({ type: "USE_MYSTERY_GARDEN", playerId: PlayerId.P1 });
  });

  it("defers Lumiose City when the active Pokémon can already attack", () => {
    const lumioseDef: CardDefinition = {
      apiId: "Lumiose City",
      name: "Lumiose City",
      supertype: "Trainer",
      subtypes: ["Stadium"],
      rules: [],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const basic = mockBasic("Pikachu", "60", ["Lightning"], [
      { name: "Shock", cost: ["Lightning"], convertedEnergyCost: 1, damage: "20", text: "" },
    ]);
    const energy = mockEnergy("Lightning Energy", ["Lightning"]);
    const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);
    const active = createCardInstance("active", PlayerId.P1, Zone.Active);
    const attached = createCardInstance("energy", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [attached];
    const deckBasic = createCardInstance("deck-basic", PlayerId.P1, Zone.Deck);

    const state: EngineState = {
      ...mirrorMatchState(),
      stadium,
      stadiumOwnerId: PlayerId.P1,
      players: {
        ...mirrorMatchState().players,
        [PlayerId.P1]: {
          ...mirrorMatchState().players[PlayerId.P1],
          active,
          bench: [createCardInstance("bench", PlayerId.P1, Zone.Bench)],
          deck: [deckBasic],
        },
      },
      definitions: {
        stadium: lumioseDef,
        active: basic,
        bench: basic,
        energy: energy,
        "deck-basic": basic,
      },
    };

    expect(pickAutoStadiumAction(state, PlayerId.P1)).toBeNull();
  });

  it("uses Community Center when Supporter was played and Pokémon are damaged", () => {
    const communityDef: CardDefinition = {
      apiId: "Community Center",
      name: "Community Center",
      supertype: "Trainer",
      subtypes: ["Stadium"],
      rules: [],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const pokemon = mockBasic("Damagedmon", "120", ["Colorless"]);
    const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);
    const active = createCardInstance("active", PlayerId.P1, Zone.Active);
    active.damageCounters = 30;

    const state: EngineState = {
      ...mirrorMatchState(),
      stadium,
      stadiumOwnerId: PlayerId.P1,
      turnFlags: { ...emptyTurnFlags(), supporterPlayed: true },
      players: {
        ...mirrorMatchState().players,
        [PlayerId.P1]: {
          ...mirrorMatchState().players[PlayerId.P1],
          active,
        },
      },
      definitions: {
        stadium: communityDef,
        active: pokemon,
      },
    };

    expect(pickAutoStadiumAction(state, PlayerId.P1)).toEqual({
      type: "USE_COMMUNITY_CENTER",
      playerId: PlayerId.P1,
    });
  });

  it("prefers discarding duplicate Basic Energy over Special Energy for Mystery Garden", () => {
    const psychic = mockBasic("Abra", "60", ["Psychic"]);
    const basicEnergy = mockEnergy("Psychic Energy", ["Psychic"]);
    const specialEnergy: CardDefinition = {
      apiId: "Magnetic Metal Energy",
      name: "Magnetic Metal Energy",
      supertype: "Energy",
      subtypes: ["Special"],
      types: ["Metal"],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const duplicateBasic = createCardInstance("energy-1", PlayerId.P1, Zone.Hand);
    const duplicateBasic2 = createCardInstance("energy-2", PlayerId.P1, Zone.Hand);
    const special = createCardInstance("special", PlayerId.P1, Zone.Hand);

    const state: EngineState = {
      ...mirrorMatchState(),
      players: {
        ...mirrorMatchState().players,
        [PlayerId.P1]: {
          ...mirrorMatchState().players[PlayerId.P1],
          hand: [duplicateBasic, duplicateBasic2, special],
        },
      },
      definitions: {
        ...mirrorMatchState().definitions,
        "energy-1": basicEnergy,
        "energy-2": basicEnergy,
        special: specialEnergy,
        active: psychic,
      },
    };

    expect(scoreHandCardKeepValue(state, PlayerId.P1, duplicateBasic.instanceId)).toBeLessThan(
      scoreHandCardKeepValue(state, PlayerId.P1, special.instanceId),
    );
  });

  it("prefers discarding filler cards over evolution lines for Prism Tower", () => {
    const filler = mockBasic("Filler", "60", ["Colorless"]);
    const stage2: CardDefinition = {
      ...mockBasic("Alakazam", "140", ["Psychic"]),
      subtypes: ["Stage 2"],
      evolvesFrom: "Kadabra",
    };
    const handFiller = createCardInstance("filler", PlayerId.P1, Zone.Hand);
    const handStage2 = createCardInstance("stage2", PlayerId.P1, Zone.Hand);

    const state: EngineState = {
      ...mirrorMatchState(),
      players: {
        ...mirrorMatchState().players,
        [PlayerId.P1]: {
          ...mirrorMatchState().players[PlayerId.P1],
          hand: [handFiller, handStage2],
        },
      },
      definitions: {
        ...mirrorMatchState().definitions,
        filler: filler,
        stage2: stage2,
      },
    };

    expect(scoreHandCardKeepValue(state, PlayerId.P1, handFiller.instanceId)).toBeLessThan(
      scoreHandCardKeepValue(state, PlayerId.P1, handStage2.instanceId),
    );
  });
});
