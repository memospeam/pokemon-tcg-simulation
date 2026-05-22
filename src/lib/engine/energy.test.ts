import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { PlayerId, Zone } from "../models/enums";
import { canAffordAttack } from "./energy";
import { canAttackThisTurn } from "./rules";
import type { EngineState } from "./types";

describe("energy", () => {
  it("requires attached energy to attack", () => {
    const attack = {
      name: "Test",
      cost: ["Fire", "Fire"],
      convertedEnergyCost: 2,
      damage: "50",
      text: "",
    };
    const pokemonDef: CardDefinition = {
      apiId: "mon",
      name: "Mon",
      supertype: "Pokémon",
      subtypes: ["Basic"],
      hp: "70",
      types: ["Fire"],
      attacks: [attack],
      set: { id: "t", name: "T" },
      number: "1",
      images: { small: "", large: "" },
    };
    const energyDef: CardDefinition = {
      apiId: "fire",
      name: "Fire Energy",
      supertype: "Energy",
      subtypes: ["Basic"],
      types: ["Fire"],
      set: { id: "t", name: "T" },
      number: "2",
      images: { small: "", large: "" },
    };
    const pokemon = createCardInstance("mon", PlayerId.P1, Zone.Hand);
    const energy = createCardInstance("fire", PlayerId.P1, Zone.Hand);
    pokemon.attachedEnergy = [energy];
    const state = {
      definitions: { mon: pokemonDef, fire: energyDef },
    } as unknown as EngineState;

    expect(canAffordAttack(state, pokemon, attack)).toBe(false);

    pokemon.attachedEnergy = [energy, createCardInstance("fire", PlayerId.P1, Zone.Hand)];
    pokemon.attachedEnergy[1].definitionId = "fire";
    expect(canAffordAttack(state, pokemon, attack)).toBe(true);
  });
});

describe("canAttackThisTurn", () => {
  it("blocks first player attack on turn 1", () => {
    const state = {
      turnNumber: 1,
      firstPlayerId: PlayerId.P1,
      currentPlayerId: PlayerId.P1,
    } as EngineState;
    expect(canAttackThisTurn(state)).toBe(false);
  });
});
