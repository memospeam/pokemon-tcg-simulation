import type { CardDefinition } from "../../models/definition";
import { isTool } from "../../models/definition";

export type ToolKind =
  | "air_balloon"
  | "cynthias_power_weight"
  | "lucky_helmet"
  | "handheld_fan"
  | "binding_mochi"
  | "lillies_pearl"
  | "heroes_cape"
  | "ancient_booster"
  | "maximum_belt"
  | "light_ball"
  | "brave_bangle"
  | "hops_choice_band"
  | "future_booster"
  | "rescue_board"
  | "occa_berry"
  | "payapa_berry"
  | "babiri_berry"
  | "colbur_berry"
  | "passho_berry"
  | "haban_berry"
  | "sacred_charm"
  | "thick_scale"
  | "unknown";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/pokémon/g, "pokemon")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const TOOL_PATTERNS: { test: RegExp; kind: ToolKind }[] = [
  {
    test: /retreat cost.*(?:is )?(?:\[?c\]? ?){0,2}(?:colorless ?){0,2}2 less|retreat cost of the pokemon this card is attached to is .*2 less/,
    kind: "air_balloon",
  },
  {
    test: /cynthia's pokemon this card is attached to gets \+70 hp/,
    kind: "cynthias_power_weight",
  },
  {
    test: /(?:draw 2 cards.*damaged by an attack from your opponent's pokemon|damaged by an attack from your opponent's pokemon.*draw 2 cards)/,
    kind: "lucky_helmet",
  },
  {
    test: /move an energy from the attacking pokemon to 1 of your opponent's benched pokemon/,
    kind: "handheld_fan",
  },
  {
    test: /attacks used by the poisoned pok[ée]mon this card is attached to do 40 more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)/,
    kind: "binding_mochi",
  },
  {
    test: /if the lillie's pok[ée]mon this card is attached to is knocked out by damage from an attack from your opponent's pok[ée]mon, that player takes 1 fewer prize card/,
    kind: "lillies_pearl",
  },
  {
    test: /(?:each )?pok[ée]mon this card is attached to gets \+100 hp/,
    kind: "heroes_cape",
  },
];

export function parseToolKind(def: CardDefinition): ToolKind {
  if (!isTool(def)) return "unknown";
  const text = normalize(def.rules?.join(" ") ?? def.name);
  for (const pattern of TOOL_PATTERNS) {
    if (pattern.test.test(text)) return pattern.kind;
  }
  if (def.name.toLowerCase().includes("air balloon")) return "air_balloon";
  if (def.name.toLowerCase().includes("power weight")) return "cynthias_power_weight";
  if (def.name.toLowerCase().includes("lucky helmet")) return "lucky_helmet";
  if (def.name.toLowerCase().includes("handheld fan")) return "handheld_fan";
  if (def.name.toLowerCase().includes("binding mochi")) return "binding_mochi";
  if (def.name.toLowerCase().includes("lillie's pearl")) return "lillies_pearl";
  if (def.name.toLowerCase().includes("hero's cape")) return "heroes_cape";
  const n = def.name.toLowerCase();
  if (n.includes("ancient booster")) return "ancient_booster";
  if (n.includes("maximum belt")) return "maximum_belt";
  if (n.includes("light ball")) return "light_ball";
  if (n.includes("brave bangle")) return "brave_bangle";
  if (n.includes("hop's choice band")) return "hops_choice_band";
  if (n.includes("future booster")) return "future_booster";
  if (n.includes("rescue board")) return "rescue_board";
  if (n.includes("occa berry")) return "occa_berry";
  if (n.includes("payapa berry")) return "payapa_berry";
  if (n.includes("babiri berry")) return "babiri_berry";
  if (n.includes("colbur berry")) return "colbur_berry";
  if (n.includes("passho berry")) return "passho_berry";
  if (n.includes("haban berry")) return "haban_berry";
  if (n.includes("sacred charm")) return "sacred_charm";
  if (n.includes("thick scale")) return "thick_scale";
  return "unknown";
}

export function parseToolKindFromText(text: string): ToolKind {
  const normalized = normalize(text);
  for (const pattern of TOOL_PATTERNS) {
    if (pattern.test.test(normalized)) return pattern.kind;
  }
  return "unknown";
}
