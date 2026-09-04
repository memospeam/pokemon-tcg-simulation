import type { PrizeFly } from "./useBoardSlotVfx";

interface PrizeFlyLayerProps {
  flies: PrizeFly[];
  mat: "self" | "opponent";
}

export function PrizeFlyLayer({ flies, mat }: PrizeFlyLayerProps) {
  const visible = flies.filter((item) => item.mat === mat);
  if (visible.length === 0) return null;

  return (
    <div className={`prize-fly-layer prize-fly-layer--${mat}`} aria-hidden>
      {visible.flatMap((item) =>
        Array.from({ length: item.count }, (_, index) => (
          <span
            key={`${item.id}-${index}`}
            className="prize-fly-layer__card"
            style={{ animationDelay: `${index * 0.08}s` }}
          />
        )),
      )}
    </div>
  );
}
