import { describe, expect, it } from "vitest";
import { PlayerId } from "../models/enums";
import type { EngineState, GameAction } from "../engine/types";
import { getComboLines } from "./comboLines";

function state(oppHp: number, oppDamage: number, weakness?: { type: string; value: string }): EngineState {
  return {
    players: {
      [PlayerId.P1]: { active: { definitionId: "att", damageCounters: 0 } },
      [PlayerId.P2]: { active: { definitionId: "def", damageCounters: oppDamage } },
    },
    definitions: {
      att: {
        name: "Attacker",
        supertype: "Pokémon",
        types: ["Fighting"],
        hp: "300",
        attacks: [
          { name: "Big", damage: "200" },
          { name: "Small", damage: "60" },
        ],
      },
      def: { name: "Defender", supertype: "Pokémon", hp: String(oppHp), weaknesses: weakness ? [weakness] : undefined },
    },
  } as unknown as EngineState;
}

const attack = (name: string): GameAction => ({ type: "ATTACK", playerId: PlayerId.P1, attackName: name });
const finisher = () => getComboLines("dragapult")[0]!; // lethal-finisher is first for every archetype

describe("comboLines lethal finisher", () => {
  it("is shared by every archetype", () => {
    for (const a of ["dragapult", "lopunny", "zoroark", "unknown"] as const) {
      expect(getComboLines(a)[0]!.name).toBe("lethal-finisher");
    }
  });

  it("forces a lethal attack when one is legal", () => {
    const action = finisher().nextStep({ state: state(130, 0), playerId: PlayerId.P1, legal: [attack("Small"), attack("Big")] });
    expect(action).toEqual(attack("Big")); // 200 >= 130
  });

  it("returns null when no legal attack is lethal", () => {
    const action = finisher().nextStep({ state: state(130, 0), playerId: PlayerId.P1, legal: [attack("Small")] });
    expect(action).toBeNull(); // 60 < 130
  });

  it("counts weakness toward lethal", () => {
    // Small 60 ×2 (Fighting weakness) = 120 < 130 → still not lethal
    expect(finisher().nextStep({ state: state(130, 0, { type: "Fighting", value: "×2" }), playerId: PlayerId.P1, legal: [attack("Small")] })).toBeNull();
    // after 20 prior damage, 120 >= remaining 110 → lethal
    expect(finisher().nextStep({ state: state(130, 20, { type: "Fighting", value: "×2" }), playerId: PlayerId.P1, legal: [attack("Small")] })).toEqual(attack("Small"));
  });
});
