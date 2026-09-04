import type { AttackBeam } from "./parseAttackBeam";

interface AttackBeamOverlayProps {
  beam: AttackBeam | null;
}

export function AttackBeamOverlay({ beam }: AttackBeamOverlayProps) {
  if (!beam) return null;

  return (
    <div
      className={`attack-beam attack-beam--${beam.direction}`}
      key={beam.id}
      aria-hidden
    />
  );
}
