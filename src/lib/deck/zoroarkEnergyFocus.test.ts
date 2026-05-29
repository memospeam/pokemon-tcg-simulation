import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickBestEnergyTarget } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

/**
 * User-requested focus: Zoroark deck should attach energy ONLY to N's Zoroark ex.
 * Zekrom / Darmanitan / Pecharunt / Zorua must never be picked while N's
 * Zoroark ex is in play and not fully loaded.
 */

function mockPokemon(
  name: string,
  attacks: { name: string; cost: string[]; convertedEnergyCost: number; damage: string }[],
  types: string[],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "200",
    types,
    abilities: [],
    attacks: attacks.map((a) => ({ ...a, text: "" })),
    set: { id: "t", name: "t" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function buildState(defs: Record<string, CardDefinition>, active: ReturnType<typeof createCardInstance>, bench: ReturnType<typeof createCardInstance>[]): EngineState {
  const opp = createCardInstance("opp", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1, name: "P1", deck: [], hand: [], active, bench,
        prizes: [], discard: [], lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2, name: "P2", deck: [], hand: [], active: opp, bench: [],
        prizes: [], discard: [], lostZone: [],
      },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { ...defs, opp: mockPokemon("Opp", [], []) },
    log: [], actionLog: [], winnerId: null, rngSeed: 42,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null,
    heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("Zoroark deck — energy focus on N's Zoroark ex only", () => {
  const zoroarkDef = mockPokemon(
    "N's Zoroark ex",
    [{ name: "Night Joker", cost: ["Darkness", "Darkness"], convertedEnergyCost: 2, damage: "0" }],
    ["Darkness"],
  );
  const zekromDef = mockPokemon(
    "N's Zekrom",
    [{ name: "Rampaging Thunder", cost: ["Fire", "Lightning", "Lightning", "Colorless"], convertedEnergyCost: 4, damage: "250" }],
    ["Lightning"],
  );
  const darmanitanDef = mockPokemon(
    "N's Darmanitan",
    [{ name: "Flamebody Cannon", cost: ["Fire", "Fire", "Colorless"], convertedEnergyCost: 3, damage: "90" }],
    ["Fire"],
  );
  const pecharuntDef = mockPokemon(
    "Pecharunt ex",
    [{ name: "Irritated Outburst", cost: ["Darkness", "Darkness"], convertedEnergyCost: 2, damage: "60" }],
    ["Darkness"],
  );
  const zoruaDef = mockPokemon(
    "N's Zorua",
    [{ name: "Scratch", cost: ["Darkness"], convertedEnergyCost: 1, damage: "20" }],
    ["Darkness"],
  );

  const ctx = buildStrategyContext(["N's Zoroark ex", "N's Zorua", "N's Zekrom", "Pecharunt ex"]);

  it("active Zoroark ex (0 energy) wins over a bench Zekrom (0 energy)", () => {
    const zoroark = createCardInstance("N's Zoroark ex", PlayerId.P1, Zone.Active);
    const zekrom = createCardInstance("N's Zekrom", PlayerId.P1, Zone.Bench);
    const state = buildState(
      { "N's Zoroark ex": zoroarkDef, "N's Zekrom": zekromDef },
      zoroark, [zekrom],
    );
    expect(pickBestEnergyTarget(state, PlayerId.P1, ctx)).toBe(zoroark.instanceId);
  });

  it("Zoroark ex on the bench beats Zekrom + Darmanitan + Pecharunt + Zorua actives", () => {
    // Bench Zoroark must still win because the other options are all -200 / -150.
    const darmanitan = createCardInstance("N's Darmanitan", PlayerId.P1, Zone.Active);
    const zekrom = createCardInstance("N's Zekrom", PlayerId.P1, Zone.Bench);
    const pecha = createCardInstance("Pecharunt ex", PlayerId.P1, Zone.Bench);
    const zorua = createCardInstance("N's Zorua", PlayerId.P1, Zone.Bench);
    const zoroark = createCardInstance("N's Zoroark ex", PlayerId.P1, Zone.Bench);
    const state = buildState(
      {
        "N's Zoroark ex": zoroarkDef,
        "N's Zekrom": zekromDef,
        "N's Darmanitan": darmanitanDef,
        "Pecharunt ex": pecharuntDef,
        "N's Zorua": zoruaDef,
      },
      darmanitan, [zekrom, pecha, zorua, zoroark],
    );
    expect(pickBestEnergyTarget(state, PlayerId.P1, ctx)).toBe(zoroark.instanceId);
  });

  it("Zoroark ex fully loaded → still NEVER picks Zekrom (Zekrom is excluded)", () => {
    // Night Joker needs 2 Darkness; fully load Zoroark ex.
    const zoroark = createCardInstance("N's Zoroark ex", PlayerId.P1, Zone.Active);
    zoroark.attachedEnergy = [
      createCardInstance("D1", PlayerId.P1, Zone.Active),
      createCardInstance("D2", PlayerId.P1, Zone.Active),
    ];
    const zekrom = createCardInstance("N's Zekrom", PlayerId.P1, Zone.Bench);
    const state = buildState(
      { "N's Zoroark ex": zoroarkDef, "N's Zekrom": zekromDef, D1: zoroarkDef, D2: zoroarkDef },
      zoroark, [zekrom],
    );
    // Even with Zoroark fully loaded, the picker must NEVER choose Zekrom.
    // It may either pick Zoroark again (a wasted attach is mild) or return null,
    // but it must not return Zekrom's instanceId.
    const picked = pickBestEnergyTarget(state, PlayerId.P1, ctx);
    expect(picked).not.toBe(zekrom.instanceId);
  });
});
