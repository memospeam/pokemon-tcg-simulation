import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { parseAbilityText } from "./parseText";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

const TELEPORTER_TEXT =
  "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle it and all attached cards into your deck.";

function mockBasic(
  name: string,
  hp = "60",
  types: string[] = ["Psychic"],
  abilities: CardDefinition["abilities"] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    abilities,
    attacks: [],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Psychic"]): CardDefinition {
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

describe("Alakazam Phase 3 — Abra Teleporter", () => {
  describe("parseAbilityText", () => {
    it("parses Teleporter to ability_only_while_active + shuffle_self_active_to_deck", () => {
      const parsed = parseAbilityText({ name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT });
      expect(parsed.effects).toEqual(
        expect.arrayContaining([
          { kind: "ability_only_while_active" },
          { kind: "shuffle_self_active_to_deck" },
        ]),
      );
    });

    it("does not produce generic_effect_stub for Teleporter", () => {
      const parsed = parseAbilityText({ name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT });
      expect(parsed.effects.some((e) => e.kind === "generic_effect_stub")).toBe(false);
    });

    it("sets frequency to once_per_turn for Teleporter", () => {
      const parsed = parseAbilityText({ name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT });
      expect(parsed.frequency).toBe("once_per_turn");
    });
  });

  describe("USE_ABILITY — Teleporter execution", () => {
    it("shuffles Abra from active into deck and creates PROMOTE pending", () => {
      const abraDef = mockBasic("Abra", "60", ["Psychic"], [
        { name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT },
      ]);
      const kadabraDef = mockBasic("Kadabra", "90", ["Psychic"]);

      const abra = createCardInstance("abra-def", PlayerId.P1, Zone.Active);
      const kadabra = createCardInstance("kadabra-def", PlayerId.P1, Zone.Bench);
      const base = battleState();

      const state = battleState({
        definitions: {
          ...base.definitions,
          "abra-def": abraDef,
          "kadabra-def": kadabraDef,
        },
        players: {
          ...base.players,
          [PlayerId.P1]: {
            ...base.players[PlayerId.P1],
            active: abra,
            bench: [kadabra],
            deck: [],
          },
        },
      });

      const after = gameReducer(state, {
        type: "USE_ABILITY",
        playerId: PlayerId.P1,
        pokemonId: abra.instanceId,
        abilityName: "Teleporter",
      });

      const p1 = getPlayer(after, PlayerId.P1);
      // Abra must no longer be active
      expect(p1.active).toBeNull();
      // Abra must be in the deck (shuffled in)
      expect(p1.deck.some((c) => c.instanceId === abra.instanceId)).toBe(true);
      // Kadabra must still be on the bench (PROMOTE pending, not yet resolved)
      expect(p1.bench.some((c) => c.instanceId === kadabra.instanceId)).toBe(true);
      // PROMOTE pending action must exist
      expect(after.pendingAction).toMatchObject({ type: "PROMOTE", playerId: PlayerId.P1 });
    });

    it("shuffles attached energy into deck alongside Abra", () => {
      const abraDef = mockBasic("Abra", "60", ["Psychic"], [
        { name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT },
      ]);
      const energyDef = mockEnergy("psychic-energy");
      const kadabraDef = mockBasic("Kadabra", "90", ["Psychic"]);

      const abra = createCardInstance("abra-def", PlayerId.P1, Zone.Active);
      const energy = createCardInstance("psy-energy", PlayerId.P1, Zone.Active);
      abra.attachedEnergy = [energy];
      const kadabra = createCardInstance("kadabra-def", PlayerId.P1, Zone.Bench);
      const base = battleState();

      const state = battleState({
        definitions: {
          ...base.definitions,
          "abra-def": abraDef,
          "psy-energy": energyDef,
          "kadabra-def": kadabraDef,
        },
        players: {
          ...base.players,
          [PlayerId.P1]: {
            ...base.players[PlayerId.P1],
            active: abra,
            bench: [kadabra],
            deck: [],
          },
        },
      });

      const after = gameReducer(state, {
        type: "USE_ABILITY",
        playerId: PlayerId.P1,
        pokemonId: abra.instanceId,
        abilityName: "Teleporter",
      });

      const p1 = getPlayer(after, PlayerId.P1);
      // Abra should be in the deck
      const abraInDeck = p1.deck.find((c) => c.instanceId === abra.instanceId);
      expect(abraInDeck).toBeDefined();
      // The attached energy should be in the deck alongside Abra (attached to the deck copy of Abra)
      // shufflePokemonAndAttachmentsToDeck keeps energy inside attachedEnergy but sets zone = Deck
      const energyInDeck = abraInDeck?.attachedEnergy.find((e) => e.instanceId === energy.instanceId);
      expect(energyInDeck).toBeDefined();
      expect(energyInDeck?.zone).toBe(Zone.Deck);
    });

    it("does NOT create PROMOTE when bench is empty", () => {
      const abraDef = mockBasic("Abra", "60", ["Psychic"], [
        { name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT },
      ]);
      const abra = createCardInstance("abra-def", PlayerId.P1, Zone.Active);
      const base = battleState();

      const state = battleState({
        definitions: { ...base.definitions, "abra-def": abraDef },
        players: {
          ...base.players,
          [PlayerId.P1]: {
            ...base.players[PlayerId.P1],
            active: abra,
            bench: [],
            deck: [],
          },
        },
      });

      const after = gameReducer(state, {
        type: "USE_ABILITY",
        playerId: PlayerId.P1,
        pokemonId: abra.instanceId,
        abilityName: "Teleporter",
      });

      // With no bench, PROMOTE must not be set (no Pokémon to promote)
      expect(after.pendingAction?.type).not.toBe("PROMOTE");
    });

    it("is blocked when Abra is on the bench (ability_only_while_active guard)", () => {
      const abraDef = mockBasic("Abra", "60", ["Psychic"], [
        { name: "Teleporter", type: "Ability", text: TELEPORTER_TEXT },
      ]);
      const otherDef = mockBasic("Other", "60", ["Colorless"]);

      const other = createCardInstance("other-def", PlayerId.P1, Zone.Active);
      const abraBench = createCardInstance("abra-def", PlayerId.P1, Zone.Bench);
      const base = battleState();

      const state = battleState({
        definitions: {
          ...base.definitions,
          "other-def": otherDef,
          "abra-def": abraDef,
        },
        players: {
          ...base.players,
          [PlayerId.P1]: {
            ...base.players[PlayerId.P1],
            active: other,
            bench: [abraBench],
            deck: [],
          },
        },
      });

      const after = gameReducer(state, {
        type: "USE_ABILITY",
        playerId: PlayerId.P1,
        pokemonId: abraBench.instanceId,
        abilityName: "Teleporter",
      });

      // USE_ABILITY should be rejected (Abra is on bench, not active)
      const p1 = getPlayer(after, PlayerId.P1);
      expect(p1.active?.instanceId).toBe(other.instanceId); // unchanged
      expect(p1.bench.some((c) => c.instanceId === abraBench.instanceId)).toBe(true); // Abra still on bench
      expect(after.pendingAction).toBeNull(); // no PROMOTE created
    });
  });
});
