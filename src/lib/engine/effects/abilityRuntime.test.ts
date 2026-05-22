import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { parseAbilityText } from "./parseText";
import {
  canUseAbilityNow,
  getExecutableAbilityEffects,
  hasActivatableAbility,
} from "./abilities";
import { hasPreventAttackEffectsOnSelf, isProtectedFromAttackEffects } from "./modifiers";
import { onDefenderDamagedByAttack } from "./abilityHooks";
import type { EngineState } from "../types";
import { emptyTurnFlags } from "../types";

function mockPokemon(
  name: string,
  apiId: string,
  extra: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    apiId,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "70",
    types: ["Colorless"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
    ...extra,
  };
}

function minimalState(activeIsP1 = true): EngineState {
  const active = createCardInstance("p1-active", PlayerId.P1, Zone.Active);
  const bench = createCardInstance("p1-bench", PlayerId.P1, Zone.Bench);
  return {
    phase: "Active" as EngineState["phase"],
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
        active: activeIsP1 ? active : null,
        bench: activeIsP1 ? [bench] : [bench],
        prizes: Array.from({ length: 6 }, (_, i) =>
          createCardInstance(`prize-${i}`, PlayerId.P1, Zone.Prizes),
        ),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: activeIsP1 ? null : active,
        bench: [],
        prizes: Array.from({ length: 6 }, (_, i) =>
          createCardInstance(`prize2-${i}`, PlayerId.P2, Zone.Prizes),
        ),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      "p1-active": mockPokemon("Fezandipiti ex", "p1-active", {
        hp: "210",
        types: ["Psychic"],
        abilities: [
          {
            name: "Flip the Script",
            type: "Ability",
            text: "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.",
          },
        ],
      }),
      "p1-bench": mockPokemon("Budew", "p1-bench", {
        hp: "30",
        types: ["Grass"],
        abilities: [
          {
            name: "Itchy Pollen",
            type: "Ability",
            text: "Each of your opponent's Active Pokémon has no Abilities. (This includes Pokémon that come into play on that spot.)",
          },
        ],
      }),
    },
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: null,
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
  };
}

describe("ability runtime", () => {
  it("filters passive-only abilities from USE_ABILITY", () => {
    const parsed = parseAbilityText({
      name: "Itchy Pollen",
      type: "Ability",
      text: "Each of your opponent's Active Pokémon has no Abilities. (This includes Pokémon that come into play on that spot.)",
    });
    expect(hasActivatableAbility(parsed)).toBe(false);
    expect(getExecutableAbilityEffects(parsed.effects)).toHaveLength(0);
  });

  it("keeps draw as executable for Trade-style abilities", () => {
    const parsed = parseAbilityText({
      name: "Trade",
      type: "Ability",
      text: "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.",
    });
    expect(hasActivatableAbility(parsed)).toBe(true);
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      { kind: "draw", count: 2, target: "self" },
    ]);
  });

  it("blocks ability_only_while_active on bench", () => {
    const state = minimalState(true);
    state.players[PlayerId.P1].deck = [
      createCardInstance("deck-1", PlayerId.P1, Zone.Deck),
    ];
    state.definitions["deck-1"] = {
      apiId: "deck-1",
      name: "Energy",
      supertype: "Energy",
      subtypes: ["Basic"],
      types: ["Colorless"],
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
    const bench = state.players[PlayerId.P1].bench[0]!;
    const parsed = parseAbilityText({
      name: "Test",
      type: "Ability",
      text: "Once during your turn, if this Pokémon is in the Active Spot, you may draw a card.",
    });
    expect(parsed.effects.some((effect) => effect.kind === "ability_only_while_active")).toBe(true);
    expect(canUseAbilityNow(state, bench, parsed)).toBe(false);
    expect(canUseAbilityNow(state, state.players[PlayerId.P1].active!, parsed)).toBe(true);
  });

  it("applies prevent_attack_effects_on_self passively", () => {
    const state = minimalState(true);
    state.definitions["p1-active"] = mockPokemon("Protector", "p1-active", {
      abilities: [
        {
          name: "Protect",
          type: "Ability",
          text: "Prevent all damage from and effects of attacks done to this Pokémon by your opponent's Pokémon.",
        },
      ],
    });
    const active = state.players[PlayerId.P1].active!;
    expect(hasPreventAttackEffectsOnSelf(state, active)).toBe(true);
    expect(isProtectedFromAttackEffects(state, active)).toBe(true);
  });

  it("applies retaliate counters when damaged by an attack", () => {
    const state = minimalState(true);
    state.definitions["p2-active"] = mockPokemon("Annihilape", "p2-active", {
      subtypes: ["Stage 1"],
      hp: "140",
      types: ["Fighting"],
      abilities: [
        {
          name: "Counter",
          type: "Ability",
          text: "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
        },
      ],
    });
    const defender = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const attacker = state.players[PlayerId.P1].active!;
    state.players[PlayerId.P2].active = defender;

    onDefenderDamagedByAttack(state, defender, attacker, 30);
    expect(attacker.damageCounters).toBe(30);
  });
});
