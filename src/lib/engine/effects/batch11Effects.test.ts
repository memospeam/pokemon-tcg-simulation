import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { gameReducer } from "../reducer";
import { parseAbilityText, parseAttackText } from "./parseText";
import {
  canUseAbilityNow,
  getExecutableAbilityEffects,
  markAbilityUsed,
} from "./abilities";
import { onBenchPlay } from "./abilityHooks";
import {
  applyAttackDamagePhase,
  finishDiscardSupportersForAttack,
  isAttackBlockedThisTurn,
  resolveDiscardHandSupporterForAttack,
  startAttackIfDiscardPending,
} from "./attackFlow";
import { executeEffects, resolveChooseBlockedAttack } from "./execute";
import { activatePendingModifiersForTurnStart } from "./modifiers";
import { emptyTurnFlags, type EngineState } from "../types";

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
      "p2-active": mockBasic("Target", "100", ["Fire"]),
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

describe("batch 11 effects", () => {
  it("Flip the Script requires a KO during opponent's last turn", () => {
    const parsed = parseAbilityText({
      name: "Flip the Script",
      type: "Ability",
      text: "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.",
    });
    expect(parsed.conditions).toEqual([{ type: "own_ko_opponent_last_turn" }]);
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      { kind: "draw", count: 3, target: "self" },
    ]);

    const state = battleState();
    state.definitions.fezandipiti = {
      ...mockBasic("Fezandipiti ex", "210", ["Psychic"]),
      abilities: [
        {
          name: "Flip the Script",
          type: "Ability",
          text: "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.",
        },
      ],
    };
    const active = state.players[PlayerId.P1].active!;
    active.definitionId = "fezandipiti";

    expect(canUseAbilityNow(state, active, parsed)).toBe(false);

    state.ownPokemonKnockedOutOpponentLastTurn[PlayerId.P1] = true;
    state.players[PlayerId.P1].deck = [
      createCardInstance("d1", PlayerId.P1, Zone.Deck),
      createCardInstance("d2", PlayerId.P1, Zone.Deck),
      createCardInstance("d3", PlayerId.P1, Zone.Deck),
    ];
    expect(canUseAbilityNow(state, active, parsed)).toBe(true);

    markAbilityUsed(state, active, parsed.name, parsed);
    executeEffects(state, {
      playerId: PlayerId.P1,
      opponentId: PlayerId.P2,
      sourcePokemon: active,
    }, getExecutableAbilityEffects(parsed.effects));

    expect(state.players[PlayerId.P1].hand.length).toBe(3);
  });

  it("Last-Ditch Catch searches Supporter when Meowth ex is played to bench", () => {
    const abilityText =
      "Once during your turn, when you play this Pokémon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck. You can't use more than 1 Ability that has \"Last-Ditch\" in its name each turn.";
    const parsed = parseAbilityText({
      name: "Last-Ditch Catch",
      type: "Ability",
      text: abilityText,
    });
    expect(parsed.effects.some((effect) => effect.kind === "on_bench_play_trigger")).toBe(true);
    expect(parsed.effects.some((effect) => effect.kind === "search_supporter_to_hand")).toBe(true);

    const supporter = createCardInstance("boss", PlayerId.P1, Zone.Deck);
    const filler = createCardInstance("filler", PlayerId.P1, Zone.Deck);
    const meowth = createCardInstance("meowth-ex", PlayerId.P1, Zone.Bench);
    meowth.enteredPlayTurn = 3;

    const state = battleState({
      players: {
        ...battleState().players,
        [PlayerId.P1]: {
          ...battleState().players[PlayerId.P1],
          active: battleState().players[PlayerId.P1].active,
          bench: [meowth],
          deck: [filler, supporter],
        },
      },
      definitions: {
        ...battleState().definitions,
        "meowth-ex": {
          ...mockBasic("Meowth ex", "160", ["Colorless"]),
          abilities: [{ name: "Last-Ditch Catch", type: "Ability", text: abilityText }],
        },
        boss: mockSupporter("Team Rocket's Ariana"),
        filler: mockBasic("Filler"),
      },
    });

    onBenchPlay(state, PlayerId.P1, meowth);
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");

    const afterPick = gameReducer(state, {
      type: "PICK_DECK_CARD",
      playerId: PlayerId.P1,
      instanceId: supporter.instanceId,
    });
    expect(afterPick.players[PlayerId.P1].hand.some((card) => card.instanceId === supporter.instanceId)).toBe(
      true,
    );
  });

  it("Rocket Feathers adds damage per discarded Team Rocket Supporter", () => {
    const attackText =
      'You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way.';
    const effects = parseAttackText(attackText);
    expect(effects).toEqual([
      { kind: "discard_named_supporters_from_hand_optional", nameFilter: "team rocket" },
      { kind: "damage_per_discarded_hand_cards", perCard: 60 },
    ]);

    const ariana = createCardInstance("ariana", PlayerId.P1, Zone.Hand);
    const proton = createCardInstance("proton", PlayerId.P1, Zone.Hand);
    const state = battleState({
      players: {
        ...battleState().players,
        [PlayerId.P1]: {
          ...battleState().players[PlayerId.P1],
          hand: [ariana, proton],
        },
      },
      definitions: {
        ...battleState().definitions,
        active: {
          ...mockBasic("Team Rocket's Honchkrow", "140", ["Darkness"]),
          attacks: [
            { name: "Rocket Feathers", cost: ["Darkness"], convertedEnergyCost: 1, damage: "60×", text: attackText },
          ],
        },
        ariana: mockSupporter("Team Rocket's Ariana"),
        proton: mockSupporter("Team Rocket's Proton"),
      },
    });

    expect(startAttackIfDiscardPending(state, PlayerId.P1, "Rocket Feathers")).toBe(true);
    resolveDiscardHandSupporterForAttack(state, PlayerId.P1, ariana.instanceId);
    resolveDiscardHandSupporterForAttack(state, PlayerId.P1, proton.instanceId);
    const payload = finishDiscardSupportersForAttack(state, PlayerId.P1);
    expect(payload?.bonusDamage).toBe(120);

    applyAttackDamagePhase(state, PlayerId.P1, "Rocket Feathers", payload!.bonusDamage);
    expect(state.players[PlayerId.P2].active!.damageCounters).toBeGreaterThan(0);
  });

  it("Murkrow Deceit parses supporter search attack", () => {
    const effects = parseAttackText(
      "Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
    );
    expect(effects).toEqual([{ kind: "search_supporter_to_hand" }]);
  });

  it("Murkrow Torment blocks a chosen attack next turn", () => {
    const attackText =
      "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.";
    const effects = parseAttackText(attackText);
    expect(effects.some((effect) => effect.kind === "disable_opponent_attack_next_turn")).toBe(true);

    const state = battleState();
    state.definitions["p2-active"] = {
      ...mockBasic("Target", "100", ["Fire"]),
      attacks: [
        { name: "Ember", cost: ["Fire"], convertedEnergyCost: 1, damage: "30", text: "" },
        { name: "Flamethrower", cost: ["Fire", "Colorless"], convertedEnergyCost: 2, damage: "90", text: "" },
      ],
    };

    executeEffects(
      state,
      {
        playerId: PlayerId.P1,
        opponentId: PlayerId.P2,
        sourcePokemon: state.players[PlayerId.P1].active!,
      },
      [{ kind: "disable_opponent_attack_next_turn" }],
    );

    expect(state.pendingAction?.type).toBe("CHOOSE_BLOCKED_ATTACK");
    resolveChooseBlockedAttack(state, PlayerId.P1, "Ember");

    state.currentPlayerId = PlayerId.P2;
    activatePendingModifiersForTurnStart(state, PlayerId.P2);
    const opponentActive = state.players[PlayerId.P2].active!;
    expect(isAttackBlockedThisTurn(opponentActive, "Ember")).toBe(true);
    expect(isAttackBlockedThisTurn(opponentActive, "Flamethrower")).toBe(false);
  });
});
