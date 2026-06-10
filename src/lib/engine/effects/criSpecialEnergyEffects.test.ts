import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { beginGame, gameReducer, startActiveGame } from "../reducer";
import { getPlayer, type EngineState } from "../types";
import { hasFreeRetreat } from "./abilityHooks";
import {
  applySpecialCondition,
  hasBubblyWaterSpecialConditionImmunity,
} from "./stadiumEffects";
import {
  getSpecialEnergyContribution,
  onSpecialEnergyAttachedFromHand,
  returnNitroFireAfterSelfAttackDiscard,
} from "./specialEnergyEffects";
import { buildPlaytestDeckFromCorpusText } from "../../deck/corpusDeckBuilder";

function mockBasic(name: string, types: string[], retreatCost: string[] = ["Colorless"]): CardDefinition {
  return {
    apiId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "120",
    types,
    retreatCost,
    attacks: [{ name: "Tackle", cost: ["Colorless"], convertedEnergyCost: 1, damage: "20", text: "" }],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockSpecialEnergy(name: string, types: string[]): CardDefinition {
  return {
    apiId: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    supertype: "Energy",
    subtypes: ["Special"],
    types,
    set: { id: "cri", name: "CRI" },
    number: "84",
    images: { small: "", large: "" },
  };
}

function fillerDeck(extra: CardDefinition[] = []): CardDefinition[] {
  // Seed plenty of Basic Pokémon so the mulligan loop in setupActiveGame
  // always terminates (a deck of pure Energy mulligans forever).
  const seed = mockBasic("Seed Mon", ["Colorless"]);
  const cards = [...extra, ...Array.from({ length: 12 }, () => seed)];
  for (let i = cards.length; i < 60; i += 1) {
    cards.push({
      apiId: `filler-energy-${i}`,
      name: `Fire Energy ${i}`,
      supertype: "Energy",
      subtypes: ["Basic"],
      types: ["Fire"],
      set: { id: "test", name: "Test" },
      number: `${i}`,
      images: { small: "", large: "" },
    });
  }
  return cards;
}

function setupActiveGame(cards: CardDefinition[], seed = 42): EngineState {
  let state = beginGame({
    player1Name: "Alice",
    player2Name: "Bob",
    player1Cards: cards,
    player2Cards: cards,
    seed,
  });
  while (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
    state = gameReducer(state, { type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
  }
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const basic = getPlayer(state, playerId).hand.find((card) => {
      const def = state.definitions[card.definitionId];
      return def?.supertype === "Pokémon" && def.subtypes.includes("Basic");
    });
    if (basic) {
      state = gameReducer(state, { type: "PLACE_ACTIVE", playerId, instanceId: basic.instanceId });
    }
  }
  return startActiveGame(state);
}

function registerActive(state: EngineState, def: CardDefinition, playerId = PlayerId.P1) {
  state.definitions[def.apiId] = def;
  const mon = createCardInstance(def.apiId, playerId, Zone.Active);
  getPlayer(state, playerId).active = mon;
  return mon;
}

function attachEnergy(state: EngineState, mon: ReturnType<typeof createCardInstance>, def: CardDefinition) {
  state.definitions[def.apiId] = def;
  const energy = createCardInstance(def.apiId, mon.ownerId, mon.zone);
  mon.attachedEnergy.push(energy);
  return energy;
}

describe("CRI special energies — corpus resolution", () => {
  it("resolves all 3 CRI special energies as Special with rules text", () => {
    const deck = buildPlaytestDeckFromCorpusText(
      "energy-test",
      `Pokémon : 8
8 N's Zorua JTG 97

Trainer : 40
40 Ultra Ball MEG 131

Energy : 12
4 Bubbly Water Energy CRI 84
4 Magnetic Metal Energy CRI 85
4 Nitro Fire Energy CRI 86`,
    );
    expect(deck.resolveErrors).toEqual([]);
    const byName = (name: string) => deck.cards.find((card) => card.name === name)!;
    for (const [name, type] of [
      ["Bubbly Water Energy", "Water"],
      ["Magnetic Metal Energy", "Metal"],
      ["Nitro Fire Energy", "Fire"],
    ] as const) {
      const def = byName(name);
      expect(def.supertype, name).toBe("Energy");
      expect(def.subtypes, name).toEqual(["Special"]);
      expect(def.types, name).toEqual([type]);
      expect(def.rules?.[0], name).toContain("provides");
    }
  });

  it("enforces the 4-copy cap on special energies (not unlimited like basics)", () => {
    const deck = buildPlaytestDeckFromCorpusText(
      "cap-test",
      `Pokémon : 8
8 N's Zorua JTG 97

Trainer : 40
40 Ultra Ball MEG 131

Energy : 12
6 Bubbly Water Energy CRI 84
6 Darkness Energy MEE 7`,
    );
    const messages = deck.validation.issues.map((issue) => issue.message);
    expect(messages.some((m) => m.includes("Bubbly Water Energy") && m.includes("max 4"))).toBe(true);
    expect(messages.some((m) => m.includes("Darkness Energy"))).toBe(false);
  });
});

describe("CRI special energies — engine effects", () => {
  it("each provides 1 Energy of its color to any Pokémon", () => {
    const state = setupActiveGame(fillerDeck());
    const mon = registerActive(state, mockBasic("Colorless Mon", ["Colorless"]));
    const cases: [string, string[], string][] = [
      ["Bubbly Water Energy", ["Water"], "Water"],
      ["Magnetic Metal Energy", ["Metal"], "Metal"],
      ["Nitro Fire Energy", ["Fire"], "Fire"],
    ];
    for (const [name, types, color] of cases) {
      const energy = attachEnergy(state, mon, mockSpecialEnergy(name, types));
      const contribution = getSpecialEnergyContribution(state, mon, energy);
      expect(contribution.colors, name).toEqual({ [color]: 1 });
    }
  });

  it("Bubbly Water Energy blocks Special Conditions on the Water Pokémon it is attached to", () => {
    const state = setupActiveGame(fillerDeck());
    const waterMon = registerActive(state, mockBasic("Water Mon", ["Water"]), PlayerId.P1);
    attachEnergy(state, waterMon, mockSpecialEnergy("Bubbly Water Energy", ["Water"]));
    expect(hasBubblyWaterSpecialConditionImmunity(state, waterMon)).toBe(true);
    expect(applySpecialCondition(state, waterMon, "Poisoned")).toBe(false);
    expect(waterMon.statusConditions).toEqual([]);

    // Non-Water Pokémon gets no immunity from it.
    const fireMon = registerActive(state, mockBasic("Fire Mon", ["Fire"]), PlayerId.P2);
    attachEnergy(state, fireMon, mockSpecialEnergy("Bubbly Water Energy", ["Water"]));
    expect(hasBubblyWaterSpecialConditionImmunity(state, fireMon)).toBe(false);
    expect(applySpecialCondition(state, fireMon, "Poisoned")).toBe(true);
    expect(fireMon.statusConditions).toEqual(["Poisoned"]);
  });

  it("Bubbly Water Energy cures existing Special Conditions when attached from hand", () => {
    const state = setupActiveGame(fillerDeck());
    const waterMon = registerActive(state, mockBasic("Water Mon", ["Water"]));
    waterMon.statusConditions = ["Poisoned", "Asleep"];
    waterMon.poisonCounters = 2;
    const energyDef = mockSpecialEnergy("Bubbly Water Energy", ["Water"]);
    const energy = attachEnergy(state, waterMon, energyDef);
    onSpecialEnergyAttachedFromHand(state, PlayerId.P1, energy, waterMon);
    expect(waterMon.statusConditions).toEqual([]);
    expect(waterMon.poisonCounters).toBeUndefined();
  });

  it("Magnetic Metal Energy gives the Metal Pokémon it is attached to free retreat", () => {
    const state = setupActiveGame(fillerDeck());
    const metalMon = registerActive(state, mockBasic("Metal Mon", ["Metal"], ["Colorless", "Colorless"]));
    expect(hasFreeRetreat(state, metalMon)).toBe(false);
    attachEnergy(state, metalMon, mockSpecialEnergy("Magnetic Metal Energy", ["Metal"]));
    expect(hasFreeRetreat(state, metalMon)).toBe(true);

    // Not for a non-Metal Pokémon.
    const fireMon = registerActive(state, mockBasic("Fire Mon", ["Fire"]), PlayerId.P2);
    attachEnergy(state, fireMon, mockSpecialEnergy("Magnetic Metal Energy", ["Metal"]));
    expect(hasFreeRetreat(state, fireMon)).toBe(false);
  });

  it("Nitro Fire Energy returns to hand after a Fire Pokémon's own attack effect discards it", () => {
    const state = setupActiveGame(fillerDeck());
    const player = getPlayer(state, PlayerId.P1);
    const fireMon = registerActive(state, mockBasic("Fire Mon", ["Fire"]));
    const energyDef = mockSpecialEnergy("Nitro Fire Energy", ["Fire"]);
    state.definitions[energyDef.apiId] = energyDef;
    const energy = createCardInstance(energyDef.apiId, PlayerId.P1, Zone.Discard);
    player.discard.push(energy);

    const handBefore = player.hand.length;
    returnNitroFireAfterSelfAttackDiscard(state, fireMon, [energy]);
    expect(player.discard.some((card) => card.instanceId === energy.instanceId)).toBe(false);
    expect(player.hand.length).toBe(handBefore + 1);
    expect(player.hand.at(-1)!.zone).toBe(Zone.Hand);
  });

  it("Nitro Fire Energy stays discarded when the attacker is not a Fire Pokémon", () => {
    const state = setupActiveGame(fillerDeck());
    const player = getPlayer(state, PlayerId.P1);
    const waterMon = registerActive(state, mockBasic("Water Mon", ["Water"]));
    const energyDef = mockSpecialEnergy("Nitro Fire Energy", ["Fire"]);
    state.definitions[energyDef.apiId] = energyDef;
    const energy = createCardInstance(energyDef.apiId, PlayerId.P1, Zone.Discard);
    player.discard.push(energy);

    returnNitroFireAfterSelfAttackDiscard(state, waterMon, [energy]);
    expect(player.discard.some((card) => card.instanceId === energy.instanceId)).toBe(true);
  });
});
