import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import {
  applyAttackDamagePhase,
  applyCopiedBenchAttack,
  computePreDamageBonus,
  finishDiscardSupportersForAttack,
  getExecutableAbilityEffects,
  parseAbilityText,
  parseAttackText,
  resolveDiscardHandSupporterForAttack,
  startAttackIfCopyPending,
  startAttackIfDiscardPending,
} from "./index";
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

function mockSupporter(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Supporter"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function battleState(overrides: Partial<EngineState> = {}): EngineState {
  const active = createCardInstance("active", PlayerId.P1, Zone.Active);
  const p2Deck = Array.from({ length: 8 }, (_, index) =>
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
        deck: [],
        hand: [],
        active,
        bench: [],
        prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: p2Deck,
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
      "p2-active": mockBasic("Defender", "200", ["Water"]),
      ...Object.fromEntries(p2Deck.map((card) => [card.definitionId, deckFiller])),
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

describe("Batch 16 meta gap effects", () => {
  it("Powerful Hand scales damage with hand size", () => {
    const attackText =
      "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.";
    const parsed = parseAttackText(attackText);
    expect(parsed).toEqual([{ kind: "damage_per_self_hand_size", countersPerCard: 2 }]);

    const alakazam = createCardInstance("alakazam", PlayerId.P1, Zone.Active);
    const handCards = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(`hand-${index}`, PlayerId.P1, Zone.Hand),
    );
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        alakazam: mockBasic("Alakazam", "120", ["Psychic"], [
          { name: "Powerful Hand", cost: ["Psychic"], convertedEnergyCost: 1, damage: "", text: attackText },
        ]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: alakazam,
          hand: handCards,
        },
      },
    });

    const bonus = computePreDamageBonus(state, parsed[0]!, PlayerId.P1, alakazam, PlayerId.P2);
    expect(bonus).toBe(80);
    applyAttackDamagePhase(state, PlayerId.P1, "Powerful Hand");
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(80);
  });

  it("Cursed Blast damages any opponent Pokémon then KOs self", () => {
    const abilityText =
      "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.";
    const parsed = parseAbilityText({ name: "Cursed Blast", type: "Ability", text: abilityText });
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      {
        kind: "damage",
        amount: 130,
        target: "opponent_pokemon_choose",
        applyWeaknessRes: false,
      },
    ]);

    const dusknoirDef = mockBasic("Dusknoir", "160", ["Psychic"]);
    dusknoirDef.abilities = [{ name: "Cursed Blast", type: "Ability", text: abilityText }];
    const dusknoir = createCardInstance("dusknoir", PlayerId.P1, Zone.Active);
    const p2Bench = createCardInstance("p2-bench", PlayerId.P2, Zone.Bench);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        active: dusknoirDef,
        dusknoir: dusknoirDef,
        "p2-bench": mockBasic("Bench Target", "90", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: dusknoir,
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          bench: [p2Bench],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: dusknoir.instanceId,
      abilityName: "Cursed Blast",
    });
    expect(state.pendingAction?.type).toBe("CHOOSE_OPPONENT_POKEMON_DAMAGE");

    state = gameReducer(state, {
      type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET",
      playerId: PlayerId.P1,
      targetId: getPlayer(state, PlayerId.P2).active!.instanceId,
    });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(130);
    expect(getPlayer(state, PlayerId.P1).active).toBeNull();
  });

  it("Teal Dance draws after attaching Grass Energy via pending target pick", () => {
    const abilityText =
      "Once during your turn, you may attach a Basic Grass Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, draw a card.";
    const parsed = parseAbilityText({ name: "Teal Dance", type: "Ability", text: abilityText });
    expect(parsed.effects[0]).toMatchObject({
      kind: "attach_basic_energy_from_hand",
      energyType: "Grass",
      drawOnAttach: true,
    });

    const ogerponDef = mockBasic("Teal Mask Ogerpon ex", "210", ["Grass"]);
    ogerponDef.abilities = [{ name: "Teal Dance", type: "Ability", text: abilityText }];
    const ogerpon = createCardInstance("ogerpon", PlayerId.P1, Zone.Active);
    const benchMon = createCardInstance("bench-mon", PlayerId.P1, Zone.Bench);
    const grass = createCardInstance("grass", PlayerId.P1, Zone.Hand);
    const deckCard = createCardInstance("deck-draw", PlayerId.P1, Zone.Deck);
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        ogerpon: ogerponDef,
        "bench-mon": mockBasic("Bench Mon", "70", ["Grass"]),
        grass: grassEnergy,
        "deck-draw": mockBasic("Drawn Card", "60", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: ogerpon,
          bench: [benchMon],
          hand: [grass],
          deck: [deckCard],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: ogerpon.instanceId,
      abilityName: "Teal Dance",
    });
    expect(state.pendingAction?.type).toBe("ATTACH_HAND_ENERGY");

    state = gameReducer(state, {
      type: "ATTACH_HAND_ENERGY_TO_POKEMON",
      playerId: PlayerId.P1,
      pokemonId: benchMon.instanceId,
      energyId: grass.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).bench[0]?.attachedEnergy).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === deckCard.instanceId)).toBe(
      true,
    );
  });

  it("Trade draws 2 cards after discarding from hand", () => {
    const abilityText =
      "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.";
    const parsed = parseAbilityText({ name: "Trade", type: "Ability", text: abilityText });
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([{ kind: "draw", count: 2, target: "self" }]);

    const zoroarkDef = mockBasic("N's Zoroark ex", "280", ["Darkness"]);
    zoroarkDef.abilities = [{ name: "Trade", type: "Ability", text: abilityText }];
    const zoroark = createCardInstance("zoroark", PlayerId.P1, Zone.Active);
    const discardCard = createCardInstance("discard-me", PlayerId.P1, Zone.Hand);
    const draw1 = createCardInstance("draw-1", PlayerId.P1, Zone.Deck);
    const draw2 = createCardInstance("draw-2", PlayerId.P1, Zone.Deck);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        zoroark: zoroarkDef,
        "discard-me": mockBasic("Discard Me", "60", ["Colorless"]),
        "draw-1": mockBasic("Draw One", "60", ["Colorless"]),
        "draw-2": mockBasic("Draw Two", "60", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: zoroark,
          hand: [discardCard],
          deck: [draw1, draw2],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: zoroark.instanceId,
      abilityName: "Trade",
    });
    expect(state.pendingAction?.type).toBe("ABILITY_DISCARD_HAND");

    state = gameReducer(state, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: discardCard.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(2);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(1);
  });

  it("Night Joker copies a benched N's Pokémon attack", () => {
    const attackText = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
    expect(parseAttackText(attackText)).toEqual([{ kind: "copy_benched_attack", nameFilter: "n's" }]);

    const zoroarkDef = mockBasic("N's Zoroark ex", "280", ["Darkness"], [
      { name: "Night Joker", cost: ["Darkness"], convertedEnergyCost: 1, damage: "", text: attackText },
    ]);
    const zoruaDef = mockBasic("N's Zorua", "70", ["Darkness"], [
      { name: "Scratch", cost: ["Darkness"], convertedEnergyCost: 1, damage: "30", text: "" },
    ]);
    const zoroark = createCardInstance("zoroark", PlayerId.P1, Zone.Active);
    const zorua = createCardInstance("zorua", PlayerId.P1, Zone.Bench);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        zoroark: zoroarkDef,
        zorua: zoruaDef,
        "p2-active": mockBasic("Defender", "200", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: zoroark,
          bench: [zorua],
        },
      },
    });

    expect(startAttackIfCopyPending(state, PlayerId.P1, "Night Joker")).toBe(true);
    expect(state.pendingAction?.type).toBe("COPY_BENCH_ATTACK");

    applyCopiedBenchAttack(state, PlayerId.P1, zorua.instanceId, "Scratch", "Night Joker");
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBeGreaterThan(0);
  });

  it("Rocket Feathers adds damage per discarded Team Rocket Supporter", () => {
    const attackText =
      'You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way.';
    const ariana = createCardInstance("ariana", PlayerId.P1, Zone.Hand);
    const base = battleState();
    const state = battleState({
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          hand: [ariana],
        },
      },
      definitions: {
        ...base.definitions,
        active: {
          ...mockBasic("Team Rocket's Honchkrow", "140", ["Darkness"]),
          attacks: [
            { name: "Rocket Feathers", cost: ["Darkness"], convertedEnergyCost: 1, damage: "60×", text: attackText },
          ],
        },
        ariana: mockSupporter("Team Rocket's Ariana"),
      },
    });

    expect(startAttackIfDiscardPending(state, PlayerId.P1, "Rocket Feathers")).toBe(true);
    resolveDiscardHandSupporterForAttack(state, PlayerId.P1, ariana.instanceId);
    const payload = finishDiscardSupportersForAttack(state, PlayerId.P1);
    expect(payload?.bonusDamage).toBe(60);
  });

  it("Mirage Barrage and Shinobi Blade parse typed post-damage effects", () => {
    expect(
      parseAttackText(
        "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { kind: "discard_energy", count: 2, from: "self_active" },
      { kind: "damage_two_opponent", amount: 120 },
    ]);
    expect(
      parseAttackText("You may search your deck for a card and put it into your hand. Then, shuffle your deck."),
    ).toEqual([{ kind: "search_any_to_hand" }]);
  });

  it("Myriad Leaf Shower adds bonus from both actives", () => {
    const parsed = parseAttackText(
      "This attack does 30 more damage for each Energy attached to both Active Pokémon.",
    );
    const attacker = createCardInstance("attacker", PlayerId.P1, Zone.Active);
    attacker.attachedEnergy = [
      createCardInstance("e1", PlayerId.P1, Zone.Active),
      createCardInstance("e2", PlayerId.P1, Zone.Active),
    ];
    const base = battleState();
    const state = battleState({
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: attacker },
      },
      definitions: {
        ...base.definitions,
        e1: mockEnergy("Grass Energy", ["Grass"]),
        e2: mockEnergy("Grass Energy", ["Grass"]),
      },
    });
    getPlayer(state, PlayerId.P2).active!.attachedEnergy = [createCardInstance("p2-e", PlayerId.P2, Zone.Active)];

    const bonus = computePreDamageBonus(state, parsed[0]!, PlayerId.P1, attacker, PlayerId.P2);
    expect(bonus).toBe(90);
  });
});
