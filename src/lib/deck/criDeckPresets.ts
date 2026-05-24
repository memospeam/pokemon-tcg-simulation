import type { TournamentDeckPreset, TournamentPresetBundle } from "./tournamentPresets";

/** Playtest decklists built from corpus-resolvable Standard lines (CRI focus). */
export const CRI_PLAYTEST_DECKS: TournamentDeckPreset[] = [
  {
    id: "cri-greninja-water",
    label: "CRI — Mega Greninja ex (Water)",
    placement: 1,
    player: "Playtest",
    deckName: "Mega Greninja ex",
    text: `Pokémon : 18
4 Froakie CRI 20
3 Frogadier CRI 21
3 Mega Greninja ex CRI 22
2 Fezandipiti ex ASC 142
2 Budew ASC 16
2 Dunsparce JTG 120
1 Dudunsparce TEF 129
1 Meowth ex POR 62

Trainer : 32
4 Lillie's Determination MEG 119
4 Boss's Orders MEG 114
4 Ultra Ball MEG 131
4 Buddy-Buddy Poffin TEF 144
4 Crispin SCR 133
4 Night Stretcher ASC 196
3 Rare Candy MEG 125
2 Mega Signal MEG 121
3 Poké Pad POR 81

Energy : 10
7 Water Energy MEE 3
3 Enriching Energy SSP 191`,
  },
  {
    id: "cri-floette-psychic",
    label: "CRI — Mega Floette ex (Psychic)",
    placement: 2,
    player: "Playtest",
    deckName: "Mega Floette ex",
    text: `Pokémon : 14
4 Mega Floette ex CRI 35
3 Ange Floette CRI 75
2 Fezandipiti ex ASC 142
2 Budew ASC 16
1 Meowth ex POR 62
1 Dunsparce JTG 120
1 Dudunsparce TEF 129

Trainer : 32
4 Lillie's Determination MEG 119
4 Boss's Orders MEG 114
4 Ultra Ball MEG 131
4 Buddy-Buddy Poffin TEF 144
4 Crispin SCR 133
4 Night Stretcher ASC 196
3 Rare Candy MEG 125
2 Mega Signal MEG 121
3 Poké Pad POR 81

Energy : 14
10 Psychic Energy MEE 5
4 Enriching Energy SSP 191`,
  },
  {
    id: "cri-pyroar-fire",
    label: "CRI — Mega Pyroar ex (Fire)",
    placement: 3,
    player: "Playtest",
    deckName: "Mega Pyroar ex",
    text: `Pokémon : 15
4 Litleo CRI 14
3 Mega Pyroar ex CRI 15
2 Fezandipiti ex ASC 142
2 Budew ASC 16
2 Dunsparce JTG 120
1 Dudunsparce TEF 129
1 Meowth ex POR 62

Trainer : 33
4 Lillie's Determination MEG 119
4 Boss's Orders MEG 114
4 Ultra Ball MEG 131
4 Buddy-Buddy Poffin TEF 144
4 Crispin SCR 133
4 Night Stretcher ASC 196
3 Rare Candy MEG 125
2 Mega Signal MEG 121
3 Poké Pad POR 81
1 Professor's Research JTG 155

Energy : 12
8 Fire Energy MEE 2
4 Enriching Energy SSP 191`,
  },
  {
    id: "cri-dragalge-poison",
    label: "CRI — Mega Dragalge ex (Poison)",
    placement: 4,
    player: "Playtest",
    deckName: "Mega Dragalge ex",
    text: `Pokémon : 16
4 Skrelp CRI 58
3 Mega Dragalge ex CRI 65
2 Fezandipiti ex ASC 142
2 Budew ASC 16
2 Dunsparce JTG 120
1 Dudunsparce TEF 129
1 Meowth ex POR 62
1 Munkidori TWM 95

Trainer : 32
4 Lillie's Determination MEG 119
4 Boss's Orders MEG 114
4 Ultra Ball MEG 131
4 Buddy-Buddy Poffin TEF 144
4 Crispin SCR 133
4 Night Stretcher ASC 196
2 Rare Candy MEG 125
2 Mega Signal MEG 121
4 Poké Pad POR 81

Energy : 12
6 Psychic Energy MEE 5
4 Water Energy MEE 3
2 Enriching Energy SSP 191`,
  },
  {
    id: "cri-gallade-psychic",
    label: "CRI — Mega Gallade ex (Psychic)",
    placement: 5,
    player: "Playtest",
    deckName: "Mega Gallade ex",
    text: `Pokémon : 16
4 Ralts MEG 58
3 Kirlia MEG 59
3 Mega Gallade ex CRI 48
2 Fezandipiti ex ASC 142
2 Budew ASC 16
1 Meowth ex POR 62
1 Dunsparce JTG 120

Trainer : 32
4 Lillie's Determination MEG 119
4 Boss's Orders MEG 114
4 Ultra Ball MEG 131
4 Buddy-Buddy Poffin TEF 144
4 Crispin SCR 133
4 Night Stretcher ASC 196
3 Rare Candy MEG 125
2 Mega Signal MEG 121
3 Poké Pad POR 81

Energy : 12
8 Psychic Energy MEE 5
4 Enriching Energy SSP 191`,
  },
];

export const CRI_PLAYTEST_BUNDLE: TournamentPresetBundle = {
  tournamentId: 0,
  name: "Chaos Rising playtest presets",
  date: "2026-05-22",
  sourceUrl: "https://limitlesstcg.com/decks?format=standard",
  decks: CRI_PLAYTEST_DECKS,
};

export function getCriDeckById(id: string): TournamentDeckPreset | undefined {
  return CRI_PLAYTEST_DECKS.find((deck) => deck.id === id);
}
