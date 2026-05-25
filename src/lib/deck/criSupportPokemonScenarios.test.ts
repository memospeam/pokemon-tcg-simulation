/**
 * Behavioral tests for non-Mega support Pokémon used in CRI playtest decks.
 * Covers: Fezandipiti ex, Dunsparce, Kirlia/Frogadier, Froakie/Ralts (Collect),
 * Enriching Energy, and verifies parse correctness for all remaining attacks.
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { parseAttackText } from "../engine/effects/parseText";
import { gameReducer } from "../engine/reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import { getCriDeckById } from "./criDeckPresets";

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

function mockSpecialEnergy(name: string, apiId: string): CardDefinition {
  return {
    apiId,
    name,
    supertype: "Energy",
    subtypes: ["Special"],
    types: ["Colorless"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockBasicEnergy(name: string, apiId: string, types: string[]): CardDefinition {
  return {
    apiId,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    types,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function baseState(overrides: Partial<EngineState> = {}): EngineState {
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
      "p2-active": mockBasic("Defender", "200"),
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

// ── Attack text parse verification ──────────────────────────────────────────

describe("CRI support Pokémon — attack text parsing", () => {
  it("Cruel Arrow → damage_choose_opponent (100, applyWeaknessRes: false for benched)", () => {
    const effects = parseAttackText(
      "This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    const dmg = effects.find((e) => e.kind === "damage_choose_opponent") as
      | { amount: number; applyWeaknessRes: boolean }
      | undefined;
    expect(dmg).toBeDefined();
    expect(dmg?.amount).toBe(100);
    expect(dmg?.applyWeaknessRes).toBe(false);
  });

  it("Trading Places → switch_with_bench", () => {
    const effects = parseAttackText("Switch this Pokémon with 1 of your Benched Pokémon.");
    expect(effects.some((e) => e.kind === "switch_with_bench")).toBe(true);
  });

  it("Call Sign / Summoning Jutsu → search_pokemon_to_hand count 3", () => {
    const effects = parseAttackText(
      "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    );
    const found = effects.find((e) => e.kind === "search_pokemon_to_hand") as
      | { count: number }
      | undefined;
    expect(found?.count).toBe(3);
  });

  it("Collect → draw count 1", () => {
    const effects = parseAttackText("Draw a card.");
    const found = effects.find((e) => e.kind === "draw") as
      | { count: number; target: string }
      | undefined;
    expect(found?.count).toBe(1);
    expect(found?.target).toBe("self");
  });

  it("Itchy Pollen → block_opponent_items_next_turn", () => {
    const effects = parseAttackText(
      "During your opponent's next turn, they can't play any Item cards from their hand.",
    );
    expect(effects.some((e) => e.kind === "block_opponent_items_next_turn")).toBe(true);
  });

  it("Mind Bend → status Confused on opponent's active", () => {
    const effects = parseAttackText("Your opponent's Active Pokémon is now Confused.");
    expect(
      effects.some(
        (e) =>
          e.kind === "status" &&
          (e as { status: string }).status === "Confused" &&
          (e as { target: string }).target === "opponent_active",
      ),
    ).toBe(true);
  });
});

// ── Fezandipiti ex — Cruel Arrow ─────────────────────────────────────────────

describe("Fezandipiti ex — Cruel Arrow", () => {
  const attackText =
    "This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

  it("Cruel Arrow sets DAMAGE_TWO_OPPONENT pending when opponent has bench", () => {
    const fezDef = mockBasic("Fezandipiti ex", "210", ["Darkness"], [
      { name: "Cruel Arrow", cost: ["Darkness", "Colorless"], convertedEnergyCost: 2, damage: "", text: attackText },
    ]);
    const fez = createCardInstance("fez", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    fez.attachedEnergy = [e1, e2];
    const p2Bench = createCardInstance("p2-bench", PlayerId.P2, Zone.Bench);
    const base = baseState();

    let state = baseState({
      definitions: {
        ...base.definitions,
        fez: fezDef,
        e1: mockBasicEnergy("Basic Darkness Energy", "e1", ["Darkness"]),
        e2: mockBasicEnergy("Basic Colorless Energy", "e2", ["Colorless"]),
        "p2-bench": mockBasic("Bench Target", "200"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: fez },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], bench: [p2Bench] },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Cruel Arrow" });
    expect(state.pendingAction?.type).toBe("DAMAGE_TWO_OPPONENT");

    state = gameReducer(state, {
      type: "CHOOSE_OPPONENT_DAMAGE",
      playerId: PlayerId.P1,
      targetId: p2Bench.instanceId,
    });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P2).bench[0]!.damageCounters).toBe(100);
  });

  it("Cruel Arrow auto-targets Active when opponent has no bench (100 damage)", () => {
    const fezDef = mockBasic("Fezandipiti ex", "210", ["Darkness"], [
      { name: "Cruel Arrow", cost: ["Darkness", "Colorless"], convertedEnergyCost: 2, damage: "", text: attackText },
    ]);
    const fez = createCardInstance("fez", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    fez.attachedEnergy = [e1, e2];
    const base = baseState();

    let state = baseState({
      definitions: {
        ...base.definitions,
        fez: fezDef,
        e1: mockBasicEnergy("Basic Darkness Energy", "e1", ["Darkness"]),
        e2: mockBasicEnergy("Basic Colorless Energy", "e2", ["Colorless"]),
        "p2-active": mockBasic("Defender", "200"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: fez },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Cruel Arrow" });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(100);
  });
});

// ── Dunsparce JTG — Trading Places ──────────────────────────────────────────

describe("Dunsparce JTG — Trading Places", () => {
  const attackText = "Switch this Pokémon with 1 of your Benched Pokémon.";

  it("Trading Places creates SWITCH_WITH_BENCH pending", () => {
    const dunsparce = createCardInstance("dunsparce", PlayerId.P1, Zone.Active);
    const bench = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    const base = baseState();

    const dunsparce_def = mockBasic("Dunsparce", "60", ["Colorless"], [
      { name: "Trading Places", cost: [], convertedEnergyCost: 0, damage: "", text: attackText },
    ]);

    let state = baseState({
      definitions: {
        ...base.definitions,
        dunsparce: dunsparce_def,
        bench: mockBasic("Bench Mon", "70"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: dunsparce, bench: [bench] },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Trading Places" });
    expect(state.pendingAction?.type).toBe("SWITCH_WITH_BENCH");

    state = gameReducer(state, {
      type: "SWITCH_WITH_BENCH",
      playerId: PlayerId.P1,
      benchInstanceId: bench.instanceId,
    });
    expect(state.pendingAction).toBeNull();
    // Former bench Pokémon is now active
    expect(getPlayer(state, PlayerId.P1).active!.instanceId).toBe(bench.instanceId);
    // Dunsparce moved to bench
    expect(getPlayer(state, PlayerId.P1).bench.some((p) => p.instanceId === dunsparce.instanceId)).toBe(true);
  });
});

// ── Kirlia / Frogadier — Call Sign / Summoning Jutsu ────────────────────────

describe("Kirlia / Frogadier — Call Sign / Summoning Jutsu", () => {
  const callSignText =
    "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";

  it("Call Sign creates SEARCH_DECK pending for up to 3 Pokémon", () => {
    const kirlia = createCardInstance("kirlia", PlayerId.P1, Zone.Active);
    const psychicE = createCardInstance("psychic", PlayerId.P1, Zone.Active);
    kirlia.attachedEnergy = [psychicE];
    const deckPoke1 = createCardInstance("ralts", PlayerId.P1, Zone.Deck);
    const deckPoke2 = createCardInstance("kirlia", PlayerId.P1, Zone.Deck);
    const energyCard = createCardInstance("energy", PlayerId.P1, Zone.Deck);
    const base = baseState();

    const kirliaDef = mockBasic("Kirlia", "80", ["Psychic"], [
      { name: "Call Sign", cost: ["Psychic"], convertedEnergyCost: 1, damage: "", text: callSignText },
    ]);

    let state = baseState({
      definitions: {
        ...base.definitions,
        kirlia: kirliaDef,
        ralts: mockBasic("Ralts", "60", ["Psychic"]),
        psychic: mockBasicEnergy("Basic Psychic Energy", "psychic", ["Psychic"]),
        energy: mockBasicEnergy("Basic Psychic Energy", "energy", ["Psychic"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: kirlia,
          deck: [deckPoke1, deckPoke2, energyCard],
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Call Sign" });
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
    const pending = state.pendingAction as { options: string[]; slotsRemaining: number };
    // Only the 2 Pokémon cards (not the energy) should be in options
    expect(pending.options).toContain(deckPoke1.instanceId);
    expect(pending.options).toContain(deckPoke2.instanceId);
    expect(pending.options).not.toContain(energyCard.instanceId);
    // slotsRemaining is capped at available Pokémon count (2), not the attack's requested 3
    expect(pending.slotsRemaining).toBe(2);

    state = gameReducer(state, {
      type: "PICK_DECK_CARD",
      playerId: PlayerId.P1,
      instanceId: deckPoke1.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).hand.some((c) => c.instanceId === deckPoke1.instanceId)).toBe(true);
  });
});

// ── Froakie / Ralts — Collect ────────────────────────────────────────────────

describe("Froakie / Ralts — Collect", () => {
  it("Collect draws 1 card from deck", () => {
    const froakie = createCardInstance("froakie", PlayerId.P1, Zone.Active);
    const deckCard = createCardInstance("energy", PlayerId.P1, Zone.Deck);
    const base = baseState();

    const froakieDef = mockBasic("Froakie", "60", ["Water"], [
      { name: "Collect", cost: [], convertedEnergyCost: 0, damage: "", text: "Draw a card." },
    ]);

    let state = baseState({
      definitions: {
        ...base.definitions,
        froakie: froakieDef,
        energy: mockBasicEnergy("Basic Water Energy", "energy", ["Water"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: froakie, deck: [deckCard] },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Collect" });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).hand[0]!.instanceId).toBe(deckCard.instanceId);
  });
});

// ── Enriching Energy ─────────────────────────────────────────────────────────

describe("Enriching Energy — draw 4 on attach", () => {
  it("attaching Enriching Energy draws 4 cards for the owner", () => {
    const greninjaPreset = getCriDeckById("cri-greninja-water")!;
    const deck = buildPlaytestDeckFromCorpusText(greninjaPreset.label, greninjaPreset.text);

    const enrichingDef = [...deck.definitions.values()].find((d) => d.name === "Enriching Energy");
    expect(enrichingDef).toBeDefined();

    const froakieDef = [...deck.definitions.values()].find((d) => d.name === "Froakie")!;
    const fillerDef = [...deck.definitions.values()].find((d) => d.supertype === "Energy" && d.name !== "Enriching Energy")!;

    const definitions = Object.fromEntries([...deck.definitions.values()].map((d) => [d.apiId, d]));

    const enriching = createCardInstance(enrichingDef!.apiId, PlayerId.P1, Zone.Hand);
    const active = createCardInstance(froakieDef.apiId, PlayerId.P1, Zone.Active);
    const deckCards = Array.from({ length: 6 }, () =>
      createCardInstance(fillerDef.apiId, PlayerId.P1, Zone.Deck),
    );

    let state: EngineState = {
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
          hand: [enriching],
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
          active: createCardInstance(froakieDef.apiId, PlayerId.P2, Zone.Active),
          bench: [],
          prizes: [],
          discard: [],
          lostZone: [],
        },
      },
      stadium: null,
      stadiumOwnerId: null,
      definitions,
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

    state = gameReducer(state, {
      type: "ATTACH_ENERGY",
      playerId: PlayerId.P1,
      energyId: enriching.instanceId,
      targetId: active.instanceId,
    });

    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(4);
    expect(getPlayer(state, PlayerId.P1).active!.attachedEnergy).toHaveLength(1);
  });
});
