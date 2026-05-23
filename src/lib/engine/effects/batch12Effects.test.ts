import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { parseAbilityText, parseAttackText } from "./parseText";
import {
  canUseAbilityNow,
  getExecutableAbilityEffects,
  markAbilityUsed,
} from "./abilities";
import {
  computePreDamageBonus,
} from "./damageBonus";
import { executeEffects, continueRecoverToBenchPick } from "./execute";
import { markMovedFromBenchToActive } from "./pokemonZoneHelpers";
import { gameReducer } from "../reducer";
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

describe("batch 12 effects", () => {
  it("Come and Get You recovers Duskull from discard onto the Bench", () => {
    const parsed = parseAttackText("Put up to 3 Duskull from your discard pile onto your Bench.");
    expect(parsed).toEqual([
      { kind: "recover_pokemon_from_discard", count: 3, nameFilter: "Duskull", target: "bench" },
    ]);

    const duskull1 = createCardInstance("duskull-1", PlayerId.P1, Zone.Discard);
    const duskull2 = createCardInstance("duskull-2", PlayerId.P1, Zone.Discard);
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: mockBasic("Duskull", "60", ["Psychic"]),
        "duskull-1": mockBasic("Duskull", "60", ["Psychic"]),
        "duskull-2": mockBasic("Duskull", "60", ["Psychic"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          discard: [duskull1, duskull2],
        },
      },
    });

    const ctx = {
      playerId: PlayerId.P1,
      sourcePokemon: state.players[PlayerId.P1].active!,
      opponentId: PlayerId.P2,
    };
    const result = executeEffects(state, ctx, parsed);
    expect(result).toBe("pending");
    expect(state.pendingAction?.type).toBe("PICK_DISCARD");
    if (state.pendingAction?.type === "PICK_DISCARD") {
      expect(state.pendingAction.toBench).toBe(true);
      continueRecoverToBenchPick(state, PlayerId.P1, duskull1.instanceId);
      expect(getPlayer(state, PlayerId.P1).bench).toHaveLength(1);
      expect(getPlayer(state, PlayerId.P1).bench[0]?.instanceId).toBe(duskull1.instanceId);
    }
  });

  it("Mirage Barrage parses discard energy and damage to two opponent Pokémon", () => {
    const parsed = parseAttackText(
      "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    );
    expect(parsed).toEqual([
      { kind: "discard_energy", count: 2, from: "self_active" },
      { kind: "damage_two_opponent", amount: 120 },
    ]);
  });

  it("Gale Thrust adds bonus damage after moving from Bench to Active", () => {
    const parsed = parseAttackText(
      "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 170 more damage.",
    );
    expect(parsed).toEqual([{ kind: "damage_bonus_if_moved_from_bench", amount: 170 }]);

    const benchMon = createCardInstance("lopunny", PlayerId.P1, Zone.Active);
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: mockBasic("Mega Lopunny ex", "260", ["Colorless"]),
        lopunny: mockBasic("Mega Lopunny ex", "260", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: benchMon,
        },
      },
    });
    markMovedFromBenchToActive(state, benchMon.instanceId);

    const bonus = computePreDamageBonus(
      state,
      parsed[0]!,
      PlayerId.P1,
      benchMon,
      PlayerId.P2,
    );
    expect(bonus).toBe(170);
  });

  it("Subjugating Chains switches Darkness bench Pokémon and poisons the new Active", () => {
    const abilityText =
      "Once during your turn, you may switch 1 of your Benched Darkness Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn.";
    const parsed = parseAbilityText({
      name: "Subjugating Chains",
      type: "Ability",
      text: abilityText,
    });
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      {
        kind: "switch_bench_typed_to_active",
        typeFilter: "Darkness",
        excludeName: "Pecharunt ex",
        applyStatus: "Poisoned",
      },
    ]);

    const pecharunt = createCardInstance("pecharunt", PlayerId.P1, Zone.Active);
    const darkMon = createCardInstance("dark-bench", PlayerId.P1, Zone.Bench);
    const excluded = createCardInstance("other-pecharunt", PlayerId.P1, Zone.Bench);
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        pecharunt: { ...mockBasic("Pecharunt ex", "210", ["Darkness"]), subtypes: ["Basic", "ex"] },
        "dark-bench": mockBasic("Poochyena", "60", ["Darkness"]),
        "other-pecharunt": { ...mockBasic("Pecharunt ex", "210", ["Darkness"]), subtypes: ["Basic", "ex"] },
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: pecharunt,
          bench: [darkMon, excluded],
        },
      },
    });

    expect(canUseAbilityNow(state, pecharunt, parsed)).toBe(true);
    markAbilityUsed(state, pecharunt, "Subjugating Chains", parsed);

    const ctx = {
      playerId: PlayerId.P1,
      sourcePokemon: pecharunt,
      opponentId: PlayerId.P2,
    };
    const result = executeEffects(state, ctx, getExecutableAbilityEffects(parsed.effects));
    expect(result).toBe("complete");
    expect(state.players[PlayerId.P1].active?.instanceId).toBe(darkMon.instanceId);
    expect(state.players[PlayerId.P1].active?.statusConditions).toContain("Poisoned");
    expect(state.turnFlags.movedFromBenchToActiveIds).toContain(darkMon.instanceId);
  });

  it("retreat marks the incoming Pokémon as moved from Bench", () => {
    const active = createCardInstance("active", PlayerId.P1, Zone.Active);
    const benchMon = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    const base = battleState({
      definitions: {
        ...battleState().definitions,
        active: { ...mockBasic("Runner", "70", ["Colorless"]), retreatCost: [] },
        bench: mockBasic("Bench Mon", "70", ["Colorless"]),
      },
    });
    const state = battleState({
      ...base,
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active,
          bench: [benchMon],
        },
      },
    });

    const next = gameReducer(state, {
      type: "RETREAT",
      playerId: PlayerId.P1,
      benchInstanceId: benchMon.instanceId,
    });

    expect(next.turnFlags.movedFromBenchToActiveIds).toContain(benchMon.instanceId);
  });
});
