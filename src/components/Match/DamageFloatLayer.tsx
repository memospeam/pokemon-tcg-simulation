import type { DamageFloat } from "./useBoardSlotVfx";

interface DamageFloatLayerProps {
  floats: DamageFloat[];
  mat: "self" | "opponent";
  slot: "active" | "bench";
  benchIndex?: number;
}

export function DamageFloatLayer({ floats, mat, slot, benchIndex }: DamageFloatLayerProps) {
  const visible = floats.filter(
    (item) =>
      item.mat === mat &&
      item.slot === slot &&
      (slot !== "bench" || item.benchIndex === benchIndex),
  );
  if (visible.length === 0) return null;

  return (
    <div className="damage-float-layer" aria-hidden>
      {visible.map((item) => (
        <span key={item.id} className="damage-float">
          −{item.amount}
        </span>
      ))}
    </div>
  );
}
