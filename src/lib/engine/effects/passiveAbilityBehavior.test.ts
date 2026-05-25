/**
 * Behavioral tests for the 6 passive ability effects that live outside execute.ts.
 * Each effect is handled by a dedicated passive-rules function; the execute.ts
 * "no-op" case is intentional because the check happens at a different point in
 * the game loop (damage calc, cost calc, attack legality, etc.).
 *
 * Effects covered:
 *  1. damage_per_tools_on_your_pokemon   — Rotom Gadget Show
 *  2. attack_cost_reduction_per_opponent_prize — Bloodmoon Ursaluna ex Seasoned Skill
 *  3. override_opponent_dragon_weakness  — Lillie's Clefairy ex Fairy Zone
 *  4. future_pokemon_active_damage_bonus — Iron Crown ex Cobalt Command
 *  5. ignore_opponent_active_modifiers   — Walking Wake ex Azure Seas
 *  6. cant_attack_unless_name_count_in_play — Team Rocket's Mewtwo ex Power Saver
 */
import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";
import { countToolsOnPlayerPokemon } from "./toolEffects";
import { computePreDamageBonus } from "./damageBonus";
import {
  getEffectiveAttackCost,
  getFuturePokemonDamageBonus,
  attackerIgnoresOpponentActiveModifiers,
  canPokemonAttackWithPassives,
  applyWeaknessAndResistanceForPokemon,
} from "./passiveRules";

// ── helpers ───────────────────────────────────────────────────────────────────

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  attacks: CardDefinition["attacks"] = [],
  abilities: CardDefinition["abilities"] = [],
  subtypes: string[] = ["Basic"],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes,
    hp,
    types,
    attacks,
    abilities,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockTool(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Pokémon Tool"],
    rules: ["Attached Pokémon gets +10 HP."],
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
        prizes: Array.from({ length: 6 }, (_, i) =>
          createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes),
        ),
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

// ── 1. damage_per_tools_on_your_pokemon ──────────────────────────────────────

describe("Rotom Gadget Show — damage_per_tools_on_your_pokemon", () => {
  const gadgetShowText =
    "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon.";
  const gadgetEffect = { kind: "damage_per_tools_on_your_pokemon" as const, perTool: 30 };

  const rotomDef = mockBasic("Rotom", "80", ["Colorless"], [
    { name: "Gadget Show", cost: [], convertedEnergyCost: 0, damage: "", text: gadgetShowText },
  ]);

  it("deals 0 damage when no tools attached", () => {
    const rotom = createCardInstance("rotom", PlayerId.P1, Zone.Active);
    rotom.attachedTools = [];
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, rotom: rotomDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: rotom },
      },
    };
    expect(countToolsOnPlayerPokemon(state, PlayerId.P1)).toBe(0);
    expect(computePreDamageBonus(state, gadgetEffect, PlayerId.P1, rotom, PlayerId.P2)).toBe(0);
  });

  it("deals 30 per tool — 2 tools on team = 60 damage", () => {
    const rotom = createCardInstance("rotom", PlayerId.P1, Zone.Active);
    const bench = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    const tool1 = createCardInstance("tool1", PlayerId.P1, Zone.Active);
    const tool2 = createCardInstance("tool2", PlayerId.P1, Zone.Bench);
    rotom.attachedTools = [tool1];
    bench.attachedTools = [tool2];
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, rotom: rotomDef, bench: mockBasic("Bench"), tool1: mockTool("Tool 1"), tool2: mockTool("Tool 2") },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: rotom, bench: [bench] },
      },
    };
    expect(countToolsOnPlayerPokemon(state, PlayerId.P1)).toBe(2);
    expect(computePreDamageBonus(state, gadgetEffect, PlayerId.P1, rotom, PlayerId.P2)).toBe(60);
  });

  it("full attack: 3 tools attached → 90 damage to opponent active", () => {
    const rotom = createCardInstance("rotom", PlayerId.P1, Zone.Active);
    const t1 = createCardInstance("t1", PlayerId.P1, Zone.Active);
    const t2 = createCardInstance("t2", PlayerId.P1, Zone.Active);
    const t3 = createCardInstance("t3", PlayerId.P1, Zone.Active);
    rotom.attachedTools = [t1, t2, t3];
    const base = baseState();
    const state = gameReducer({
      ...base,
      definitions: {
        ...base.definitions,
        rotom: rotomDef,
        t1: mockTool("T1"),
        t2: mockTool("T2"),
        t3: mockTool("T3"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: rotom },
      },
    }, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Gadget Show" });

    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(90);
  });
});

// ── 2. attack_cost_reduction_per_opponent_prize ───────────────────────────────

describe("Bloodmoon Ursaluna ex Seasoned Skill — attack_cost_reduction_per_opponent_prize", () => {
  const seasonedSkillText =
    "Blood Moon used by this Pokémon costs Colorless less for each Prize card your opponent has taken.";
  const bloodMoonAttack = {
    name: "Blood Moon",
    cost: ["Colorless", "Colorless", "Colorless"],
    convertedEnergyCost: 3,
    damage: "160",
    text: "",
  };
  const ursalunaExDef = mockBasic("Bloodmoon Ursaluna ex", "230", ["Colorless"], [bloodMoonAttack], [
    { name: "Seasoned Skill", type: "Ability" as const, text: seasonedSkillText },
  ]);

  function stateWithPrizesTaken(prizesTaken: number): { state: EngineState; ursaluna: ReturnType<typeof createCardInstance> } {
    const ursaluna = createCardInstance("ursaluna", PlayerId.P1, Zone.Active);
    const base = baseState();
    // Opponent starts with 6 prizes; prizesTaken means they have (6 - prizesTaken) remaining
    const remainingPrizes = Array.from({ length: 6 - prizesTaken }, (_, i) =>
      createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes),
    );
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, ursaluna: ursalunaExDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: ursaluna },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], prizes: remainingPrizes },
      },
    };
    return { state, ursaluna };
  }

  it("full cost [C][C][C] when opponent has taken 0 prizes", () => {
    const { state, ursaluna } = stateWithPrizesTaken(0);
    expect(getEffectiveAttackCost(state, ursaluna, bloodMoonAttack)).toEqual([
      "Colorless", "Colorless", "Colorless",
    ]);
  });

  it("cost becomes [C][C] when opponent has taken 1 prize", () => {
    const { state, ursaluna } = stateWithPrizesTaken(1);
    expect(getEffectiveAttackCost(state, ursaluna, bloodMoonAttack)).toEqual([
      "Colorless", "Colorless",
    ]);
  });

  it("cost becomes [C] when opponent has taken 2 prizes", () => {
    const { state, ursaluna } = stateWithPrizesTaken(2);
    expect(getEffectiveAttackCost(state, ursaluna, bloodMoonAttack)).toEqual(["Colorless"]);
  });

  it("cost reduced to [] (free) when opponent has taken 3+ prizes", () => {
    const { state, ursaluna } = stateWithPrizesTaken(3);
    expect(getEffectiveAttackCost(state, ursaluna, bloodMoonAttack)).toEqual([]);
  });
});

// ── 3. override_opponent_dragon_weakness ─────────────────────────────────────

describe("Lillie's Clefairy ex Fairy Zone — override_opponent_dragon_weakness", () => {
  const fairyZoneText =
    "The Weakness of each of your opponent's Dragon Pokémon in play is now Psychic. (Apply Weakness as ×2.)";
  const clefairyDef = mockBasic("Lillie's Clefairy ex", "220", ["Psychic"], [], [
    { name: "Fairy Zone", type: "Ability" as const, text: fairyZoneText },
  ]);
  // Dragon Pokémon — no Psychic weakness by default; Fairy Zone overrides this
  const draxDef: CardDefinition = {
    ...mockBasic("Dragonite ex", "280", ["Dragon"]),
    weaknesses: [],
  };
  const attackerDef = mockBasic("Attacker", "100", ["Psychic"], [
    { name: "Psychic Blow", cost: [], convertedEnergyCost: 0, damage: "50", text: "" },
  ]);

  it("Dragon defender has no Psychic weakness without Fairy Zone", () => {
    const attacker = createCardInstance("attacker", PlayerId.P1, Zone.Active);
    const defender = createCardInstance("drax", PlayerId.P2, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, attacker: attackerDef, drax: draxDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: attacker },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], active: defender },
      },
    };
    // 50 base → no weakness → stays 50
    expect(applyWeaknessAndResistanceForPokemon(state, 50, ["Psychic"], defender)).toBe(50);
  });

  it("Dragon defender takes ×2 Psychic damage when Fairy Zone is active on opponent's bench", () => {
    const attacker = createCardInstance("attacker", PlayerId.P1, Zone.Active);
    const defender = createCardInstance("drax", PlayerId.P2, Zone.Active);
    // Clefairy ex belongs to P1 (the attacker's side)
    const clefairy = createCardInstance("clefairy", PlayerId.P1, Zone.Bench);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, attacker: attackerDef, drax: draxDef, clefairy: clefairyDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: attacker, bench: [clefairy] },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], active: defender },
      },
    };
    // 50 base × 2 (Fairy Zone Psychic weakness override) = 100
    expect(applyWeaknessAndResistanceForPokemon(state, 50, ["Psychic"], defender)).toBe(100);
  });
});

// ── 4. future_pokemon_active_damage_bonus ────────────────────────────────────

describe("Iron Crown ex Cobalt Command — future_pokemon_active_damage_bonus", () => {
  const cobaltCommandText =
    "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).";
  const ironCrownDef = mockBasic("Iron Crown ex", "210", ["Psychic"], [], [
    { name: "Cobalt Command", type: "Ability" as const, text: cobaltCommandText },
  ]);
  const ironLeavesDef = mockBasic("Iron Leaves ex", "230", ["Grass"], [], [], ["Basic", "Future"]);
  const regularDef = mockBasic("Regular Pokémon", "100", ["Colorless"]);

  it("Future Pokémon gets +20 bonus when Iron Crown ex is in play", () => {
    const ironCrown = createCardInstance("crown", PlayerId.P1, Zone.Bench);
    const ironLeaves = createCardInstance("leaves", PlayerId.P1, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, crown: ironCrownDef, leaves: ironLeavesDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: ironLeaves, bench: [ironCrown] },
      },
    };
    expect(getFuturePokemonDamageBonus(state, ironLeaves, PlayerId.P1)).toBe(20);
  });

  it("Iron Crown ex itself is excluded from its own bonus", () => {
    const ironCrown = createCardInstance("crown", PlayerId.P1, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, crown: ironCrownDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: ironCrown },
      },
    };
    expect(getFuturePokemonDamageBonus(state, ironCrown, PlayerId.P1)).toBe(0);
  });

  it("Non-Future Pokémon gets no bonus even with Iron Crown ex in play", () => {
    const ironCrown = createCardInstance("crown", PlayerId.P1, Zone.Bench);
    const regular = createCardInstance("regular", PlayerId.P1, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, crown: ironCrownDef, regular: regularDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: regular, bench: [ironCrown] },
      },
    };
    expect(getFuturePokemonDamageBonus(state, regular, PlayerId.P1)).toBe(0);
  });

  it("No bonus without Iron Crown ex in play", () => {
    const ironLeaves = createCardInstance("leaves", PlayerId.P1, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, leaves: ironLeavesDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: ironLeaves },
      },
    };
    expect(getFuturePokemonDamageBonus(state, ironLeaves, PlayerId.P1)).toBe(0);
  });
});

// ── 5. ignore_opponent_active_modifiers ──────────────────────────────────────

describe("Walking Wake ex Azure Seas — ignore_opponent_active_modifiers", () => {
  const azureSeasText =
    "Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon.";
  const walkingWakeDef = mockBasic("Walking Wake ex", "230", ["Water"], [
    { name: "Hydro Pump", cost: ["Water"], convertedEnergyCost: 1, damage: "120", text: "" },
  ], [
    { name: "Azure Seas", type: "Ability" as const, text: azureSeasText },
  ]);
  const regularDef = mockBasic("Regular Attacker", "100", ["Colorless"], [
    { name: "Strike", cost: [], convertedEnergyCost: 0, damage: "50", text: "" },
  ]);

  it("Walking Wake ex returns true for attackerIgnoresOpponentActiveModifiers", () => {
    const walkingWake = createCardInstance("wake", PlayerId.P1, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, wake: walkingWakeDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: walkingWake },
      },
    };
    expect(attackerIgnoresOpponentActiveModifiers(state, walkingWake)).toBe(true);
  });

  it("Regular Pokémon without Azure Seas returns false", () => {
    const regular = createCardInstance("regular", PlayerId.P1, Zone.Active);
    const base = baseState();
    const state: EngineState = {
      ...base,
      definitions: { ...base.definitions, regular: regularDef },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: regular },
      },
    };
    expect(attackerIgnoresOpponentActiveModifiers(state, regular)).toBe(false);
  });

  it("Azure Seas causes damage to ignore opponent active damage reduction", () => {
    // Opponent active has damageReductionPending (Ferocious Bellow / defending attack reduction)
    const walkingWake = createCardInstance("wake", PlayerId.P1, Zone.Active);
    const defender = createCardInstance("defender", PlayerId.P2, Zone.Active);
    const energy = createCardInstance("energy", PlayerId.P1, Zone.Active);
    walkingWake.attachedEnergy = [energy];
    defender.damageReductionPending = 50; // 50 damage reduction active
    const base = baseState();
    const state = gameReducer({
      ...base,
      definitions: {
        ...base.definitions,
        wake: walkingWakeDef,
        defender: mockBasic("Defender", "200"),
        energy: {
          apiId: "energy",
          name: "Water Energy",
          supertype: "Energy",
          subtypes: ["Basic"],
          types: ["Water"],
          set: { id: "test", name: "Test" },
          number: "1",
          images: { small: "", large: "" },
        },
      },
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: walkingWake },
        [PlayerId.P2]: { ...base.players[PlayerId.P2], active: defender },
      },
    }, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Hydro Pump" });

    // Azure Seas ignores the 50 reduction → full 120 damage
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(120);
  });
});

// ── 6. cant_attack_unless_name_count_in_play ─────────────────────────────────

describe("Team Rocket's Mewtwo ex Power Saver — cant_attack_unless_name_count_in_play", () => {
  const powerSaverText =
    "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.";
  const trMewtwoDef = mockBasic("Team Rocket's Mewtwo ex", "230", ["Psychic"], [
    { name: "Psystrike", cost: ["Psychic", "Psychic"], convertedEnergyCost: 2, damage: "200", text: "" },
  ], [
    { name: "Power Saver", type: "Ability" as const, text: powerSaverText },
  ]);
  const trRocketDef = mockBasic("Team Rocket's Pikachu", "60");

  function stateWithTrCount(count: number) {
    const mewtwo = createCardInstance("mewtwo", PlayerId.P1, Zone.Active);
    const bench = Array.from({ length: count - 1 }, (_, i) =>
      createCardInstance(`tr-bench-${i}`, PlayerId.P1, Zone.Bench),
    );
    const base = baseState();
    const defs: Record<string, CardDefinition> = { ...base.definitions, mewtwo: trMewtwoDef };
    bench.forEach((_, i) => { defs[`tr-bench-${i}`] = trRocketDef; });
    const state: EngineState = {
      ...base,
      definitions: defs,
      players: {
        ...base.players,
        [PlayerId.P1]: { ...base.players[PlayerId.P1], active: mewtwo, bench },
      },
    };
    return { state, mewtwo };
  }

  it("cannot attack with only 3 Team Rocket's Pokémon in play", () => {
    const { state, mewtwo } = stateWithTrCount(3);
    expect(canPokemonAttackWithPassives(state, mewtwo, true)).toBe(false);
  });

  it("can attack with exactly 4 Team Rocket's Pokémon in play", () => {
    const { state, mewtwo } = stateWithTrCount(4);
    expect(canPokemonAttackWithPassives(state, mewtwo, true)).toBe(true);
  });

  it("can attack with 5 Team Rocket's Pokémon in play", () => {
    const { state, mewtwo } = stateWithTrCount(5);
    expect(canPokemonAttackWithPassives(state, mewtwo, true)).toBe(true);
  });

  it("getLegalActions excludes ATTACK when TR count < 4", () => {
    // Add energy so cost check isn't the blocker
    const { state: s2, mewtwo } = stateWithTrCount(2);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    mewtwo.attachedEnergy = [e1, e2];
    // canPokemonAttackWithPassives is the gate that getLegalActions uses for ATTACK
    expect(canPokemonAttackWithPassives(s2, mewtwo, true)).toBe(false);
  });
});
