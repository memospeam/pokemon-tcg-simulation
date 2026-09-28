/** Short match sounds made in the browser. No audio files. */

export type SfxKind =
  | "coin"
  | "attack"
  | "damage"
  | "ko"
  | "prize"
  | "evolve"
  | "play"
  | "draw"
  | "win"
  | "turn";

const RANK: Record<SfxKind, number> = {
  win: 100,
  ko: 90,
  prize: 80,
  attack: 70,
  evolve: 60,
  turn: 55,
  coin: 50,
  play: 40,
  damage: 30,
  draw: 20,
};

const STORAGE_KEY = "ptcg-sfx";

let muted = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "off";
let ctx: AudioContext | null = null;

export function isSfxMuted(): boolean {
  return muted;
}

export function setSfxMuted(next: boolean): void {
  muted = next;
  localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
}

export function unlockSfx(): Promise<void> {
  const audio = audioContext();
  if (!audio) return Promise.resolve();
  if (audio.state === "suspended") return audio.resume().then(() => undefined);
  return Promise.resolve();
}

/** The most important cue among log lines added in one update. */
export function sfxCueForLine(line: string): SfxKind | null {
  if (/wins the game/i.test(line)) return "win";
  if (/knocked out/i.test(line)) return "ko";
  if (/took \d+ prize/i.test(line)) return "prize";
  if (/ used .+ for \d+ damage/i.test(line)) return "attack";
  if (/evolv/i.test(line)) return "evolve";
  if (/coin flip/i.test(line)) return "coin";
  if (/played |placed .+ on the bench|placed .+ as active|attached /i.test(line)) return "play";
  if (/damage|recoil/i.test(line)) return "damage";
  if (/drew /i.test(line)) return "draw";
  return null;
}

export function sfxCueForLines(lines: string[]): SfxKind | null {
  let best: SfxKind | null = null;
  for (const line of lines) {
    const cue = sfxCueForLine(line);
    if (!cue) continue;
    if (!best || RANK[cue] > RANK[best]) best = cue;
  }
  return best;
}

export function playSfx(kind: SfxKind): void {
  if (muted) return;
  const audio = audioContext();
  if (!audio || audio.state !== "running") return;

  const t = audio.currentTime;
  switch (kind) {
    case "coin":
      blip(audio, 880, t, 0.06, 0.08);
      blip(audio, 1174, t + 0.08, 0.08, 0.08);
      break;
    case "attack":
      noise(audio, t, 0.12, 0.06);
      blip(audio, 180, t, 0.14, 0.1, "sawtooth");
      break;
    case "damage":
      noise(audio, t, 0.05, 0.04);
      break;
    case "ko":
      blip(audio, 440, t, 0.1, 0.08);
      blip(audio, 277, t + 0.09, 0.16, 0.08);
      blip(audio, 185, t + 0.2, 0.22, 0.07);
      break;
    case "prize":
      blip(audio, 660, t, 0.08, 0.07);
      blip(audio, 880, t + 0.09, 0.12, 0.07);
      break;
    case "evolve":
      blip(audio, 523, t, 0.07, 0.06);
      blip(audio, 659, t + 0.07, 0.07, 0.06);
      blip(audio, 784, t + 0.14, 0.12, 0.06);
      break;
    case "play":
      blip(audio, 520, t, 0.04, 0.04, "triangle");
      break;
    case "draw":
      blip(audio, 740, t, 0.04, 0.035, "triangle");
      break;
    case "turn":
      blip(audio, 587, t, 0.07, 0.05);
      blip(audio, 784, t + 0.08, 0.1, 0.05);
      break;
    case "win":
      blip(audio, 523, t, 0.1, 0.07);
      blip(audio, 659, t + 0.1, 0.1, 0.07);
      blip(audio, 784, t + 0.2, 0.18, 0.08);
      break;
    default:
      break;
  }
}

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

function blip(
  audio: AudioContext,
  freq: number,
  when: number,
  dur: number,
  peak: number,
  type: OscillatorType = "square",
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

function noise(audio: AudioContext, when: number, dur: number, peak: number): void {
  const length = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 800;
  gain.gain.setValueAtTime(peak, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  src.start(when);
  src.stop(when + dur);
}
