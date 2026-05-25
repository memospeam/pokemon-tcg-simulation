import type { CardAbility, CardAttack } from "../../models/definition";
import type { AbilityCondition, ParsedAbility, ParsedEffect } from "./types";
import { countersToDamage } from "./types";
import { matchBulkClause, shouldSkipUnknownClause } from "./parseTextPatterns";
import { matchBulk3Clause } from "./parseTextBulk3";
import { matchBulk4Clause } from "./parseTextBulk4";
import { matchBulk5Clause } from "./parseTextBulk5";
import { matchBulk6Clause } from "./parseTextBulk6";
import { matchBulk7AttackText, matchBulk7Clause } from "./parseTextBulk7";
import { matchBulk8Clause } from "./parseTextBulk8";
import { matchFallbackClause } from "./parseTextFallback";
import { matchExtraClause } from "./parseTextExtra";

function normalize(text: string): string {
  return text
    .replace(/\{[^}]+\}/g, (match) => {
      const typeMap: Record<string, string> = {
        "{C}": "colorless",
        "{D}": "darkness",
        "{F}": "fighting",
        "{G}": "grass",
        "{L}": "lightning",
        "{M}": "metal",
        "{P}": "psychic",
        "{R}": "fire",
        "{W}": "water",
      };
      return typeMap[match] ?? match.replace(/[{}]/g, "").toLowerCase();
    })
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitClauses(text: string): string[] {
  if (!text) return [];
  return normalize(text)
    .split(/(?<=[.!])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseStatus(clause: string): ParsedEffect[] | null {
  const selfMatch = clause.match(/^this pok[ée]mon is now (?:also )?([\w,\s]+?)(?:\.|$)/i);
  if (selfMatch) {
    const statuses = selfMatch[1]!
      .split(/,|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean);
    return statuses.map((status) => ({
      kind: "status" as const,
      status: capitalize(status),
      target: "self_active" as const,
    }));
  }

  const match = clause.match(
    /^your opponent's active pok[ée]mon is now (?:also )?([\w,\s]+?)(?:\.|$)/i,
  );
  if (!match) return null;
  const statuses = match[1]!
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (statuses.length === 0) return null;
  return statuses.map((status) => ({
    kind: "status" as const,
    status: capitalize(status),
    target: "opponent_active" as const,
  }));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => capitalize(word))
    .join(" ");
}

function parseClause(clause: string): ParsedEffect[] {
  const effects: ParsedEffect[] = [];

  if (/^then, shuffle your deck\.?$/.test(clause)) {
    return effects;
  }

  if (/^\(apply weakness as [×x]2\.\)\.?$/.test(clause)) {
    return effects;
  }

  if (/don't apply weakness and resistance|doesn't apply weakness and resistance/.test(clause)) {
    return effects;
  }

  let match: RegExpMatchArray | null;

  match = clause.match(
    /put (\d+) damage counters on your opponent's benched pok[ée]mon in any way you like/,
  );
  if (match) {
    effects.push({ kind: "distribute_bench_counters", counters: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(/put (\d+) damage counters on each of your opponent's benched/);
  if (match) {
    effects.push({
      kind: "damage",
      amount: countersToDamage(parseInt(match[1]!, 10)),
      target: "opponent_bench_each",
      applyWeaknessRes: false,
    });
    return effects;
  }

  match = clause.match(
    /(?:this attack also )?does (\d+) damage to each of your opponent's benched pok[ée]mon/,
  );
  if (match) {
    effects.push({
      kind: "damage",
      amount: parseInt(match[1]!, 10),
      target: "opponent_bench_each",
      applyWeaknessRes: false,
    });
    return effects;
  }

  match = clause.match(/does (\d+) damage to 1 of your opponent's benched pok[ée]mon/);
  if (match) {
    effects.push({
      kind: "damage",
      amount: parseInt(match[1]!, 10),
      target: "opponent_bench_choose",
      applyWeaknessRes: false,
    });
    return effects;
  }

  match = clause.match(/put (\d+) damage counters on your opponent's active pok[ée]mon/);
  if (match) {
    effects.push({
      kind: "damage",
      amount: countersToDamage(parseInt(match[1]!, 10)),
      target: "opponent_active",
      applyWeaknessRes: false,
    });
    return effects;
  }

  match = clause.match(/move up to (\d+) damage counters from 1 of your pok[ée]mon to 1 of your opponent's pok[ée]mon/);
  if (match) {
    effects.push({
      kind: "move_damage",
      maxCounters: parseInt(match[1]!, 10),
      from: "your_pokemon",
      to: "opponent_pokemon",
    });
    return effects;
  }

  match = clause.match(/move up to (\d+) damage counters from 1 of your pok[ée]mon to another of your pok[ée]mon/);
  if (match) {
    effects.push({
      kind: "move_damage",
      maxCounters: parseInt(match[1]!, 10),
      from: "your_pokemon",
      to: "your_pokemon",
    });
    return effects;
  }

  match = clause.match(/draw (\d+) cards?/);
  if (match) {
    effects.push({ kind: "draw", count: parseInt(match[1]!, 10), target: "self" });
    return effects;
  }

  if (/^draw a card\.?$/.test(clause)) {
    effects.push({ kind: "draw", count: 1, target: "self" });
    return effects;
  }

  match = clause.match(/discard (\d+) energy from this pok[ée]mon/);
  if (match) {
    effects.push({
      kind: "discard_energy",
      count: parseInt(match[1]!, 10),
      from: "self_active",
    });
    return effects;
  }

  if (/^discard an energy from this pok[ée]mon\.?$/.test(clause)) {
    effects.push({ kind: "discard_energy", count: 1, from: "self_active" });
    return effects;
  }

  if (/^discard all energy from this pok[ée]mon\.?$/.test(clause)) {
    effects.push({ kind: "discard_all_energy", from: "self_active" });
    return effects;
  }

  match = clause.match(/this pok[ée]mon also does (\d+) damage to itself/);
  if (match) {
    effects.push({ kind: "self_recoil", amount: parseInt(match[1]!, 10) });
    return effects;
  }

  if (/^during your next turn, this pok[ée]mon can't attack\.?$/.test(clause)) {
    effects.push({ kind: "cant_attack_next_owner_turn" });
    return effects;
  }

  if (/^during your next turn, this pok[ée]mon can't use attacks\.?$/.test(clause)) {
    effects.push({ kind: "cant_attack_next_owner_turn" });
    return effects;
  }

  if (
    /^during your opponent's next turn, the defending pok[ée]mon can't use attacks\.?$/.test(clause)
  ) {
    effects.push({ kind: "cant_attack_defending_next_turn" });
    return effects;
  }

  match = clause.match(
    /^this pok[ée]mon takes (\d+) less damage from attacks \(after applying weakness and resistance\)\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_reduction_passive", amount: parseInt(match[1]!, 10) });
    return effects;
  }

  if (
    /^during your opponent's next turn, the defending pok[ée]mon can't retreat\.?$/.test(clause)
  ) {
    effects.push({ kind: "cant_retreat_defending_next_turn" });
    return effects;
  }

  match = clause.match(
    /^during your opponent's next turn, this pok[ée]mon takes (\d+) less damage from attacks \(after applying weakness and resistance\)\.?$/,
  );
  if (match) {
    effects.push({
      kind: "damage_reduction_next_opponent_turn",
      amount: parseInt(match[1]!, 10),
    });
    return effects;
  }

  if (
    /^switch out your opponent's active pok[ée]mon to the bench\.?$/.test(clause) ||
    /^\(your opponent chooses the new active pok[ée]mon\.\)?$/.test(clause)
  ) {
    if (/switch out your opponent's active/.test(clause)) {
      effects.push({ kind: "switch_opponent_active_to_bench" });
    }
    return effects;
  }

  match = clause.match(
    /^search your deck for up to (\d+) basic pok[ée]mon and put them onto your bench\.?$/,
  );
  if (match) {
    effects.push({ kind: "search_basic_to_bench", count: parseInt(match[1]!, 10) });
    return effects;
  }

  if (/^search your deck for a basic pok[ée]mon and put it onto your bench\.?$/.test(clause)) {
    effects.push({ kind: "search_basic_to_bench", count: 1 });
    return effects;
  }

  if (/^then, shuffle your deck\.?$/.test(clause)) {
    return effects;
  }

  if (/^switch this pok[ée]mon with 1 of your benched pok[ée]mon\.?$/.test(clause)) {
    effects.push({ kind: "switch_with_bench" });
    return effects;
  }

  if (/^move an energy from this pok[ée]mon to 1 of your benched pok[ée]mon\.?$/.test(clause)) {
    effects.push({ kind: "move_energy_to_bench" });
    return effects;
  }

  match = clause.match(/^you may draw cards until you have (\d+) cards in your hand\.?$/);
  if (match) {
    effects.push({
      kind: "draw_until_hand",
      targetCount: parseInt(match[1]!, 10),
      optional: true,
    });
    return effects;
  }

  match = clause.match(/^draw cards until you have (\d+) cards in your hand\.?$/);
  if (match) {
    effects.push({
      kind: "draw_until_hand",
      targetCount: parseInt(match[1]!, 10),
      optional: false,
    });
    return effects;
  }

  if (/^discard a random card from your opponent's hand\.?$/.test(clause)) {
    effects.push({ kind: "discard_random_opponent_hand", count: 1 });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) damage for each damage counter on this pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_per_self_counter", perCounter: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) more damage for each damage counter on this pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_per_self_counter_more", perCounter: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) more damage for each energy attached to both active pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({
      kind: "damage_per_energy_both_actives",
      perEnergy: parseInt(match[1]!, 10),
    });
    return effects;
  }

  match = clause.match(
    /^if your opponent's active pok[ée]mon is affected by a special condition, this attack does (\d+) more damage\.?$/,
  );
  if (match) {
    effects.push({
      kind: "damage_bonus_if_special_condition",
      amount: parseInt(match[1]!, 10),
    });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) damage for each of your benched pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_per_own_benched", perBench: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) more damage for each benched pok[ée]mon \(both yours and your opponent's\)\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_per_all_benched", perBench: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) damage for each energy attached to this pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_per_energy_on_self", perEnergy: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) more damage for each energy attached to your opponent's active pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({
      kind: "damage_per_energy_opponent_active",
      perEnergy: parseInt(match[1]!, 10),
    });
    return effects;
  }

  if (/^if you go second, you can't use this attack during your first turn\.?$/.test(clause)) {
    effects.push({ kind: "blocked_if_second_player_first_turn" });
    return effects;
  }

  if (
    /^during your opponent's next turn, prevent all damage done to this pok[ée]mon by attacks from basic non-colorless pok[ée]mon\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "prevent_damage_from_basic_non_colorless" });
    return effects;
  }

  if (/^your opponent reveals their hand\.?$/.test(clause)) {
    effects.push({ kind: "reveal_opponent_hand" });
    return effects;
  }

  match = clause.match(
    /^search your deck for up to (\d+) basic energy cards, reveal them, and put them into your hand\.?$/,
  );
  if (match) {
    effects.push({ kind: "search_basic_energy_to_hand", count: parseInt(match[1]!, 10) });
    return effects;
  }

  if (
    /^search your deck for a pok[ée]mon, reveal it, and put it into your hand\.?$/.test(clause)
  ) {
    effects.push({ kind: "search_pokemon_to_hand" });
    return effects;
  }

  if (/^you may switch this pok[ée]mon with 1 of your benched pok[ée]mon\.?$/.test(clause)) {
    effects.push({ kind: "optional_switch_with_bench" });
    return effects;
  }

  if (
    /^heal from this pok[ée]mon the same amount of damage you did to your opponent's active pok[ée]mon\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "heal_matching_damage_dealt" });
    return effects;
  }

  if (/^put an energy attached to this pok[ée]mon into your hand\.?$/.test(clause)) {
    effects.push({ kind: "return_energy_to_hand" });
    return effects;
  }

  match = clause.match(/^you may discard any amount of basic energy from your pok[ée]mon\.?$/);
  if (match) {
    effects.push({ kind: "discard_basic_energy_optional" });
    return effects;
  }

  match = clause.match(
    /^you may discard any number of supporter cards that have "(.+?)" in their name from your hand, and this attack does (\d+) damage for each card you discarded in this way\.?$/i,
  );
  if (match) {
    effects.push({ kind: "discard_named_supporters_from_hand_optional", nameFilter: match[1]!.trim() });
    effects.push({ kind: "damage_per_discarded_hand_cards", perCard: parseInt(match[2]!, 10) });
    return effects;
  }

  match = clause.match(/^you may discard up to (\d+) energy from your benched pok[ée]mon\.?$/);
  if (match) {
    effects.push({ kind: "discard_bench_energy_optional", max: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(/^this attack does (\d+) (more )?damage for each card you discarded in this way\.?$/);
  if (match) {
    effects.push({ kind: "damage_per_discarded_basic_energy", perCard: parseInt(match[1]!, 10) });
    return effects;
  }

  if (
    /^choose a random card from your opponent's hand\.?$/.test(clause) ||
    /^choose a random card from your opponent's hand, and your opponent reveals that card and shuffles it into their deck\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "shuffle_random_opponent_hand_to_deck" });
    return effects;
  }

  if (/^your opponent reveals that card and shuffles it into their deck\.?$/.test(clause)) {
    return effects;
  }

  if (
    /^search your deck for a card that evolves from this pok[ée]mon and put it onto this pok[ée]mon to evolve it\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "search_evolution_from_deck" });
    return effects;
  }

  if (/^search your deck for a supporter card, reveal it, and put it into your hand\.?$/.test(clause)) {
    effects.push({ kind: "search_supporter_to_hand" });
    return effects;
  }

  if (
    /^if festival grounds is in play, this pok[ée]mon may use an attack it has twice\./.test(clause) ||
    /^if the first attack knocks out your opponent's active pok[ée]mon, you may attack again after your opponent chooses a new active pok[ée]mon\.?$/.test(
      clause,
    )
  ) {
    if (/if festival grounds is in play/.test(clause)) {
      effects.push({ kind: "festival_grounds_double_attack" });
    }
    return effects;
  }

  match = clause.match(
    /^this attack does (\d+) damage for each pok[ée]mon tool attached to all of your pok[ée]mon\.?$/,
  );
  if (match) {
    effects.push({ kind: "damage_per_tools_on_your_pokemon", perTool: parseInt(match[1]!, 10) });
    return effects;
  }

  match = clause.match(
    /^choose 1 of your benched (.+?) pok[ée]mon's attacks and use it as this attack\.?$/,
  );
  if (match) {
    const raw = match[1]!.trim();
    const nameFilter = raw.toLowerCase().endsWith("'s") ? raw : `${raw}'s`;
    effects.push({ kind: "copy_benched_attack", nameFilter });
    return effects;
  }

  match = clause.match(
    /^(.+?) used by this pok[ée]mon costs (\w+) less for each prize card your opponent has taken\.?$/,
  );
  if (match) {
    effects.push({
      kind: "attack_cost_reduction_per_opponent_prize",
      attackName: titleCase(match[1]!.trim()),
      energyType: capitalize(match[2]!),
      perPrize: 1,
    });
    return effects;
  }

  if (
    /^the weakness of each of your opponent's dragon pok[ée]mon in play is now (\w+)\.?$/i.test(clause)
  ) {
    const typeMatch = clause.match(/is now (\w+)/);
    effects.push({
      kind: "override_opponent_dragon_weakness",
      weaknessType: capitalize(typeMatch?.[1] ?? "Psychic"),
    });
    return effects;
  }

  if (
    /^damage from attacks used by this pok[ée]mon isn't affected by any effects on your opponent's active pok[ée]mon\.?$/i.test(
      clause,
    )
  ) {
    effects.push({ kind: "ignore_opponent_active_modifiers" });
    return effects;
  }

  match = clause.match(
    /^attacks used by your future pok[ée]mon, except any (.+?), do (\d+) more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)\.?$/,
  );
  if (match) {
    effects.push({
      kind: "future_pokemon_active_damage_bonus",
      amount: parseInt(match[2]!, 10),
      excludeName: match[1]!.trim(),
    });
    return effects;
  }

  match = clause.match(
    /^this pok[ée]mon can't attack unless you have (\d+) or more (.+?) pok[ée]mon in play\.?$/,
  );
  if (match) {
    const raw = match[2]!.trim();
    const nameFilter = raw.toLowerCase().endsWith("'s") ? raw : `${raw}'s`;
    effects.push({
      kind: "cant_attack_unless_name_count_in_play",
      nameFilter,
      minCount: parseInt(match[1]!, 10),
    });
    return effects;
  }

  match = clause.match(/^this attack does (\d+) damage to 2 of your opponent's pok[ée]mon\.?$/);
  if (match) {
    effects.push({ kind: "damage_two_opponent", amount: parseInt(match[1]!, 10) });
    return effects;
  }

  if (
    /^if this pok[ée]mon has full hp and would be knocked out by damage from an attack, it is not knocked out, and its remaining hp becomes 10\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "survive_ko_full_hp" });
    return effects;
  }

  if (
    /^if this pok[ée]mon would be knocked out by damage from an attack, flip a coin\. if heads, this pok[ée]mon is not knocked out, and its remaining hp becomes 10\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "survive_ko_coin" });
    return effects;
  }

  match = clause.match(/^attach a basic (\w+) energy card from your hand to this pok[ée]mon\.?$/);
  if (match) {
    effects.push({
      kind: "attach_basic_energy_from_hand",
      energyType: capitalize(match[1]!),
      target: "self",
    });
    return effects;
  }

  match = clause.match(/^attach a basic (\w+) energy card from your hand to 1 of your pok[ée]mon\.?$/);
  if (match) {
    effects.push({
      kind: "attach_basic_energy_from_hand",
      energyType: capitalize(match[1]!),
      target: "your_pokemon",
    });
    return effects;
  }

  match = clause.match(/^attach a basic (\w+) energy card from your hand to 1 of your (.+) pok[ée]mon\.?$/);
  if (match) {
    const nameFilter = match[2]!.trim();
    effects.push({
      kind: "attach_basic_energy_from_hand",
      energyType: capitalize(match[1]!),
      target: "your_pokemon",
      nameFilter: nameFilter.toLowerCase().endsWith("'s") ? nameFilter : `${nameFilter}'s`,
    });
    return effects;
  }

  if (/^flip (\d+) coins\.?$/.test(clause)) {
    return effects;
  }

  match = clause.match(/^this attack does (\d+) (more )?damage for each heads\.?$/);
  if (match) {
    effects.push({
      kind: "coin_multi_damage",
      perHeads: parseInt(match[1]!, 10),
      coinCount: 2,
      bonusOnly: !!match[2],
    });
    return effects;
  }

  if (
    /^before doing damage, discard all pok[ée]mon tools from your opponent's active pok[ée]mon\.?$/.test(
      clause,
    )
  ) {
    effects.push({ kind: "discard_opponent_tools" });
    return effects;
  }

  match = clause.match(/^discard the top card of your opponent's deck\.?$/);
  if (match) {
    effects.push({ kind: "mill_opponent_deck", count: 1 });
    return effects;
  }

  if (/^discard an energy from your opponent's active pok[ée]mon\.?$/.test(clause)) {
    effects.push({ kind: "discard_energy", count: 1, from: "opponent_active" });
    return effects;
  }

  match = clause.match(/discard (\d+) energy from your opponent's active pok[ée]mon/);
  if (match) {
    effects.push({ kind: "discard_energy", count: parseInt(match[1]!, 10), from: "opponent_active" });
    return effects;
  }

  match = clause.match(/heal (\d+) damage from this pok[ée]mon/);
  if (match) {
    effects.push({ kind: "heal", amount: parseInt(match[1]!, 10), target: "self_active" });
    return effects;
  }

  if (/during your opponent's next turn, they can't play any item cards from their hand/.test(clause)) {
    effects.push({ kind: "block_opponent_items_next_turn" });
    return effects;
  }

  if (/look at the top 2 cards of your deck and put 1 of them into your hand/.test(clause)) {
    effects.push({ kind: "recon_directive" });
    return effects;
  }

  if (/^put the other card on the bottom of your deck\.?$/.test(clause)) {
    return effects;
  }

  const status = parseStatus(clause);
  if (status) {
    effects.push(...status);
    return effects;
  }

  const bulk = matchBulkClause(clause);
  if (bulk) {
    effects.push(...bulk);
    return effects;
  }

  const extra = matchExtraClause(clause);
  if (extra) {
    effects.push(...extra);
    return effects;
  }

  const bulk3 = matchBulk3Clause(clause);
  if (bulk3) {
    effects.push(...bulk3);
    return effects;
  }

  const bulk4 = matchBulk4Clause(clause);
  if (bulk4) {
    effects.push(...bulk4);
    return effects;
  }

  const bulk5 = matchBulk5Clause(clause);
  if (bulk5 !== null) {
    effects.push(...bulk5);
    return effects;
  }

  const bulk6 = matchBulk6Clause(clause);
  if (bulk6) {
    effects.push(...bulk6);
    return effects;
  }

  const bulk7 = matchBulk7Clause(clause);
  if (bulk7 !== null) {
    effects.push(...bulk7);
    return effects;
  }

  const bulk8 = matchBulk8Clause(clause);
  if (bulk8 !== null) {
    effects.push(...bulk8);
    return effects;
  }

  const fallback = matchFallbackClause(clause);
  if (fallback !== null) {
    effects.push(...fallback);
    return effects;
  }

  if (clause.length > 0 && !shouldSkipUnknownClause(clause) && !/^this attack's damage isn't affected/.test(clause)) {
    effects.push({ kind: "generic_effect_stub", text: clause });
  }
  return effects;
}

export function parseAttackText(text: string): ParsedEffect[] {
  const normalized = normalize(text);

  if (/^flip a coin\. if tails, this attack does nothing\.?$/.test(normalized)) {
    return [{ kind: "coin_attack_fails_on_tails" }];
  }

  const coinBonus = normalized.match(/^flip a coin\. if heads, this attack does (\d+) more damage\.?$/);
  if (coinBonus) {
    return [{ kind: "coin_damage_bonus", amount: parseInt(coinBonus[1]!, 10) }];
  }

  const coinStatus = normalized.match(
    /^flip a coin\. if heads, your opponent's active pok[ée]mon is now (\w+)\.?$/,
  );
  if (coinStatus) {
    return [
      {
        kind: "coin_flip",
        heads: [
          { kind: "status", status: capitalize(coinStatus[1]!), target: "opponent_active" },
        ],
        tails: [],
      },
    ];
  }

  if (
    /^flip a coin\. if heads, discard an energy from your opponent's active pok[ée]mon\.?$/.test(
      normalized,
    )
  ) {
    return [
      {
        kind: "coin_flip",
        heads: [{ kind: "discard_energy", count: 1, from: "opponent_active" }],
        tails: [],
      },
    ];
  }

  if (
    /^flip a coin\. if heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this pok[ée]mon\.?$/.test(
      normalized,
    )
  ) {
    return [
      {
        kind: "coin_flip",
        heads: [{ kind: "prevent_damage_effects_next_opponent_turn" }],
        tails: [],
      },
    ];
  }

  const flipNCoins = normalized.match(
    /^flip (\d+) coins\. this attack does (\d+) (more )?damage for each heads\.?$/,
  );
  if (flipNCoins) {
    return [
      {
        kind: "coin_multi_damage",
        perHeads: parseInt(flipNCoins[2]!, 10),
        coinCount: parseInt(flipNCoins[1]!, 10),
        bonusOnly: !!flipNCoins[3],
      },
    ];
  }

  const bulk7Attack = matchBulk7AttackText(normalized);
  if (bulk7Attack) return bulk7Attack;

  const clauses = splitClauses(text);
  return coalesceSplitEffects(clauses.flatMap(parseClause), normalized);
}

/** Parse generic effect clauses (shared by attacks, abilities, and trainer rules text). */
export function parseEffectClauses(text: string): ParsedEffect[] {
  if (!text.trim()) return [];
  const normalized = normalize(text);
  const clauses = splitClauses(text);
  return coalesceSplitEffects(clauses.flatMap(parseClause), normalized);
}

function coalesceSplitEffects(effects: ParsedEffect[], normalized: string): ParsedEffect[] {
  const coinCountMatch = normalized.match(/flip (\d+) coins/);
  const coinCount = coinCountMatch ? parseInt(coinCountMatch[1]!, 10) : null;
  const noWeaknessRes = /don't apply weakness and resistance|doesn't apply weakness and resistance/.test(normalized);
  const result: ParsedEffect[] = [];

  for (const effect of effects) {
    if (isUnparsedClauseEffect(effect) && shouldSkipUnknownClause(effect.text)) {
      continue;
    }
    if (isUnparsedClauseEffect(effect) && /^flip \d+ coins\.?$/.test(effect.text)) {
      continue;
    }
    if (effect.kind === "coin_multi_damage" && coinCount !== null) {
      result.push({ ...effect, coinCount });
      continue;
    }
    if (effect.kind === "damage_choose_opponent" && noWeaknessRes && effect.applyWeaknessRes) {
      result.push({ ...effect, applyWeaknessRes: false });
      continue;
    }
    result.push(effect);
  }
  return result;
}

function isUnparsedClauseEffect(
  effect: ParsedEffect,
): effect is { kind: "unknown" | "generic_effect_stub"; text: string } {
  return effect.kind === "unknown" || effect.kind === "generic_effect_stub";
}

function mergeAbilityEffects(effects: ParsedEffect[]): ParsedEffect[] {
  const merged: ParsedEffect[] = [];
  for (const effect of effects) {
    if (effect.kind === "apply_status_to_new_active") {
      const prev = merged[merged.length - 1];
      if (
        prev?.kind === "switch_bench_typed_to_active" ||
        prev?.kind === "switch_bench_named_to_active"
      ) {
        merged[merged.length - 1] = { ...prev, applyStatus: effect.status };
        continue;
      }
    }
    if (
      isUnparsedClauseEffect(effect) &&
      /^if you do, the new active pok[ée]mon is now poisoned\.?$/i.test(effect.text)
    ) {
      const prev = merged[merged.length - 1];
      if (
        prev?.kind === "switch_bench_typed_to_active" ||
        prev?.kind === "switch_bench_named_to_active"
      ) {
        merged[merged.length - 1] = { ...prev, applyStatus: "Poisoned" };
        continue;
      }
    }
    if (
      isUnparsedClauseEffect(effect) &&
      /^if you attached energy to a pok[ée]mon in this way, draw a card/.test(effect.text)
    ) {
      const prev = merged[merged.length - 1];
      if (prev?.kind === "attach_basic_energy_from_hand") {
        merged[merged.length - 1] = { ...prev, drawOnAttach: true };
        continue;
      }
    }
    if (
      isUnparsedClauseEffect(effect) &&
      /^if you attached energy to a pok[ée]mon in this way, heal (\d+) damage from that pok[ée]mon/.test(
        effect.text,
      )
    ) {
      const prev = merged[merged.length - 1];
      const healMatch = effect.text.match(/heal (\d+)/);
      if (prev?.kind === "attach_basic_energy_from_hand" && healMatch) {
        merged[merged.length - 1] = {
          ...prev,
          healOnAttach: parseInt(healMatch[1]!, 10),
        };
        continue;
      }
    }
    merged.push(effect);
  }
  return merged;
}

export function parseAbilityText(ability: CardAbility): ParsedAbility {
  const text = normalize(ability.text);
  const conditions: AbilityCondition[] = [];
  let body = text;

  if (/once during your first turn,?\s*/.test(body)) {
    body = body.replace(/once during your first turn,?\s*/, "");
  } else if (/once during your turn/.test(body)) {
    body = body.replace(/once during your turn,?\s*/, "");
  }
  if (/as often as you like during your turn/.test(body)) {
    body = body.replace(/as often as you like during your turn,?\s*/, "");
  }

  if (/you must discard a card from your hand in order to use this ability/.test(body)) {
    conditions.push({ type: "discard_from_hand_to_use" });
    body = body.replace(/you must discard a card from your hand in order to use this ability\.?\s*/, "");
  }

  const evolveTriggerPrefix =
    /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon, you may use this ability\.?\s*/i;
  const hasEvolveTrigger = evolveTriggerPrefix.test(body);
  if (hasEvolveTrigger) {
    body = body.replace(evolveTriggerPrefix, "");
  }

  if (/if any of your pok[ée]mon were knocked out during your opponent's last turn/i.test(body)) {
    conditions.push({ type: "own_ko_opponent_last_turn" });
    body = body.replace(
      /if any of your pok[ée]mon were knocked out during your opponent's last turn,?\s*(?:you may\s*)?/i,
      "",
    );
  }

  const energyMatch = body.match(
    /if this pok[ée]mon has any (?:darkness|\{d\}|dark) energy attached,?\s*you may /,
  );
  if (energyMatch) {
    conditions.push({ type: "has_energy_type", energyType: "Darkness" });
    body = body.replace(energyMatch[0], "");
  } else if (/if this pok[ée]mon has any energy attached/.test(body)) {
    conditions.push({ type: "has_any_energy" });
    body = body.replace(/if this pok[ée]mon has any energy attached,?\s*you may /, "");
  } else {
    body = body.replace(/^you may /, "");
  }

  const frequency: ParsedAbility["frequency"] = /once during your (?:first )?turn/.test(text)
    ? "once_per_turn"
    : /as often as you like during your turn/.test(text)
      ? "unlimited"
      : /if this pok[ée]mon has full hp|if this pok[ée]mon would be knocked out|this pok[ée]mon takes \d+ less damage from attacks|damage from attacks used by this pokémon isn't affected|blood moon used by this pokémon costs|the weakness of each of your opponent's dragon|attacks used by your future pokémon|this pokémon can't attack unless you have|as long as this pok[ée]mon|prevent all damage|prevent all effects|when you play this pok[ée]mon|when your opponent's|each of your pok[ée]mon|all of your pok[ée]mon|your basic pok[ée]mon|pok[ée]mon in play \(both yours|if this pok[ée]mon is knocked out by damage|attacks used by your pok[ée]mon do/i.test(
            text,
          )
        ? "passive"
        : "unlimited";

  return {
    name: ability.name,
    frequency,
    conditions,
    effects: mergeAbilityEffects([
      ...( /once during your first turn/i.test(text)
        ? [{ kind: "once_during_first_turn" as const }]
        : []),
      ...(hasEvolveTrigger ? [{ kind: "evolve_trigger_ability" as const }] : []),
      ...splitClauses(body).flatMap(parseClause),
    ]),
    rawText: ability.text,
  };
}

export function summarizeEffects(effects: ParsedEffect[]): string {
  return effects
    .map((effect) => {
      switch (effect.kind) {
        case "damage":
          return `${effect.amount} dmg → ${effect.target.replace(/_/g, " ")}`;
        case "distribute_bench_counters":
          return `Place ${effect.counters} counters on opponent's Bench`;
        case "draw":
          return `Draw ${effect.count}`;
        case "status":
          return `Apply ${effect.status}`;
        case "move_damage":
          return `Move up to ${effect.maxCounters} counters`;
        case "discard_energy":
          return `Discard ${effect.count} Energy`;
        case "heal":
          return `Heal ${effect.amount}`;
        case "block_opponent_items_next_turn":
          return "Opponent can't play Items next turn";
        case "recon_directive":
          return "Look at top 2 of deck, pick 1 for hand";
        case "self_recoil":
          return `Recoil ${effect.amount} to self`;
        case "discard_all_energy":
          return "Discard all Energy from self";
        case "cant_attack_next_owner_turn":
          return "Can't attack next turn";
        case "cant_retreat_defending_next_turn":
          return "Defender can't retreat next turn";
        case "damage_reduction_next_opponent_turn":
          return `${effect.amount} less damage next opponent turn`;
        case "prevent_damage_effects_next_opponent_turn":
          return "Prevent damage/effects next opponent turn";
        case "switch_opponent_active_to_bench":
          return "Switch opponent Active to Bench";
        case "switch_with_bench":
          return "Switch with Benched Pokémon";
        case "search_basic_to_bench":
          return `Search up to ${effect.count} Basic → Bench`;
        case "move_energy_to_bench":
          return "Move Energy to Bench";
        case "draw_until_hand":
          return `Draw until ${effect.targetCount} in hand`;
        case "discard_random_opponent_hand":
          return "Discard random card from opponent hand";
        case "damage_reduction_passive":
          return `${effect.amount} less damage (passive)`;
        case "cant_attack_defending_next_turn":
          return "Defender can't attack next turn";
        case "coin_multi_damage":
          return `Flip ${effect.coinCount} coins → ${effect.perHeads}/heads`;
        case "damage_per_self_counter":
          return `${effect.perCounter} dmg per counter on self`;
        case "mill_opponent_deck":
          return `Mill ${effect.count} from opponent deck`;
        case "discard_opponent_tools":
          return "Discard opponent's Tools";
        case "damage_per_energy_both_actives":
          return `+${effect.perEnergy} per Energy on both Actives`;
        case "damage_bonus_if_special_condition":
          return `+${effect.amount} if Special Condition`;
        case "damage_per_all_benched":
          return `+${effect.perBench} per all Benched`;
        case "damage_per_own_benched":
          return `+${effect.perBench} per your Benched`;
        case "damage_per_energy_on_self":
          return `${effect.perEnergy} dmg per Energy on self`;
        case "damage_per_energy_opponent_active":
          return `+${effect.perEnergy} per Energy on opponent Active`;
        case "damage_per_self_counter_more":
          return `+${effect.perCounter} per counter on self`;
        case "reveal_opponent_hand":
          return "Reveal opponent hand";
        case "search_basic_energy_to_hand":
          return `Search ${effect.count} Basic Energy → hand`;
        case "search_named_pokemon_to_hand":
          return `Search ${effect.nameFilter} Pokémon → hand`;
        case "search_pokemon_to_hand":
          return "Search Pokémon → hand";
        case "redistribute_opponent_counters":
          return "Redistribute damage on opponent's Pokémon";
        case "discard_hand_energy_ko_opponent_active":
          return `Discard ${effect.count} ${effect.energyType} from hand → KO Active`;
        case "optional_switch_with_bench":
          return "Optional switch with Bench";
        case "heal_matching_damage_dealt":
          return "Heal damage dealt to opponent";
        case "return_energy_to_hand":
          return "Return Energy to hand";
        case "damage_two_opponent":
          return `${effect.amount} dmg to 2 opponent Pokémon`;
        case "prevent_damage_from_basic_non_colorless":
          return "Prevent dmg from Basic non-Colorless";
        case "survive_ko_full_hp":
          return "Survive KO at full HP";
        case "survive_ko_coin":
          return "Coin flip to survive KO";
        case "attach_basic_energy_from_hand":
          return `Attach Basic ${effect.energyType} from hand`;
        case "blocked_if_second_player_first_turn":
          return "Blocked on first turn going second";
        case "discard_basic_energy_optional":
          return "Optional discard Basic Energy";
        case "discard_bench_energy_optional":
          return `Optional discard up to ${effect.max} Bench Energy`;
        case "damage_per_discarded_basic_energy":
          return `+${effect.perCard} per discarded Basic Energy`;
        case "shuffle_random_opponent_hand_to_deck":
          return "Shuffle random opponent hand card → deck";
        case "search_evolution_from_deck":
          return "Search evolution from deck";
        case "search_supporter_to_hand":
          return "Search Supporter → hand";
        case "festival_grounds_double_attack":
          return "Festival Grounds: attack again";
        case "damage_per_tools_on_your_pokemon":
          return `+${effect.perTool} per Tool on your Pokémon`;
        case "copy_benched_attack":
          return `Copy ${effect.nameFilter} bench attack`;
        case "attack_cost_reduction_per_opponent_prize":
          return `${effect.attackName} costs ${effect.perPrize} ${effect.energyType} less per Prize taken`;
        case "override_opponent_dragon_weakness":
          return `Opponent's Dragon Weakness → ${effect.weaknessType}`;
        case "ignore_opponent_active_modifiers":
          return "Ignore effects on opponent Active";
        case "future_pokemon_active_damage_bonus":
          return `Future Pokémon +${effect.amount} to Active`;
        case "cant_attack_unless_name_count_in_play":
          return `Need ${effect.minCount}+ ${effect.nameFilter} in play to attack`;
        case "discard_stadium":
          return "Discard Stadium";
        case "damage_bonus_per_opponent_prize":
          return `+${effect.perPrize} per opponent Prize taken`;
        case "damage_per_typed_energy":
          return `+${effect.perEnergy} per ${effect.energyType} on ${effect.scope}`;
        case "damage_per_opponent_active_counter":
          return `+${effect.perCounter} per counter on opponent Active`;
        case "damage_per_opponent_benched":
          return `+${effect.perBench} per opponent Benched`;
        case "damage_less_per_self_counter":
          return `-${effect.perCounter} per counter on self`;
        case "cant_reuse_attack_until_leave_active":
          return `Can't reuse ${effect.attackName} until leaves Active`;
        case "cant_use_named_attack_next_turn":
          return `Can't use ${effect.attackName} next turn`;
        case "retaliate_damage_counters":
          return `Retaliate ${effect.counters} counters`;
        case "prevent_damage_next_turn":
          return `Prevent damage next turn (${effect.filter})`;
        case "damage_bonus_if_opponent_tag":
          return `+${effect.amount} if opponent ${effect.tag}`;
        case "shuffle_attached_energy_to_deck":
          return `Shuffle ${effect.count} Energy → deck`;
        case "defending_attack_damage_reduction":
          return `Defender's attacks -${effect.amount}`;
        case "damage_choose_opponent":
          return `${effect.amount} dmg to 1 opponent Pokémon`;
        case "return_self_to_hand":
          return "Return self to hand";
        case "disable_opponent_attack_next_turn":
          return "Disable opponent attack next turn";
        case "opponent_discard_from_hand":
          return "Opponent discards from hand";
        case "on_bench_play_switch_and_move_energy":
          return "On Bench: optional switch + move Energy";
        case "allow_attack_first_turn_if_go_first":
          return "Usable turn 1 if going first";
        case "knock_out_self_on_ability_use":
          return "KO self when using Ability";
        case "ability_only_while_active":
          return "Ability only while Active";
        case "evolve_trigger_ability":
          return "Trigger on evolve from hand";
        case "ability_use_limit_per_turn":
          return `Limit 1 ${effect.namePattern} per turn`;
        case "poison_attacker_when_damaged_from_opponent":
          return "Poison attacker when damaged";
        case "prevent_damage_from_ability_pokemon":
          return "Prevent damage from Ability Pokémon";
        case "switch_bench_named_to_active":
          return `Switch ${effect.nameFilter} from Bench`;
        case "switch_bench_typed_to_active":
          return `Switch ${effect.typeFilter} from Bench`;
        case "attach_energy_from_discard":
          return `Attach ${effect.count} ${effect.energyType} from discard`;
        case "attach_hand_energy_to_benched":
          return `Attach ${effect.count} ${effect.energyType} from hand`;
        case "search_attach_energy_each_bench":
          return `Search ${effect.energyType} → each Bench`;
        case "discard_special_energy_opponent":
          return "Discard Special Energy from opponent Active";
        case "search_item_to_hand":
          return "Search Item → hand";
        case "move_opponent_energy_to_bench":
          return "Move opponent Energy to Bench";
        case "copy_opponent_active_attack":
          return "Copy opponent Active attack";
        case "if_damaged_flip_coin":
          return "If damaged, flip a coin";
        case "coin_flip_attack_fails_on_tails_defending":
          return "Coin: tails blocks Defending attack";
        case "requires_stadium_in_play":
          return "Requires Stadium in play";
        case "attach_unlimited_basic_energy_from_hand":
          return "Attach unlimited Basic Energy from hand";
        case "shuffle_hand_into_deck":
          return "Shuffle hand into deck";
        case "damage_per_all_in_play":
          return `+${effect.perPokemon} per your Pokémon in play`;
        case "require_discard_energy_to_use_ability":
          return `Discard ${effect.energyType} to use Ability`;
        case "prevent_item_supporter_effects_on_self":
          return "Block Item/Supporter effects on self";
        case "no_retreat_cost_if_no_energy":
          return "Free retreat if no Energy";
        case "mill_self_deck":
          return `Mill ${effect.count} from your deck`;
        case "search_any_to_hand":
          return "Search any card → hand";
        case "recover_pokemon_from_discard":
          return `Recover ${effect.count} ${effect.nameFilter} from discard`;
        case "search_attach_energy_to_self":
          return `Search ${effect.count} ${effect.energyType} → self`;
        case "choose_two_opponent_bench":
          return "Choose 2 opponent Bench Pokémon";
        case "coin_attack_fails_on_tails":
          return "Coin: tails = no damage";
        case "coin_damage_bonus":
          return `Coin: heads +${effect.amount} damage`;
        case "coin_flip":
          return "Coin flip effect";
        case "unknown":
          return `(manual) ${effect.text.slice(0, 40)}`;
        case "generic_effect_stub":
          return `(stub) ${effect.text.slice(0, 40)}`;
        default: {
          return effect.kind.replace(/_/g, " ");
        }
      }
    })
    .join(" · ");
}

export function getAttackEffectSummary(attack: CardAttack): string {
  const effects = parseAttackText(attack.text);
  if (effects.length === 0) return "";
  return summarizeEffects(effects);
}
