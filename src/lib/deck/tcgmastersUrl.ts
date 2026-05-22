/** Preset decklists compatible with tcgmasters.net / Limitless format. */

export const DRAGAPULT_DECK_1 = {
  name: "Los Angeles 1st: Dragapult (Andrew Hedrick)",
  text: `Pokémon: 18
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
2 Munkidori TWM 95
1 Dunsparce JTG 120
1 Dudunsparce TEF 129
1 Meowth ex POR 62
1 Fezandipiti ex ASC 142
1 Budew ASC 16

Trainer: 32
4 Lillie's Determination MEG 119
3 Crispin SCR 133
3 Boss's Orders MEG 114
1 Judge POR 76
4 Poké Pad POR 81
4 Buddy-Buddy Poffin TEF 144
4 Ultra Ball MEG 131
4 Crushing Hammer POR 71
2 Night Stretcher ASC 196
1 Unfair Stamp TWM 165
2 Risky Ruins MEG 127

Energy: 10
4 Psychic Energy MEE 5
3 Fire Energy MEE 2
3 Darkness Energy MEE 7`,
};

export const DRAGAPULT_DECK_2 = {
  name: "Los Angeles 2nd: Dragapult Dudunsparce (Jack Pitcher)",
  text: `Pokémon: 21
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
2 Dunsparce JTG 120
2 Dudunsparce TEF 129
1 Dudunsparce ex JTG 121
2 Munkidori TWM 95
1 Meowth ex POR 62
1 Fezandipiti ex ASC 142
1 Budew ASC 16

Trainer: 30
4 Lillie's Determination MEG 119
3 Crispin SCR 133
3 Boss's Orders MEG 114
1 Judge POR 76
4 Ultra Ball MEG 131
4 Poké Pad POR 81
4 Buddy-Buddy Poffin TEF 144
2 Rare Candy MEG 125
2 Night Stretcher ASC 196
1 Unfair Stamp TWM 165
2 Risky Ruins MEG 127

Energy: 9
3 Fire Energy MEE 2
3 Psychic Energy MEE 5
3 Darkness Energy MEE 7`,
};

export interface TcgMastersSharePayload {
  list1: string;
  list2: string;
  list1Name?: string;
  list2Name?: string;
}

export function encodeTcgMastersUrl(payload: TcgMastersSharePayload): string {
  const json = JSON.stringify(payload);
  return `#${btoa(json)}`;
}

export function decodeTcgMastersHash(hash: string): TcgMastersSharePayload | null {
  try {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!raw) return null;
    return JSON.parse(atob(raw)) as TcgMastersSharePayload;
  } catch {
    return null;
  }
}

export function parseLocationHash(): TcgMastersSharePayload | null {
  return decodeTcgMastersHash(window.location.hash);
}

export function buildShareUrl(payload: TcgMastersSharePayload): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}${encodeTcgMastersUrl(payload)}`;
}
