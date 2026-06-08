import { create } from "zustand";
import type { SimFrame } from "@/lib/deck/simulationCapture";

interface SimStore {
  frames: SimFrame[];
  currentIndex: number;
  isPlaying: boolean;
  speedMs: number;
  /** True while an async (LLM) match is still being captured/streamed. */
  isLive: boolean;
  load: (frames: SimFrame[], startAtEnd?: boolean) => void;
  /** Begin a live streamed match: clear frames, start playing from frame 0. */
  beginLive: () => void;
  /** Append one streamed frame (live mode). */
  pushFrame: (frame: SimFrame) => void;
  /** Mark the streamed capture as finished. */
  endLive: () => void;
  stepTo: (index: number) => void;
  stepDelta: (delta: 1 | -1) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (ms: number) => void;
}

export const useSimStore = create<SimStore>((set, get) => ({
  frames: [],
  currentIndex: 0,
  isPlaying: false,
  speedMs: 500,
  isLive: false,
  load: (frames, startAtEnd = false) =>
    set({ frames, currentIndex: startAtEnd ? Math.max(0, frames.length - 1) : 0, isPlaying: false, isLive: false }),
  beginLive: () => set({ frames: [], currentIndex: 0, isPlaying: true, isLive: true }),
  pushFrame: (frame) => set((s) => ({ frames: [...s.frames, frame] })),
  endLive: () => set({ isLive: false }),
  stepTo: (index) => {
    const { frames } = get();
    set({ currentIndex: Math.max(0, Math.min(index, frames.length - 1)), isPlaying: false });
  },
  stepDelta: (delta) => {
    const { currentIndex, frames } = get();
    set({ currentIndex: Math.max(0, Math.min(currentIndex + delta, frames.length - 1)) });
  },
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setSpeed: (ms) => set({ speedMs: ms }),
}));
