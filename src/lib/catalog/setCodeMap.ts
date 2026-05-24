/** Limitless/PTCGO set codes mapped to pokemontcg.io set.ptcgoCode values. */
const SET_CODE_MAP: Record<string, string> = {
  ASC: "ASC",
  BLK: "BLK",
  CRI: "CRI",
  DRI: "DRI",
  JTG: "JTG",
  ME4: "CRI",
  MEG: "MEG",
  MEE: "MEE",
  PAL: "PAL",
  PAR: "PAR",
  POR: "POR",
  SCR: "SCR",
  SFA: "SFA",
  SVE: "SVE",
  SVI: "SVI",
  TEF: "TEF",
  TWM: "TWM",
  SSP: "SSP",
  OBF: "OBF",
  MEW: "MEW",
  PAF: "PAF",
  PRE: "PRE",
  PFL: "PFL",
  WHT: "WHT",
};

export function normalizeSetCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return SET_CODE_MAP[upper] ?? upper;
}
