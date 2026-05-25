import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { runPokemonCheckup, onKnockOut } from "./abilityHooks";
import { executeEffects } from "./execute";
import { parseAbilityText, parseAttackText } from "./parseText";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  abilities: CardDefinition["abilities"] = [],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    abilities,
    attacks,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Water"]): CardDefinition {
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
  const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
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
        active: null,
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
        active: p2Active,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      "p2-active": mockBasic("Defender", "200", ["Water"]),
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

describe("CRI Phase 3 — Flygon Sandy Flapping", () => {
  const sandyText =
    "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon. Discard the top 2 cards of your opponent's deck.";

  it("parses Sandy Flapping KO trigger and mill effect", () => {
    const parsed = parseAbilityText({ name: "Sandy Flapping", type: "Ability", text: sandyText });
    expect(parsed.effects).toEqual(
      expect.arrayContaining([
        { kind: "evolve_trigger_ability" },
        { kind: "active_ko_by_attack_trigger" },
        { kind: "mill_opponent_deck", count: 2 },
      ]),
    );
    expect(parsed.effects.some((effect) => effect.kind === "generic_effect_stub")).toBe(false);
  });

  it("mills 2 cards from the attacker's deck when Flygon Active is KO'd by attack", () => {
    const flygonDef = mockBasic("Flygon", "150", ["Fighting"], [
      { name: "Sandy Flapping", type: "Ability", text: sandyText },
    ]);
    const flygon = createCardInstance("flygon", PlayerId.P2, Zone.Active);
    const deckCards = ["deck-1", "deck-2", "deck-3"].map((id) =>
      createCardInstance(id, PlayerId.P1, Zone.Deck),
    );
    const base = battleState();

    const state = battleState({
      currentPlayerId: PlayerId.P1,
      turnFlags: { ...emptyTurnFlags(), attacked: true },
      definitions: {
        ...base.definitions,
        flygon: flygonDef,
        "deck-1": mockBasic("Deck Card 1"),
        "deck-2": mockBasic("Deck Card 2"),
        "deck-3": mockBasic("Deck Card 3"),
      },
      players: {
        ...base.players,
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: flygon,
        },
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          deck: deckCards,
        },
      },
    });

    onKnockOut(state, flygon, PlayerId.P1);
    expect(getPlayer(state, PlayerId.P1).deck).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(2);
  });

  it("does not mill when Flygon is KO'd outside of an attack", () => {
    const flygonDef = mockBasic("Flygon", "150", ["Fighting"], [
      { name: "Sandy Flapping", type: "Ability", text: sandyText },
    ]);
    const flygon = createCardInstance("flygon", PlayerId.P2, Zone.Active);
    const deckCards = ["deck-1", "deck-2"].map((id) =>
      createCardInstance(id, PlayerId.P1, Zone.Deck),
    );
    const base = battleState();

    const state = battleState({
      currentPlayerId: PlayerId.P1,
      turnFlags: { ...emptyTurnFlags(), attacked: false },
      definitions: {
        ...base.definitions,
        flygon: flygonDef,
        "deck-1": mockBasic("Deck Card 1"),
        "deck-2": mockBasic("Deck Card 2"),
      },
      players: {
        ...base.players,
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: flygon,
        },
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          deck: deckCards,
        },
      },
    });

    onKnockOut(state, flygon, PlayerId.P1);
    expect(getPlayer(state, PlayerId.P1).deck).toHaveLength(2);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(0);
  });
});

describe("CRI Phase 3 — Mega Floette ex Eternity Bloom", () => {
  const attackText =
    "Search your deck for up to 4 Basic Psychic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.";

  it("parses Eternity Bloom search-and-attach Psychic Energy", () => {
    expect(parseAttackText(attackText)).toEqual([
      {
        kind: "search_attach_energy_typed",
        count: 4,
        energyType: "Psychic",
        target: "benched",
      },
    ]);
  });

  it("attaches Psychic Energy from deck to benched Pokémon", () => {
    const floette = createCardInstance("floette", PlayerId.P1, Zone.Active);
    const benchMon = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    const psychic1 = createCardInstance("psy1", PlayerId.P1, Zone.Deck);
    const psychic2 = createCardInstance("psy2", PlayerId.P1, Zone.Deck);
    const filler = createCardInstance("filler", PlayerId.P1, Zone.Deck);
    const base = battleState();

    const state = battleState({
      definitions: {
        ...base.definitions,
        floette: mockBasic("Mega Floette ex", "380", ["Psychic"]),
        bench: mockBasic("Bench Mon", "70", ["Psychic"]),
        psy1: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        psy2: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        filler: mockBasic("Filler", "50"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: floette,
          bench: [benchMon],
          deck: [psychic1, psychic2, filler],
        },
      },
    });

    executeEffects(
      state,
      { playerId: PlayerId.P1, sourcePokemon: floette, opponentId: PlayerId.P2 },
      parseAttackText(attackText),
    );

    expect(getPlayer(state, PlayerId.P1).bench[0]!.attachedEnergy).toHaveLength(2);
    expect(getPlayer(state, PlayerId.P1).deck).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).deck[0]!.definitionId).toBe("filler");
  });
});

describe("CRI Phase 3 — Sudowoodo Rock Hurl", () => {
  const attackText = "This attack's damage isn't affected by Resistance.";

  it("parses Rock Hurl ignore-resistance modifier", () => {
    expect(parseAttackText(attackText)).toEqual([{ kind: "ignore_resistance" }]);
  });

  it("Rock Hurl deals full damage through Fighting Resistance", () => {
    const sudowoodoDef = mockBasic("Sudowoodo", "110", ["Fighting"], [], [
      {
        name: "Rock Hurl",
        cost: ["Colorless"],
        convertedEnergyCost: 1,
        damage: "30",
        text: attackText,
      },
    ]);
    const defenderDef: CardDefinition = {
      ...mockBasic("Metal Defender", "200", ["Metal"]),
      resistances: [{ type: "Fighting", value: "-30" }],
    };
    const sudowoodo = createCardInstance("sudowoodo", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("energy", PlayerId.P1, Zone.Active);
    sudowoodo.attachedEnergy = [energy];
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        sudowoodo: sudowoodoDef,
        energy: mockEnergy("Basic Colorless Energy", ["Colorless"]),
        "p2-active": defenderDef,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: sudowoodo,
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: p2Active,
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Rock Hurl" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(30);
  });
});

describe("CRI — Mega Floette ex Gentle Light", () => {
  const attackText = "Heal 30 damage from each Pokémon (both yours and your opponent's).";

  it("parses Gentle Light as heal all_in_play", () => {
    expect(parseAttackText(attackText)).toEqual([
      { kind: "heal", amount: 30, target: "all_in_play" },
    ]);
  });

  it("heals 30 damage from every Pokémon in play", () => {
    const floette = createCardInstance("floette", PlayerId.P1, Zone.Active);
    floette.damageCounters = 60;
    const bench = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    bench.damageCounters = 40;
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    p2Active.damageCounters = 80;
    const base = battleState();

    const state = battleState({
      definitions: {
        ...base.definitions,
        floette: mockBasic("Mega Floette ex", "380", ["Psychic"], [], [
          { name: "Gentle Light", cost: [], convertedEnergyCost: 0, damage: "", text: attackText },
        ]),
        bench: mockBasic("Bench Mon", "70"),
        "p2-active": mockBasic("Defender", "200"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: floette, bench: [bench] },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], active: p2Active },
      },
    });

    executeEffects(
      state,
      { playerId: PlayerId.P1, sourcePokemon: floette, opponentId: PlayerId.P2 },
      parseAttackText(attackText),
    );

    expect(getPlayer(state, PlayerId.P1).active!.damageCounters).toBe(30);
    expect(getPlayer(state, PlayerId.P1).bench[0]!.damageCounters).toBe(10);
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(50);
  });
});

describe("CRI — Mega Pyroar ex Ferocious Bellow", () => {
  const attackText =
    "During your opponent's next turn, attacks used by the Defending Pokémon do 50 less damage (before applying Weakness and Resistance).";

  it("parses Ferocious Bellow as defending_attack_damage_reduction", () => {
    expect(parseAttackText(attackText)).toEqual([
      { kind: "defending_attack_damage_reduction", amount: 50 },
    ]);
  });

  it("Ferocious Bellow sets damageReductionPending on opponent's active", () => {
    const pyroarDef = mockBasic("Mega Pyroar ex", "330", ["Fire"], [], [
      { name: "Ferocious Bellow", cost: ["Fire"], convertedEnergyCost: 1, damage: "80", text: attackText },
    ]);
    const pyroar = createCardInstance("pyroar", PlayerId.P1, Zone.Active);
    const fireEnergy = createCardInstance("fire", PlayerId.P1, Zone.Active);
    pyroar.attachedEnergy = [fireEnergy];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        pyroar: pyroarDef,
        fire: mockEnergy("Basic Fire Energy", ["Fire"]),
        "p2-active": mockBasic("Defender", "300", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: pyroar },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Ferocious Bellow" });
    expect(getPlayer(state, PlayerId.P2).active!.damageReductionPending).toBe(50);
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(80);
  });
});

describe("CRI — Mega Pyroar ex Fiery Big Bang", () => {
  const attackText = "This attack does 10 less damage for each damage counter on this Pokémon.";

  it("parses Fiery Big Bang as damage_less_per_self_counter", () => {
    expect(parseAttackText(attackText)).toEqual([
      { kind: "damage_less_per_self_counter", perCounter: 10 },
    ]);
  });

  it("Fiery Big Bang deals full 290 when attacker is undamaged", () => {
    const pyroarDef = mockBasic("Mega Pyroar ex", "330", ["Fire"], [], [
      { name: "Fiery Big Bang", cost: ["Fire", "Fire", "Fire"], convertedEnergyCost: 3, damage: "290-", text: attackText },
    ]);
    const pyroar = createCardInstance("pyroar", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    const energy3 = createCardInstance("e3", PlayerId.P1, Zone.Active);
    pyroar.attachedEnergy = [energy1, energy2, energy3];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        pyroar: pyroarDef,
        e1: mockEnergy("Basic Fire Energy", ["Fire"]),
        e2: mockEnergy("Basic Fire Energy", ["Fire"]),
        e3: mockEnergy("Basic Fire Energy", ["Fire"]),
        "p2-active": mockBasic("Defender", "400", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: pyroar },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Fiery Big Bang" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(290);
  });

  it("Fiery Big Bang reduces damage by 10 per counter on self (3 counters → 30 less)", () => {
    const pyroarDef = mockBasic("Mega Pyroar ex", "330", ["Fire"], [], [
      { name: "Fiery Big Bang", cost: ["Fire", "Fire", "Fire"], convertedEnergyCost: 3, damage: "290-", text: attackText },
    ]);
    const pyroar = createCardInstance("pyroar", PlayerId.P1, Zone.Active);
    pyroar.damageCounters = 30;
    const energy1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    const energy3 = createCardInstance("e3", PlayerId.P1, Zone.Active);
    pyroar.attachedEnergy = [energy1, energy2, energy3];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        pyroar: pyroarDef,
        e1: mockEnergy("Basic Fire Energy", ["Fire"]),
        e2: mockEnergy("Basic Fire Energy", ["Fire"]),
        e3: mockEnergy("Basic Fire Energy", ["Fire"]),
        "p2-active": mockBasic("Defender", "400", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: pyroar },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Fiery Big Bang" });
    // 290 base - (3 counters × 10) = 260
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(260);
  });
});

describe("CRI — Mega Dragalge ex Pernicious Poison", () => {
  const attackText =
    "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1.";

  it("parses Pernicious Poison as status + poison_enhanced_checkup", () => {
    const effects = parseAttackText(attackText);
    expect(effects.some((e) => e.kind === "status" && (e as { status: string }).status === "Poisoned")).toBe(true);
    expect(effects.some((e) => e.kind === "poison_enhanced_checkup" && (e as { counters: number }).counters === 16)).toBe(true);
  });

  it("Pernicious Poison applies Poisoned status with 16 counters per checkup", () => {
    const dragalgeDef = mockBasic("Mega Dragalge ex", "330", ["Poison"], [], [
      { name: "Pernicious Poison", cost: ["Psychic", "Colorless"], convertedEnergyCost: 2, damage: "", text: attackText },
    ]);
    const dragalge = createCardInstance("dragalge", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    dragalge.attachedEnergy = [e1, e2];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        dragalge: dragalgeDef,
        e1: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        e2: mockEnergy("Basic Colorless Energy", ["Colorless"]),
        "p2-active": mockBasic("Defender", "300", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: dragalge },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Pernicious Poison" });
    const p2Active = getPlayer(state, PlayerId.P2).active!;
    expect(p2Active.statusConditions).toContain("Poisoned");
    expect(p2Active.poisonCounters).toBe(16);
  });

  it("Pernicious Poison checkup applies 160 damage (16 counters × 10)", () => {
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    p2Active.statusConditions = ["Poisoned"];
    p2Active.poisonCounters = 16;
    const base = battleState();

    const state = battleState({
      definitions: { ...base.definitions, "p2-active": mockBasic("Defender", "300") },
      players: {
        ...base.players,
        [PlayerId.P2]: { ...base.players[PlayerId.P2], active: p2Active },
      },
    });

    runPokemonCheckup(state);
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(160);
  });
});

describe("CRI — Mega Dragalge ex Corrosive Liquid", () => {
  const attackText =
    "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon.";

  it("parses Corrosive Liquid as discard_opponent_tools + discard_special_energy_opponent_all", () => {
    const effects = parseAttackText(attackText);
    expect(effects.some((e) => e.kind === "discard_opponent_tools")).toBe(true);
    expect(effects.some((e) => e.kind === "discard_special_energy_opponent_all")).toBe(true);
  });

  it("Corrosive Liquid discards Special Energy from all opponent Pokémon", () => {
    const dragalgeDef = mockBasic("Mega Dragalge ex", "330", ["Poison"], [], [
      { name: "Corrosive Liquid", cost: ["Psychic"], convertedEnergyCost: 1, damage: "", text: attackText },
    ]);
    const specialEnergyDef: CardDefinition = {
      apiId: "enriching",
      name: "Enriching Energy",
      supertype: "Energy",
      subtypes: ["Special"],
      types: ["Colorless"],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };

    const dragalge = createCardInstance("dragalge", PlayerId.P1, Zone.Active);
    const cost = createCardInstance("cost-e", PlayerId.P1, Zone.Active);
    dragalge.attachedEnergy = [cost];
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    // Use definitionId "enriching" so the definition lookup succeeds
    const specialE1 = createCardInstance("enriching", PlayerId.P2, Zone.Active);
    const specialE2 = createCardInstance("enriching", PlayerId.P2, Zone.Bench);
    const p2Bench = createCardInstance("p2-bench", PlayerId.P2, Zone.Bench);
    p2Active.attachedEnergy = [specialE1];
    p2Bench.attachedEnergy = [specialE2];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        dragalge: dragalgeDef,
        "cost-e": mockEnergy("Basic Psychic Energy", ["Psychic"]),
        "p2-active": mockBasic("Defender", "300"),
        "p2-bench": mockBasic("Bench Mon", "200"),
        enriching: specialEnergyDef,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: dragalge },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], active: p2Active, bench: [p2Bench] },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Corrosive Liquid" });
    expect(getPlayer(state, PlayerId.P2).active!.attachedEnergy).toHaveLength(0);
    expect(getPlayer(state, PlayerId.P2).bench[0]!.attachedEnergy).toHaveLength(0);
    expect(getPlayer(state, PlayerId.P2).discard).toHaveLength(2);
  });
});

describe("CRI — Mega Gallade ex Gale Slash", () => {
  const attackText = "If this Pokémon has no damage counters on it, this attack does 150 more damage.";

  it("parses Gale Slash as damage_bonus_if_self_undamaged", () => {
    expect(parseAttackText(attackText)).toEqual([
      { kind: "damage_bonus_if_self_undamaged", amount: 150 },
    ]);
  });

  it("Gale Slash deals 200 (50+150) when attacker has no damage counters", () => {
    const galladeDef = mockBasic("Mega Gallade ex", "330", ["Psychic"], [], [
      { name: "Gale Slash", cost: ["Psychic", "Colorless"], convertedEnergyCost: 2, damage: "50+", text: attackText },
    ]);
    const gallade = createCardInstance("gallade", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    gallade.attachedEnergy = [e1, e2];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        gallade: galladeDef,
        e1: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        e2: mockEnergy("Basic Colorless Energy", ["Colorless"]),
        "p2-active": mockBasic("Defender", "300", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: gallade },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Gale Slash" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(200);
  });

  it("Gale Slash deals only 50 when attacker is damaged", () => {
    const galladeDef = mockBasic("Mega Gallade ex", "330", ["Psychic"], [], [
      { name: "Gale Slash", cost: ["Psychic", "Colorless"], convertedEnergyCost: 2, damage: "50+", text: attackText },
    ]);
    const gallade = createCardInstance("gallade", PlayerId.P1, Zone.Active);
    gallade.damageCounters = 60;
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    gallade.attachedEnergy = [e1, e2];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        gallade: galladeDef,
        e1: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        e2: mockEnergy("Basic Colorless Energy", ["Colorless"]),
        "p2-active": mockBasic("Defender", "300", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: gallade },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Gale Slash" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(50);
  });
});

describe("CRI — Mega Gallade ex Marvelous Edge", () => {
  it("Marvelous Edge deals 240 flat damage", () => {
    const galladeDef = mockBasic("Mega Gallade ex", "330", ["Psychic"], [], [
      {
        name: "Marvelous Edge",
        cost: ["Psychic", "Psychic", "Psychic", "Colorless"],
        convertedEnergyCost: 4,
        damage: "240",
        text: "",
      },
    ]);
    const gallade = createCardInstance("gallade", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    const e3 = createCardInstance("e3", PlayerId.P1, Zone.Active);
    const e4 = createCardInstance("e4", PlayerId.P1, Zone.Active);
    gallade.attachedEnergy = [e1, e2, e3, e4];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        gallade: galladeDef,
        e1: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        e2: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        e3: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        e4: mockEnergy("Basic Colorless Energy", ["Colorless"]),
        "p2-active": mockBasic("Defender", "400", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: gallade },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Marvelous Edge" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(240);
  });
});
