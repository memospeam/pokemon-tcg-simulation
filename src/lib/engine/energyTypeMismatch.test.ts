import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { PlayerId, Zone } from "../models/enums";
import { canAffordAttack } from "./energy";
import type { EngineState } from "./types";

/**
 * Regression: canPayCost (used by canAffordAttack) previously fell back to
 * treating any leftover typed energy as "colorless-paying", which let
 * mismatched typed energy pay typed costs (e.g. Water energy paying a
 * Fire cost). Per TCG rules, only the exact type, special energy that
 * provides that type, or Rainbow / flex energy may pay a typed requirement.
 *
 * A basic Water Energy attached to a Pokémon must NOT satisfy a {Fire}
 * attack cost.
 */

function makePokemonDef(): CardDefinition {
  return {
    apiId: "mon",
    name: "Mon",
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "70",
    types: ["Fire"],
    attacks: [],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function makeEnergyDef(name: string, type: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    types: [type],
    set: { id: "t", name: "T" },
    number: "9",
    images: { small: "", large: "" },
  };
}

describe("canAffordAttack typed-energy strictness", () => {
  it("Water energy alone cannot pay a Fire cost", () => {
    const attack = {
      name: "Burn",
      cost: ["Fire"],
      convertedEnergyCost: 1,
      damage: "20",
      text: "",
    };
    const pokemonDef = makePokemonDef();
    const waterDef = makeEnergyDef("Water Energy", "Water");

    const pokemon = createCardInstance("mon", PlayerId.P1, Zone.Active);
    const water = createCardInstance("waterEnergy", PlayerId.P1, Zone.Active);
    water.definitionId = "Water Energy";
    pokemon.attachedEnergy = [water];

    const state = {
      definitions: { mon: pokemonDef, "Water Energy": waterDef },
    } as unknown as EngineState;

    expect(canAffordAttack(state, pokemon, attack)).toBe(false);
  });

  it("Water energy can still pay a Colorless cost", () => {
    const attack = {
      name: "Tackle",
      cost: ["Colorless"],
      convertedEnergyCost: 1,
      damage: "10",
      text: "",
    };
    const pokemonDef = makePokemonDef();
    const waterDef = makeEnergyDef("Water Energy", "Water");

    const pokemon = createCardInstance("mon", PlayerId.P1, Zone.Active);
    const water = createCardInstance("waterEnergy", PlayerId.P1, Zone.Active);
    water.definitionId = "Water Energy";
    pokemon.attachedEnergy = [water];

    const state = {
      definitions: { mon: pokemonDef, "Water Energy": waterDef },
    } as unknown as EngineState;

    expect(canAffordAttack(state, pokemon, attack)).toBe(true);
  });

  it("Two Water energy cannot pay a Fire + Colorless cost", () => {
    const attack = {
      name: "Hybrid",
      cost: ["Fire", "Colorless"],
      convertedEnergyCost: 2,
      damage: "30",
      text: "",
    };
    const pokemonDef = makePokemonDef();
    const waterDef = makeEnergyDef("Water Energy", "Water");

    const pokemon = createCardInstance("mon", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("waterEnergy", PlayerId.P1, Zone.Active);
    e1.definitionId = "Water Energy";
    const e2 = createCardInstance("waterEnergy", PlayerId.P1, Zone.Active);
    e2.definitionId = "Water Energy";
    pokemon.attachedEnergy = [e1, e2];

    const state = {
      definitions: { mon: pokemonDef, "Water Energy": waterDef },
    } as unknown as EngineState;

    expect(canAffordAttack(state, pokemon, attack)).toBe(false);
  });

  it("Fire + Water energy pays Fire + Colorless cost", () => {
    const attack = {
      name: "Hybrid",
      cost: ["Fire", "Colorless"],
      convertedEnergyCost: 2,
      damage: "30",
      text: "",
    };
    const pokemonDef = makePokemonDef();
    const fireDef = makeEnergyDef("Fire Energy", "Fire");
    const waterDef = makeEnergyDef("Water Energy", "Water");

    const pokemon = createCardInstance("mon", PlayerId.P1, Zone.Active);
    const fire = createCardInstance("fireEnergy", PlayerId.P1, Zone.Active);
    fire.definitionId = "Fire Energy";
    const water = createCardInstance("waterEnergy", PlayerId.P1, Zone.Active);
    water.definitionId = "Water Energy";
    pokemon.attachedEnergy = [fire, water];

    const state = {
      definitions: {
        mon: pokemonDef,
        "Fire Energy": fireDef,
        "Water Energy": waterDef,
      },
    } as unknown as EngineState;

    expect(canAffordAttack(state, pokemon, attack)).toBe(true);
  });
});
