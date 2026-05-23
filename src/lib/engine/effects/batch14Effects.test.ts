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
import { executeEffects, selectMoveDamageSource, selectMoveDamageTarget } from "./execute";
import { applyWeaknessAndResistanceForPokemon } from "./passiveRules";
import { getMaxBenchSize } from "./stadiumEffects";
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

function mockEnergy(name: string, types: string[] = ["Darkness"]): CardDefinition {
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

function mockStadium(name: string, rules: string[]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Stadium"],
    rules,
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
      "p2-active": mockBasic("Target", "120", ["Psychic"]),
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

describe("batch 14 effects", () => {
  it("Munkidori Adrena-Brain moves damage counters to the opponent", () => {
    const abilityText =
      "Once during your turn, if this Pokémon has any Darkness Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.";
    const parsed = parseAbilityText({
      name: "Adrena-Brain",
      type: "Ability",
      text: abilityText,
    });
    expect(getExecutableAbilityEffects(parsed.effects)[0]).toMatchObject({
      kind: "move_damage",
      maxCounters: 3,
      to: "opponent_pokemon",
    });

    const munkidoriDef = mockBasic("Munkidori", "110", ["Psychic"]);
    munkidoriDef.abilities = [{ name: "Adrena-Brain", type: "Ability", text: abilityText }];
    const darkEnergy = mockEnergy("Darkness Energy", ["Darkness"]);
    const munkidori = createCardInstance("munkidori", PlayerId.P1, Zone.Bench);
    const energy = createCardInstance("dark-energy", PlayerId.P1, Zone.Bench);
    munkidori.attachedEnergy = [energy];
    munkidori.damageCounters = 30;

    const state = battleState({
      definitions: {
        munkidori: munkidoriDef,
        "dark-energy": darkEnergy,
        "p2-active": mockBasic("Opponent Active", "120", ["Psychic"]),
      },
      players: {
        ...battleState().players,
        [PlayerId.P1]: {
          ...battleState().players[PlayerId.P1],
          bench: [munkidori],
        },
      },
    });

    expect(canUseAbilityNow(state, munkidori, parsed)).toBe(true);
    markAbilityUsed(state, munkidori, "Adrena-Brain", parsed);

    const ctx = {
      playerId: PlayerId.P1,
      sourcePokemon: munkidori,
      opponentId: PlayerId.P2,
    };
    expect(executeEffects(state, ctx, getExecutableAbilityEffects(parsed.effects))).toBe("pending");

    expect(selectMoveDamageSource(state, PlayerId.P1, munkidori.instanceId)).toBe("pending");
    expect(selectMoveDamageTarget(state, PlayerId.P1, getPlayer(state, PlayerId.P2).active!.instanceId)).toBe(
      "complete",
    );
    expect(munkidori.damageCounters).toBe(0);
    expect(getPlayer(state, PlayerId.P2).active?.damageCounters).toBe(30);
  });

  it("no Weakness next turn is applied from attack text", () => {
    const parsed = parseAttackText("During your opponent's next turn, this Pokémon has no Weakness.");
    expect(parsed).toEqual([{ kind: "no_weakness_next_opponent_turn" }]);

    const attacker = createCardInstance("attacker", PlayerId.P1, Zone.Active);
    const defender = createCardInstance("defender", PlayerId.P2, Zone.Active);
    const attackerDef = mockBasic("Attacker", "200", ["Psychic"]);
    attackerDef.weaknesses = [{ type: "Fighting", value: "×2" }];
    const state = battleState({
      definitions: {
        attacker: attackerDef,
        defender: mockBasic("Defender", "200", ["Water"]),
      },
      players: {
        ...battleState().players,
        [PlayerId.P1]: {
          ...battleState().players[PlayerId.P1],
          active: attacker,
        },
        [PlayerId.P2]: {
          ...battleState().players[PlayerId.P2],
          active: defender,
        },
      },
    });

    executeEffects(
      state,
      { playerId: PlayerId.P1, sourcePokemon: attacker, opponentId: PlayerId.P2, attackName: "Metal Defender" },
      parsed,
    );
    expect(attacker.noWeaknessNextOpponentTurn).toBe("pending");

    attacker.noWeaknessNextOpponentTurn = "active";
    const damage = applyWeaknessAndResistanceForPokemon(state, 100, ["Fighting"], attacker);
    expect(damage).toBe(100);
  });

  it("Area Zero Underdepths expands bench size when a Tera Pokémon is in play", () => {
    const areaZero = mockStadium("Area Zero Underdepths", [
      "Each player who has any Tera Pokémon in play can have up to 8 Pokémon on their Bench.",
    ]);
    const teraMon = createCardInstance("tera", PlayerId.P1, Zone.Active);
    const state = battleState({
      definitions: {
        ...battleState().definitions,
        tera: {
          ...mockBasic("Teal Mask Ogerpon ex", "210", ["Grass"]),
          subtypes: ["Basic", "ex", "Tera"],
        },
      },
      stadium: createCardInstance("area-zero", PlayerId.P1, Zone.Stadium),
      stadiumOwnerId: PlayerId.P1,
      players: {
        ...battleState().players,
        [PlayerId.P1]: {
          ...battleState().players[PlayerId.P1],
          active: teraMon,
        },
      },
    });
    state.definitions["area-zero"] = areaZero;

    expect(getMaxBenchSize(state, PlayerId.P1)).toBe(8);
    expect(getMaxBenchSize(state, PlayerId.P2)).toBe(5);
  });
});
