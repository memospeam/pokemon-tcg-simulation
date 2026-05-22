import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { getAttachedEnergyPool } from "../energy";
import { applyAttackDamagePhase } from "./attackFlow";
import {
  canAttachSpecialEnergyToPokemon,
  discardIgnitionEnergyAtEndOfTurn,
  isEnrichingEnergy,
  isIgnitionEnergy,
  isTeamRocketsEnergy,
  onSpecialEnergyAttachedFromHand,
} from "./specialEnergyEffects";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Fire"],
  attacks?: CardDefinition["attacks"],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks: attacks ?? [{ name: "Hit", cost: ["Colorless"], convertedEnergyCost: 1, damage: "20", text: "" }],
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
    subtypes: ["Special"],
    types,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function minimalBattleState(): EngineState {
  const active = mockBasic("Active", "120", ["Psychic"]);
  const activeInst = createCardInstance("active", PlayerId.P1, Zone.Active);
  const deckMon = createCardInstance("deck-abra", PlayerId.P1, Zone.Deck);
  const attackerInst = createCardInstance("attacker", PlayerId.P2, Zone.Active);

  return {
    phase: GamePhase.Active,
    turnNumber: 2,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [deckMon],
        hand: [],
        active: activeInst,
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
        active: attackerInst,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      active,
      "deck-abra": mockBasic("Abra", "50", ["Psychic"]),
      attacker: mockBasic("Attacker", "120", ["Fire"], [
        {
          name: "Burn Strike",
          cost: ["Fire"],
          convertedEnergyCost: 1,
          damage: "30",
          text: "Your opponent's Active Pokémon is now Burned.",
        },
      ]),
      enriching: mockEnergy("Enriching Energy"),
      ignition: mockEnergy("Ignition Energy"),
      telepathic: mockEnergy("Telepathic Psychic Energy", ["Psychic"]),
      rocky: mockEnergy("Rocky Fighting Energy", ["Fighting"]),
      rocket: mockEnergy("Team Rocket's Energy", ["Darkness"]),
      murkrow: mockBasic("Team Rocket's Murkrow", "80", ["Darkness"]),
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

describe("batch 8 special energy", () => {
  it("detects special energy by name", () => {
    expect(isEnrichingEnergy({ name: "Enriching Energy" } as CardDefinition)).toBe(true);
    expect(isIgnitionEnergy({ name: "Ignition Energy" } as CardDefinition)).toBe(true);
    expect(isTeamRocketsEnergy({ name: "Team Rocket's Energy" } as CardDefinition)).toBe(true);
  });

  it("blocks Team Rocket's Energy on non-Rocket Pokémon", () => {
    const state = minimalBattleState();
    const active = getPlayer(state, PlayerId.P1).active!;
    const check = canAttachSpecialEnergyToPokemon(
      state,
      state.definitions.rocket,
      active,
    );
    expect(check.ok).toBe(false);
  });

  it("Enriching Energy draws 4 on attach from hand", () => {
    const state = minimalBattleState();
    const player = getPlayer(state, PlayerId.P1);
    player.deck.push(
      createCardInstance("d1", PlayerId.P1, Zone.Deck),
      createCardInstance("d2", PlayerId.P1, Zone.Deck),
      createCardInstance("d3", PlayerId.P1, Zone.Deck),
      createCardInstance("d4", PlayerId.P1, Zone.Deck),
    );
    const energy = createCardInstance("enriching", PlayerId.P1, Zone.Hand);
    onSpecialEnergyAttachedFromHand(state, PlayerId.P1, energy, player.active!);
    expect(player.hand).toHaveLength(4);
  });

  it("Telepathic Psychic Energy searches Basic Psychic onto Bench", () => {
    const state = minimalBattleState();
    const player = getPlayer(state, PlayerId.P1);
    const energy = createCardInstance("telepathic", PlayerId.P1, Zone.Hand);
    onSpecialEnergyAttachedFromHand(state, PlayerId.P1, energy, player.active!);
    expect(player.bench).toHaveLength(1);
    expect(state.definitions[player.bench[0]!.definitionId]?.name).toBe("Abra");
  });

  it("Ignition Energy on Evolution provides triple Colorless", () => {
    const stage1: CardDefinition = { ...mockBasic("Stage1", "90"), subtypes: ["Stage 1"] };
    const state = minimalBattleState();
    state.definitions.active = stage1;
    const active = getPlayer(state, PlayerId.P1).active!;
    active.attachedEnergy = [createCardInstance("ignition", PlayerId.P1, Zone.Active)];
    const pool = getAttachedEnergyPool(state, active);
    expect(pool.colors.Colorless).toBe(3);
  });

  it("Team Rocket's Energy provides flexible Psychic/Darkness", () => {
    const state = minimalBattleState();
    const rocketMon = createCardInstance("murkrow", PlayerId.P1, Zone.Active);
    state.players[PlayerId.P1].active = rocketMon;
    rocketMon.attachedEnergy = [createCardInstance("rocket", PlayerId.P1, Zone.Active)];
    const pool = getAttachedEnergyPool(state, rocketMon);
    expect(pool.flexPsychicDark).toBe(2);
  });

  it("Ignition Energy is discarded at end of turn", () => {
    const state = minimalBattleState();
    const active = getPlayer(state, PlayerId.P1).active!;
    active.attachedEnergy = [createCardInstance("ignition", PlayerId.P1, Zone.Active)];
    discardIgnitionEnergyAtEndOfTurn(state, PlayerId.P1);
    expect(active.attachedEnergy).toHaveLength(0);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(1);
  });

  it("Rocky Fighting Energy blocks attack effects on Fighting Pokémon", () => {
    const fightingDef = mockBasic("Fighter", "120", ["Fighting"]);
    const state = minimalBattleState();
    const defender = createCardInstance("fighter", PlayerId.P1, Zone.Active);
    defender.attachedEnergy = [createCardInstance("rocky", PlayerId.P1, Zone.Active)];
    state.players[PlayerId.P1].active = defender;
    state.definitions.fighter = fightingDef;

    applyAttackDamagePhase(state, PlayerId.P2, "Burn Strike");
    expect(defender.statusConditions).not.toContain("Burned");
  });
});
