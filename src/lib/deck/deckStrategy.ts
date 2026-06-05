/**
 * Meta deck strategy knowledge base.
 * Encodes tournament-researched play patterns for each archetype so the AI
 * and the analysis UI can make deck-aware decisions.
 */

import type { TournamentDeckPreset } from "./tournamentPresets";

// ─── Archetype identifiers ────────────────────────────────────────────────────

export type Archetype =
  | "dragapult"
  | "dragapult-dusknoir"
  | "lopunny"
  | "honchkrow"
  | "ogerpon-box"
  | "garchomp"
  | "zoroark"
  | "greninja"
  | "hydrapple"
  | "alakazam"
  | "unknown";

// ─── Strategy profile ────────────────────────────────────────────────────────

export interface AttackerRole {
  pokemonName: string;
  role: "primary" | "secondary" | "tech" | "setup";
  energyPriority: number; /** 0-100, higher = attach energy here first */
  benchFirst: boolean;   /** Put on bench before attacking */
}

export interface StrategyProfile {
  archetype: Archetype;
  displayName: string;
  winCondition: string;
  playstyle: "spread" | "tank-heal" | "discard-engine" | "toolbox" | "aggro";

  /** Pokémon names that identify this archetype (substring match, lowercase). */
  signatureCards: string[];

  /** Main attacker — which Pokémon attacks most. */
  primaryAttacker: string;

  /** Signature attack name that should be used when available. */
  signatureAttack?: string;

  /** Short T1/T2/T3 game plan. */
  gamePlan: string[];

  /** Trainer priority adjustments: name substring → score delta */
  trainerScoreAdjust: Record<string, number>;

  /**
   * When True, prefer going second (to item-lock on T1 with Budew, etc.).
   * Used in UI display — doesn't affect engine which doesn't control coin flip.
   */
  preferGoingSecond: boolean;

  /** Matchup notes vs other archetypes. */
  matchupNotes: Record<string, string>;

  attackerRoles: AttackerRole[];

  /** Cards to always bench early (substring match, lowercase). */
  benchPriority: string[];

  /** What Boss's Orders / Giovanni should target (in priority order). */
  bossPriority: string[];

  /** What to discard with Ultra Ball (prefer keeping these strings). */
  ultraBallKeep: string[];

  /** What to search with Ultra Ball / Poffin (priority order). */
  searchPriority: string[];
}

// ─── Strategy profiles ───────────────────────────────────────────────────────

export const STRATEGY_PROFILES: Record<Archetype, StrategyProfile> = {

  dragapult: {
    archetype: "dragapult",
    displayName: "Dragapult ex",
    winCondition:
      "Spread 50 damage to all opponent's bench with Phantom Dive, then use Munkidori's Adrena-Brain to move counters for multi-KO turns. Boss damaged bench Pokémon for prize rushes.",
    playstyle: "spread",
    signatureCards: ["dragapult ex", "dreepy", "drakloak", "munkidori"],
    primaryAttacker: "Dragapult ex",
    signatureAttack: "Phantom Dive",
    preferGoingSecond: true,
    gamePlan: [
      "T1 (going 2nd): Lead Budew — use Itchy Pollen to item-lock opponent. Poffin/Poké Pad to fill bench with 3–4 Dreepy.",
      "T2: Rare Candy Dreepy → Dragapult ex. Crispin to attach 2 energies in one turn. Drakloak's Recon Directive draws 6 as each Dreepy evolves.",
      "T3+: Phantom Dive every turn (120 active + 50 to each bench). Munkidori Adrena-Brain moves counters to finish damaged bench targets. Boss's Orders to pull 50-HP bench Pokémon.",
      "Priority targets for Boss: Manaphy (blocks bench damage), Dudunsparce, Fan Rotom, Fezandipiti ex.",
    ],
    trainerScoreAdjust: {
      "rare candy": 30,          // Higher priority — essential for Dreepy → Dragapult ex
      "lillie's determination": 10,
      "crispin": 15,             // Critical for powering Dragapult ex fast
      "boss's orders": 10,
      "buddy-buddy poffin": 15,  // Get Dreepy + Budew
      "poké pad": 15,
      "night stretcher": 5,
    },
    attackerRoles: [
      { pokemonName: "Dragapult ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Munkidori", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Fezandipiti ex", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Budew", role: "tech", energyPriority: 10, benchFirst: false },
      { pokemonName: "Dreepy", role: "setup", energyPriority: 60, benchFirst: true },
      { pokemonName: "Drakloak", role: "setup", energyPriority: 20, benchFirst: true },
    ],
    benchPriority: ["dreepy", "munkidori", "fezandipiti ex", "budew"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "meowth ex", "fezandipiti ex"],
    ultraBallKeep: ["dragapult ex", "munkidori", "fezandipiti ex"],
    searchPriority: ["dragapult ex", "munkidori", "fezandipiti ex", "dreepy", "budew"],
    matchupNotes: {
      lopunny: "Difficult — Battle Cage blocks bench spread. KO Lopunny before healing loop.",
      honchkrow: "Unfavorable — TR Articuno blocks Phantom Dive. Single-prize trades hurt.",
      "ogerpon-box": "Unfavorable — Lillie's Clefairy ex with Fairy Zone 2× weakness OHKOs Dragapult ex.",
    },
  },

  "dragapult-dusknoir": {
    archetype: "dragapult-dusknoir",
    displayName: "Dragapult ex / Dusknoir",
    winCondition:
      "Dragapult ex Phantom Dive spreads 50 damage to all bench Pokémon. Dusknoir Cursed Blast moves 13 damage counters for precision multi-KO. Team Rocket's Watchtower disables opponent Colorless abilities (Dudunsparce, Munkidori, etc.).",
    playstyle: "spread",
    signatureCards: ["dragapult ex", "dusknoir", "dreepy"],
    primaryAttacker: "Dragapult ex",
    signatureAttack: "Phantom Dive",
    preferGoingSecond: true,
    gamePlan: [
      "T1: Bench Dreepy ×3 + Duskull. Poffin/Poké Pad. Lead Budew if going second for item-lock.",
      "T2: Rare Candy Dreepy → Dragapult ex (primary). Crispin energises Dragapult ex fast. Drakloak Recon Directive draws cards.",
      "T3: Phantom Dive (120 + 50 to each bench). Dusknoir Cursed Blast precision placement. TR Watchtower disables Dudunsparce Run Away Draw.",
      "Late: Boss's Orders pull low-HP bench targets. Munkidori Adrena-Brain moves counters for KO. Dusknoir Cursed Blast consolidates for multi-prize turn.",
    ],
    trainerScoreAdjust: {
      "rare candy": 30,
      "crispin": 15,
      "rosa's encouragement": 10,
      "boss's orders": 10,
      "buddy-buddy poffin": 15,
      "team rocket's watchtower": 18, // Blocks opponent Colorless abilities (Dudunsparce, etc.)
    },
    attackerRoles: [
      { pokemonName: "Dragapult ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Dusknoir", role: "secondary", energyPriority: 0, benchFirst: true },
      { pokemonName: "Munkidori", role: "setup", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["dreepy", "duskull", "munkidori", "fezandipiti ex"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom"],
    ultraBallKeep: ["dragapult ex", "dusknoir", "munkidori"],
    searchPriority: ["dragapult ex", "dusknoir", "munkidori", "dreepy"],
    matchupNotes: {
      lopunny: "Hard — same as pure Dragapult but Dusknoir adds precision.",
      honchkrow: "Unfavorable — TR Articuno still blocks.",
    },
  },

  lopunny: {
    archetype: "lopunny",
    displayName: "Mega Lopunny ex",
    winCondition:
      "Gale Thrust from bench → active deals 280 damage (one-shots most ex Pokémon). Wally's Compassion heals all damage each cycle. Dudunsparce Run Away Draw refuels hand. Loop every turn.",
    playstyle: "tank-heal",
    signatureCards: ["mega lopunny ex", "buneary", "dudunsparce", "wally's compassion"],
    primaryAttacker: "Mega Lopunny ex",
    signatureAttack: "Gale Thrust",
    preferGoingSecond: false,
    gamePlan: [
      "T1: Poffin → Buneary + Dunsparce. Hilda → search Mega Lopunny ex + Mist Energy. Attach Mist Energy to BENCH Lopunny (blocks Phantom Dive counters).",
      "T2: Wally's Compassion → evolve Buneary → Mega Lopunny ex immediately. Attach Air Balloon to Mega Lopunny ex (free retreat). Move Lopunny bench → active → Gale Thrust for 280.",
      "Loop: with Air Balloon on Lopunny, retreat it FREE to the bench, promote a pivot (Dudunsparce → Run Away Draw to refuel, or Abra → Teleporter), then move Lopunny bench → active again so Gale Thrust re-earns its +170 moved-from-bench bonus. Wally's Compassion heals Lopunny each cycle.",
      "Always have Mist Energy on bench Lopunny — prevents Phantom Dive counter placement.",
    ],
    trainerScoreAdjust: {
      "wally's compassion": 25,  // Core healing — top priority
      "hilda": 20,
      "pokégear": 15,            // Find Wally/Hilda on demand
      "buddy-buddy poffin": 15,
      "boss's orders": 5,
      "air balloon": 15,         // Free retreat for Lopunny cycling
      "battle cage": 10,         // Blocks bench effects
    },
    attackerRoles: [
      { pokemonName: "Mega Lopunny ex", role: "primary", energyPriority: 90, benchFirst: true },
      { pokemonName: "Dudunsparce", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Fan Rotom", role: "setup", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["buneary", "mega lopunny ex", "dunsparce", "dudunsparce", "fan rotom"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "meowth ex", "fezandipiti ex"],
    ultraBallKeep: ["mega lopunny ex", "dudunsparce ex"],
    searchPriority: ["mega lopunny ex", "dudunsparce ex", "fan rotom", "buneary"],
    matchupNotes: {
      dragapult: "Favorable — 330 HP + Wally heal tanks Phantom Dive. Battle Cage blocks bench spread.",
      honchkrow: "Even — Honchkrow can load 4–5 Supporters for 270+ damage one-shot.",
      "ogerpon-box": "Slightly unfavorable — flexible attackers and type coverage.",
    },
  },

  honchkrow: {
    archetype: "honchkrow",
    displayName: "Team Rocket's Honchkrow",
    winCondition:
      "Load hand with Team Rocket Supporters (4–5), discard them with Rocket Feathers for 240–300 damage. TR Giovanni forces double-switch for favorable prize trades. Single-prize attacker vs ex decks = favorable prize math.",
    playstyle: "discard-engine",
    signatureCards: ["team rocket's honchkrow", "team rocket's murkrow", "team rocket's ariana"],
    primaryAttacker: "Team Rocket's Honchkrow",
    signatureAttack: "Rocket Feathers",
    preferGoingSecond: false,
    gamePlan: [
      "T1 (going first): TR Proton → search 3 Basic TR Pokémon from deck (fill bench with Murkrow ×2 + Porygon). TR Factory stadium. TR Transceiver → TR Ariana. Ariana draws 8 + Factory +2 = 10 cards.",
      "T2: Evolve Murkrow → Honchkrow. TR Giovanni → Honchkrow active + pull opponent's best Pokémon up. Roto-Stick top 4 for Supporters. Need 4 TR Supporters in hand. Ignition Energy to attack. Rocket Feathers: discard 4 Supporters = 240 damage.",
      "EFFICIENCY: Rocket Feathers discards the loaded Supporters when it fires, so attack (and commit the attacking Energy) ONLY on a turn it KOs the opponent's Active. If it isn't lethal yet, hold — keep loading TR Supporters and don't throw the hand away on chip damage.",
      "Recovery: TR Archer fires when Honchkrow is KO'd — shuffle both hands, you draw 5, opponent draws 3. Reload. Promote next Honchkrow.",
      "Late: TR Porygon2 R Command = 20 × TR Supporters in discard. With 12 discarded = 240 damage. Never stops threatening.",
    ],
    trainerScoreAdjust: {
      "team rocket's ariana": 30,     // Draw 8 with full TR bench — critical
      "team rocket's transceiver": 28, // Find any TR Supporter instantly
      "team rocket's factory": 25,    // +2 cards per Supporter play
      "team rocket's proton": 40,     // T1 bench fill — highest priority early
      "team rocket's archer": 20,
      "team rocket's giovanni": 22,   // Boss + retreat in one
      "team rocket's petrel": 18,
      "roto-stick": 24,               // Dig for Supporters
      "night stretcher": 10,
    },
    attackerRoles: [
      { pokemonName: "Team Rocket's Honchkrow", role: "primary", energyPriority: 90, benchFirst: false },
      { pokemonName: "Team Rocket's Porygon2", role: "secondary", energyPriority: 50, benchFirst: true },
      { pokemonName: "Team Rocket's Murkrow", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Team Rocket's Articuno", role: "setup", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["team rocket's murkrow", "team rocket's porygon", "team rocket's articuno"],
    bossPriority: ["dudunsparce", "fan rotom", "meowth ex", "manaphy"],
    // Keep TR Supporters — they are ammo for Rocket Feathers (60 damage each discarded)
    ultraBallKeep: [
      "team rocket's honchkrow",
      "team rocket's porygon2",
      "team rocket's ariana",
      "team rocket's archer",
      "team rocket's giovanni",
      "team rocket's proton",
      "team rocket's petrel",
    ],
    searchPriority: ["team rocket's honchkrow", "team rocket's porygon2", "team rocket's murkrow"],
    matchupNotes: {
      dragapult: "Favorable — TR Articuno blocks Phantom Dive. Single-prize trades strongly favor Honchkrow.",
      lopunny: "Even — Rocket Feathers at 270+ can one-shot Lopunny if loaded enough.",
      "ogerpon-box": "Favorable — single-prize attacker vs 2-prize ex Pokémon deck. Prize math wins.",
    },
  },

  "ogerpon-box": {
    archetype: "ogerpon-box",
    displayName: "Ogerpon Box",
    winCondition:
      "Flexible toolbox built around ONE loaded attacker at a time. Default closer: Mega Kangaskhan ex Rapid-Fire Combo (200+, costs 3 Colorless so ANY energy works, 300 HP tank). Teal Dance + Crispin + Energy Switch funnel energy onto the chosen attacker — don't spread it. Latias ex (Eon Blade 200) and Iron Leaves ex (Prism Edge 180) are alternate closers; Lillie's Clefairy ex Fairy Zone OHKOs Dragon types.",
    playstyle: "toolbox",
    signatureCards: ["mega kangaskhan ex", "teal mask ogerpon ex", "lillie's clefairy ex"],
    primaryAttacker: "Mega Kangaskhan ex",
    signatureAttack: "Rapid-Fire Combo",
    preferGoingSecond: false,
    gamePlan: [
      "T1: Teal Dance (attach Grass from hand to a Grass Pokémon, draw 1). Crispin → fetch 2 energies. Area Zero Underdepths stadium. Bench the attacker you want (default Mega Kangaskhan ex).",
      "T2: FOCUS all energy on ONE attacker — Mega Kangaskhan ex needs 3 of ANY energy for Rapid-Fire Combo (200+). Use Energy Switch to consolidate energy onto it, NOT to spread across Wellspring/Teal Mask/bench. Run Errand draws 2.",
      "Pick the closer for the matchup: vs Dragapult → Lillie's Clefairy ex (Fairy Zone ×2 = OHKO); otherwise Mega Kangaskhan ex (200+) or Latias ex Eon Blade (200). Boss's Orders → Manaphy/support first.",
      "Avoid weak chip attacks: never settle for Wellspring's Sob (20) — load the 3rd energy and swing for 100–200 instead.",
    ],
    trainerScoreAdjust: {
      "crispin": 25,                  // Energy acceleration core
      "energy switch": 20,            // Redistribute to correct attacker
      "cyrano": 22,                   // Search correct ex attacker
      "area zero underdepths": 15,    // 8-bench for Clefairy ex scaling
      "lillie's pearl": 18,           // Find Lillie's Clefairy ex
      "boss's orders": 10,
      "ultra ball": 8,
      "night stretcher": 8,
    },
    attackerRoles: [
      // ONE primary so energy concentrates (avoids the Sob-20 spread). Mega
      // Kangaskhan ex takes any energy (3 Colorless) and tanks at 300 HP.
      { pokemonName: "Mega Kangaskhan ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Latias ex", role: "secondary", energyPriority: 55, benchFirst: true },
      { pokemonName: "Iron Leaves ex", role: "secondary", energyPriority: 52, benchFirst: true },
      { pokemonName: "Wellspring Mask Ogerpon ex", role: "secondary", energyPriority: 50, benchFirst: false },
      { pokemonName: "Lillie's Clefairy ex", role: "tech", energyPriority: 45, benchFirst: true },
      { pokemonName: "Teal Mask Ogerpon ex", role: "setup", energyPriority: 30, benchFirst: false },
    ],
    benchPriority: ["mega kangaskhan ex", "teal mask ogerpon ex", "lillie's clefairy ex", "latias ex", "meowth ex"],
    bossPriority: ["manaphy", "dragapult ex", "dudunsparce", "fan rotom", "fezandipiti ex"],
    ultraBallKeep: ["mega kangaskhan ex", "teal mask ogerpon ex", "lillie's clefairy ex"],
    searchPriority: ["mega kangaskhan ex", "teal mask ogerpon ex", "lillie's clefairy ex", "latias ex"],
    matchupNotes: {
      dragapult: "Favorable — Lillie's Clefairy ex Fairy Zone OHKO. Set up Area Zero + Clefairy ex fast.",
      lopunny: "Slightly unfavorable — Lopunny's tank loop is hard to break.",
      honchkrow: "Unfavorable — single-prize Honchkrow vs 2-prize ex deck. Prize math loses.",
    },
  },

  garchomp: {
    archetype: "garchomp",
    displayName: "Cynthia's Garchomp ex",
    winCondition:
      "Cynthia's Garchomp ex Draconic Buster deals 260 damage (2-prize KO). Cynthia's Roserade blocks opponent's supporter effects. Build up Stage 2 line fast via Roselia → Roserade and Gible → Gabite → Garchomp ex.",
    playstyle: "aggro",
    signatureCards: ["cynthia's garchomp ex", "cynthia's gabite", "cynthia's gible", "cynthia's roselia"],
    primaryAttacker: "Cynthia's Garchomp ex",
    signatureAttack: "Draconic Buster",
    preferGoingSecond: false,
    gamePlan: [
      "T1: Bench Cynthia's Gible ×2 + Cynthia's Roselia. Attach energy to Gible.",
      "T2: Evolve Gible → Gabite → (Rare Candy) Garchomp ex. Evolve Roselia → Roserade. Attach energy.",
      "T3+: Garchomp ex Draconic Buster for 260. Roserade ability locks opponent's supporter effects.",
      "Priority: get multiple Gible on bench early so you always have a Garchomp ex follow-up.",
    ],
    trainerScoreAdjust: {
      "rare candy": 35,               // Essential — Stage 2 deck
      "cynthia's care": 25,           // Signature supporter
      "boss's orders": 10,
      "buddy-buddy poffin": 15,
      "ultra ball": 10,
      "iono": 8,
    },
    attackerRoles: [
      { pokemonName: "Cynthia's Garchomp ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Cynthia's Gabite", role: "setup", energyPriority: 40, benchFirst: true },
      { pokemonName: "Cynthia's Gible", role: "setup", energyPriority: 30, benchFirst: true },
      { pokemonName: "Cynthia's Roserade", role: "tech", energyPriority: 0, benchFirst: true },
      { pokemonName: "Cynthia's Roselia", role: "setup", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["cynthia's gible", "cynthia's roselia", "cynthia's gabite"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "meowth ex", "fezandipiti ex"],
    ultraBallKeep: ["cynthia's garchomp ex", "cynthia's gabite", "cynthia's roserade"],
    searchPriority: ["cynthia's garchomp ex", "cynthia's gabite", "cynthia's gible", "cynthia's roselia"],
    matchupNotes: {
      dragapult: "Even — Roserade blocks Phantom Dive resolution. Garchomp ex OHKO threats.",
      lopunny: "Favorable — 260 damage OHKOs Mega Lopunny ex before healing cycle.",
      honchkrow: "Unfavorable — single prize attacker vs 2-prize Garchomp ex.",
    },
  },

  zoroark: {
    archetype: "zoroark",
    displayName: "N's Zoroark ex",
    winCondition:
      "N's Zoroark ex's Night Joker copies one of YOUR OWN Benched N's Pokémon's attacks — primarily N's Zekrom's Rampaging Thunder (250). Keep N's Zekrom on the Bench as the damage battery (only Zoroark ex needs Darkness Energy). Rampaging Thunder locks the attacker out of attacking next turn, so use Pecharunt ex's Subjugating Chains to swap a FRESH Zoroark ex into the Active spot and swing 250 every turn.",
    playstyle: "toolbox",
    signatureCards: ["n's zoroark ex", "n's zorua", "n's zekrom", "pecharunt ex"],
    primaryAttacker: "N's Zoroark ex",
    signatureAttack: "Night Joker",
    preferGoingSecond: true,
    gamePlan: [
      "T1: Bench N's Zorua ×2 and N's Zekrom (the Night Joker damage source). Attach Darkness Energy to a Zorua/Zoroark line, NOT to Zekrom (it can't be powered).",
      "T2: Evolve Zorua → N's Zoroark ex. Night Joker → copy N's Zekrom's Rampaging Thunder for 250. Use Trade (discard 1, draw 2) to dig — but don't over-draw into a deck-out.",
      "Loop: Rampaging Thunder locks this Zoroark out of attacking next turn → Pecharunt ex Subjugating Chains swaps a fresh Benched N's Zoroark ex (with Energy) into Active so it can Night Joker → 250 again. Always keep N's Zekrom Benched.",
      "Tech: N's Darmanitan for Fire coverage, Munkidori/Fezandipiti ex utility, Boss's Orders to target the right Pokémon. Conserve deck — stop using Trade when the deck is low.",
    ],
    trainerScoreAdjust: {
      "boss's orders": 12,
      "iono": 12,                    // Hand disruption to go with Zekrom
      "ultra ball": 10,
      "night stretcher": 10,
      "pokégear": 8,
    },
    attackerRoles: [
      // Zoroark deck runs only Darkness Energy. Zekrom (F+L+L+C) and Darmanitan
      // (Fire) can't be powered up reliably; energy on them is wasted. Pecharunt
      // shares the Darkness type but starves the primary. Focus everything on
      // N's Zoroark ex — Night Joker copies the opponent's attack so it carries
      // the win condition alone.
      { pokemonName: "N's Zoroark ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "N's Zekrom", role: "secondary", energyPriority: 0, benchFirst: true },
      { pokemonName: "Pecharunt ex", role: "tech", energyPriority: 0, benchFirst: true },
      { pokemonName: "N's Darmanitan", role: "tech", energyPriority: 0, benchFirst: true },
      { pokemonName: "N's Zorua", role: "setup", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["n's zorua", "n's zekrom", "pecharunt ex", "munkidori"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "fezandipiti ex"],
    ultraBallKeep: ["n's zoroark ex", "n's zekrom", "pecharunt ex"],
    searchPriority: ["n's zoroark ex", "n's zekrom", "n's zorua", "pecharunt ex"],
    matchupNotes: {
      dragapult: "Even — Rampaging Thunder (250) two-shots Dragapult ex. Watch your deck count: Phantom Dive trades into long games, so don't over-Trade into a deck-out.",
      lopunny: "Unfavorable — hard to OHKO 330 HP Lopunny before its Wally heal cycle.",
      honchkrow: "Even — 250 swings race the single-prize attacker; take favorable 2-for-1 prize trades.",
    },
  },

  greninja: {
    archetype: "greninja",
    displayName: "Greninja ex / Froslass",
    winCondition:
      "Greninja ex Shinobi Blade hits for 170 and searches any card. Mirage Barrage does 120 to 2 targets. Dusknoir Cursed Blast moves damage counters for precision KOs. Mega Froslass ex Resentful Refrain (50× opponent hand) delivers burst finishers.",
    playstyle: "spread",
    signatureCards: ["greninja ex", "froakie", "frogadier", "mega froslass ex", "snorunt"],
    primaryAttacker: "Greninja ex",
    signatureAttack: "Shinobi Blade",
    preferGoingSecond: true,
    gamePlan: [
      "T1 (going 2nd): Budew item-lock. Bench Froakie ×2 + Snorunt + Duskull. Poffin/Poké Pad for bench.",
      "T2: Frogadier Summoning Jutsu → search Greninja ex + Dusknoir + Mega Froslass ex. Rare Candy or Grand Tree to evolve Froakie → Greninja ex.",
      "T3: Greninja ex Shinobi Blade (170) + search for next piece. Dusknoir Cursed Blast consolidates counters. Colress's Tenacity finds Stadium + Water Energy.",
      "Late: Mega Froslass ex Resentful Refrain when opponent has 6+ cards (300–350 damage). Glalie Damage Beat capitalises on accumulated counters. Boss's Orders to pull weakened bench targets.",
    ],
    trainerScoreAdjust: {
      "rare candy": 30,              // Froakie → Greninja ex (Stage 2)
      "grand tree": 25,              // Fast-evolve full chain from deck
      "colress's tenacity": 15,      // Search Stadium + Water Energy
      "boss's orders": 12,
      "buddy-buddy poffin": 15,      // Get Froakie + Budew
      "night stretcher": 10,
      "ultra ball": 8,
      "surfer": 10,                  // Switch + draw to 5 for attacker rotation
    },
    attackerRoles: [
      { pokemonName: "Greninja ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Mega Froslass ex", role: "secondary", energyPriority: 70, benchFirst: true },
      { pokemonName: "Glalie", role: "tech", energyPriority: 30, benchFirst: true },
      { pokemonName: "Dusknoir", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Frogadier", role: "setup", energyPriority: 30, benchFirst: true },
      { pokemonName: "Froakie", role: "setup", energyPriority: 20, benchFirst: true },
      { pokemonName: "Budew", role: "tech", energyPriority: 0, benchFirst: true },
      { pokemonName: "Latias ex", role: "tech", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["froakie", "snorunt", "duskull", "budew", "meowth ex"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "fezandipiti ex"],
    ultraBallKeep: ["greninja ex", "dusknoir", "mega froslass ex"],
    searchPriority: ["greninja ex", "dusknoir", "mega froslass ex", "froakie", "snorunt"],
    matchupNotes: {
      dragapult: "Favorable — Dusknoir precision counter placement synergizes with Greninja spread.",
      lopunny: "Unfavorable — Wally heals damage counters each cycle.",
      honchkrow: "Even — spread damage vs single-prize attacker.",
    },
  },

  hydrapple: {
    archetype: "hydrapple",
    displayName: "Hydrapple ex / Meganium",
    winCondition:
      "Meganium's ability accelerates Grass energy each turn. Hydrapple ex delivers high damage. Teal Mask Ogerpon ex Teal Dance attaches from deck. Build a full bench fast and overwhelm with energy acceleration.",
    playstyle: "aggro",
    signatureCards: ["hydrapple ex", "dipplin", "applin", "meganium", "bayleef", "chikorita"],
    primaryAttacker: "Hydrapple ex",
    signatureAttack: "Hydro Splash",
    preferGoingSecond: false,
    gamePlan: [
      "T1: Bench Chikorita + Applin + Teal Mask Ogerpon ex. Teal Dance attaches Grass from deck.",
      "T2: Evolve Chikorita → Bayleef → Meganium (Rare Candy). Meganium accelerates energy. Applin → Dipplin.",
      "T3: Dipplin → Hydrapple ex. Attach 2 energies via Meganium + manual. Attack for high damage.",
      "Late: Meganium keeps loading energies each turn. Replace KO'd attackers from bench.",
    ],
    trainerScoreAdjust: {
      "rare candy": 35,              // Critical — Chikorita → Meganium + Applin → Hydrapple ex
      "crispin": 20,                 // Extra energy acceleration
      "energy switch": 15,           // Move energy to correct attacker
      "boss's orders": 10,
      "buddy-buddy poffin": 15,
      "ultra ball": 8,
    },
    attackerRoles: [
      { pokemonName: "Hydrapple ex", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Teal Mask Ogerpon ex", role: "secondary", energyPriority: 70, benchFirst: true },
      { pokemonName: "Meganium", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Dipplin", role: "setup", energyPriority: 30, benchFirst: true },
      { pokemonName: "Chikorita", role: "setup", energyPriority: 10, benchFirst: true },
      { pokemonName: "Applin", role: "setup", energyPriority: 10, benchFirst: true },
    ],
    benchPriority: ["chikorita", "applin", "teal mask ogerpon ex", "bayleef", "meowth ex"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "fezandipiti ex"],
    ultraBallKeep: ["hydrapple ex", "meganium", "teal mask ogerpon ex"],
    searchPriority: ["hydrapple ex", "meganium", "dipplin", "chikorita", "applin"],
    matchupNotes: {
      dragapult: "Even — Fairy Zone doesn't apply. High-HP attackers can tank some hits.",
      lopunny: "Even — both decks have recovery mechanisms.",
      honchkrow: "Unfavorable — single-prize attacker vs 2-prize ex deck.",
    },
  },

  alakazam: {
    archetype: "alakazam",
    displayName: "Alakazam / Dudunsparce",
    winCondition:
      "Alakazam Powerful Hand places 2 damage counters per card in your hand on the opponent's Active Pokémon (20 damage per card). Maximise hand size with Dudunsparce Run Away Draw and Hilda before attacking. Dawn accelerates Psychic energy. Abra Teleporter shuffles Abra back to deck from Active to avoid being KO'd and bring up evolved Pokémon.",
    playstyle: "aggro",
    signatureCards: ["alakazam", "kadabra", "abra", "dudunsparce", "dawn"],
    primaryAttacker: "Alakazam",
    signatureAttack: "Powerful Hand",
    preferGoingSecond: false,
    gamePlan: [
      "T1: Bench Abra ×2 + Dunsparce. Use Hilda to search Kadabra + Alakazam or Dudunsparce. Attach Psychic energy.",
      "T2: Evolve Abra → Kadabra (draw from Psychic Draw ability). Rare Candy Abra → Alakazam if possible. Dawn attaches 2 Psychic energies from deck in one action.",
      "T3+: Alakazam Powerful Hand — keep hand ≥7 cards before attacking (= 140+ damage). Dudunsparce Run Away Draw refills hand each turn. Battle Cage protects bench from spread.",
      "Mid-game: Abra Teleporter shuffles damaged Abra back to deck — avoids KO, promotes evolved Pokémon to active. Hilda searches next Alakazam + energy.",
      "Priority: Always count hand size before attacking. 8 cards = 160 damage. 10 cards = 200 damage. Use Iono/Hilda draw before attacking.",
    ],
    trainerScoreAdjust: {
      "dawn": 35,                  // Critical — attach 2 Psychic energy in one action
      "hilda": 25,                 // Search Alakazam evolution line
      "rare candy": 30,            // Abra → Alakazam skip Kadabra
      "battle cage": 20,           // Blocks bench spread (essential vs Dragapult)
      "buddy-buddy poffin": 15,    // Get Abra + Dunsparce early
      "boss's orders": 10,
      "iono": 12,                  // Hand disruption + slight refill
      "ultra ball": 8,
    },
    attackerRoles: [
      { pokemonName: "Alakazam", role: "primary", energyPriority: 95, benchFirst: false },
      { pokemonName: "Kadabra", role: "setup", energyPriority: 50, benchFirst: true },
      { pokemonName: "Abra", role: "setup", energyPriority: 20, benchFirst: true },
      { pokemonName: "Dudunsparce", role: "setup", energyPriority: 0, benchFirst: true },
      { pokemonName: "Dunsparce", role: "setup", energyPriority: 0, benchFirst: true },
    ],
    benchPriority: ["abra", "dunsparce", "dudunsparce", "kadabra"],
    bossPriority: ["manaphy", "dudunsparce", "fan rotom", "fezandipiti ex", "meowth ex"],
    ultraBallKeep: ["alakazam", "kadabra", "abra", "dudunsparce"],
    searchPriority: ["alakazam", "kadabra", "abra", "dudunsparce", "dunsparce"],
    matchupNotes: {
      dragapult:
        "Favorable — Battle Cage blocks Phantom Dive. Powerful Hand at 8+ cards = 160 damage OHKOs Dragapult ex (170 HP).",
      lopunny:
        "Unfavorable — Wally's Compassion heals damage each cycle. Powerful Hand struggles to land back-to-back KOs.",
      honchkrow:
        "Favorable — single-prize Alakazam vs single-prize Honchkrow. Powerful Hand at 7 cards = 140 matches Rocket Feathers threshold.",
    },
  },

  unknown: {
    archetype: "unknown",
    displayName: "Unknown Archetype",
    winCondition: "General strategy — attack and draw cards efficiently.",
    playstyle: "aggro",
    signatureCards: [],
    primaryAttacker: "",
    preferGoingSecond: false,
    gamePlan: [
      "Draw cards and establish a bench.",
      "Attach energy to your main attacker.",
      "Attack every turn.",
    ],
    trainerScoreAdjust: {},
    attackerRoles: [],
    benchPriority: [],
    bossPriority: [],
    ultraBallKeep: [],
    searchPriority: [],
    matchupNotes: {},
  },
};

// ─── Archetype detection ──────────────────────────────────────────────────────

/**
 * Detect the archetype from a deck list text or from card names in play.
 * Uses substring matching on card names (case-insensitive).
 */
export function detectArchetype(deckText: string): Archetype {
  const lower = deckText.toLowerCase();

  // Order matters — check most specific first
  if (lower.includes("dragapult ex") && lower.includes("dusknoir")) return "dragapult-dusknoir";
  if (lower.includes("dragapult ex") || lower.includes("dreepy")) return "dragapult";
  if (lower.includes("mega lopunny ex") || lower.includes("buneary")) return "lopunny";
  if (
    lower.includes("team rocket's honchkrow") ||
    lower.includes("team rocket's murkrow") ||
    lower.includes("team rocket's ariana")
  ) return "honchkrow";
  if (lower.includes("cynthia's garchomp ex") || lower.includes("cynthia's gabite")) return "garchomp";
  if (lower.includes("n's zoroark ex") || lower.includes("n's zorua")) return "zoroark";
  // Greninja with Froslass — check before ogerpon-box (Greninja deck has no Ogerpon)
  if (lower.includes("greninja ex") && lower.includes("froakie")) return "greninja";
  // Hydrapple — check before ogerpon-box (Hydrapple deck has Teal Mask Ogerpon ex as secondary)
  if (lower.includes("hydrapple ex") || (lower.includes("dipplin") && lower.includes("meganium"))) return "hydrapple";
  if (
    lower.includes("teal mask ogerpon ex") ||
    lower.includes("lillie's clefairy ex") ||
    lower.includes("mega kangaskhan ex")
  ) return "ogerpon-box";
  // Alakazam — Abra/Kadabra/Alakazam evolution line
  if (lower.includes("alakazam") || (lower.includes("kadabra") && lower.includes("abra"))) return "alakazam";

  return "unknown";
}

/** Get strategy profile for a deck preset. */
export function getDeckStrategy(preset: TournamentDeckPreset): StrategyProfile {
  const archetype = detectArchetype(preset.text);
  return STRATEGY_PROFILES[archetype];
}

/** Get strategy profile for a deck text directly. */
export function getStrategyByText(deckText: string): StrategyProfile {
  return STRATEGY_PROFILES[detectArchetype(deckText)];
}

// ─── AI helpers ───────────────────────────────────────────────────────────────

/**
 * Returns an archetype score adjustment for a trainer card name.
 * Used to layer archetype-specific biases on top of the general trainer scoring.
 */
export function getArchetypeTrainerBonus(
  archetype: Archetype,
  cardNameLower: string,
): number {
  const profile = STRATEGY_PROFILES[archetype];
  let bonus = 0;
  for (const [keyword, delta] of Object.entries(profile.trainerScoreAdjust)) {
    if (cardNameLower.includes(keyword)) bonus += delta;
  }
  return bonus;
}

/**
 * Returns the energy attachment priority score for a Pokémon name
 * according to the archetype's strategy.
 * Higher = more important to attach energy here.
 */
export function getArchetypeEnergyPriority(
  archetype: Archetype,
  pokemonNameLower: string,
): number {
  const profile = STRATEGY_PROFILES[archetype];
  for (const role of profile.attackerRoles) {
    if (pokemonNameLower.includes(role.pokemonName.toLowerCase())) {
      return role.energyPriority;
    }
  }
  return 30; // default
}

/**
 * Returns the search priority score for a Pokémon name when searching the deck.
 */
export function getArchetypeSearchPriority(
  archetype: Archetype,
  pokemonNameLower: string,
): number {
  const profile = STRATEGY_PROFILES[archetype];
  const idx = profile.searchPriority.findIndex((s) =>
    pokemonNameLower.includes(s.toLowerCase()),
  );
  if (idx === -1) return 0;
  return Math.max(0, profile.searchPriority.length - idx) * 20;
}

/**
 * Returns the Boss's Orders target priority for an opponent's Pokémon.
 * Higher = more valuable to bring up as active target.
 */
export function getArchetypeBossPriority(
  archetype: Archetype,
  pokemonNameLower: string,
): number {
  const profile = STRATEGY_PROFILES[archetype];
  const idx = profile.bossPriority.findIndex((s) =>
    pokemonNameLower.includes(s.toLowerCase()),
  );
  if (idx === -1) return 0;
  return Math.max(0, profile.bossPriority.length - idx) * 25;
}

// ─── Matchup analysis ────────────────────────────────────────────────────────

export interface MatchupNote {
  p1Archetype: Archetype;
  p2Archetype: Archetype;
  note: string;
  favoredSide: "p1" | "p2" | "even";
}

export function getMatchupNote(p1: Archetype, p2: Archetype): MatchupNote {
  const p1Profile = STRATEGY_PROFILES[p1];
  const rawNote = p1Profile.matchupNotes[p2] ?? STRATEGY_PROFILES[p2].matchupNotes[p1];

  let favoredSide: "p1" | "p2" | "even" = "even";
  if (rawNote) {
    const lower = rawNote.toLowerCase();
    if (lower.includes("favorable") || lower.includes("wins") || lower.includes("strongly favor")) {
      favoredSide = "p1";
    } else if (lower.includes("unfavorable") || lower.includes("hard") || lower.includes("difficult")) {
      favoredSide = "p2";
    }
  }

  return {
    p1Archetype: p1,
    p2Archetype: p2,
    note: rawNote ?? "No matchup data available.",
    favoredSide,
  };
}

// ─── Context for AI ──────────────────────────────────────────────────────────

/**
 * Represents the strategy context derived from a player's in-game deck.
 * Built once per game from the card definitions in play.
 */
export interface StrategyContext {
  archetype: Archetype;
  profile: StrategyProfile;
}

/** Build strategy context from in-play card name strings. */
export function buildStrategyContext(cardNamesInPlay: string[]): StrategyContext {
  const joined = cardNamesInPlay.join("\n").toLowerCase();
  const archetype = detectArchetype(joined);
  return { archetype, profile: STRATEGY_PROFILES[archetype] };
}
