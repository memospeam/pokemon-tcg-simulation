import { useEffect, useId, useState } from "react";
import type { HandDragKind } from "./useHandDragDrop";

export interface ReplayLink {
  handId: string;
  targetId: string;
  kind: HandDragKind;
}

interface ReplayLinkOverlayProps {
  link: ReplayLink | null;
}

export function ReplayLinkOverlay({ link }: ReplayLinkOverlayProps) {
  const markerId = useId().replace(/:/g, "");
  const [coords, setCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );

  useEffect(() => {
    if (!link) {
      setCoords(null);
      return;
    }
    const { handId, targetId } = link;

    function measure() {
      const root = document.querySelector(".match-table--replay-hints");
      if (!root) {
        setCoords(null);
        return;
      }
      const handEl = root.querySelector(`[data-hand-card-id="${handId}"]`);
      const targetEl = root.querySelector(`[data-hand-drop-target="${targetId}"]`);
      if (!handEl || !targetEl) {
        setCoords(null);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const handRect = handEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      setCoords({
        x1: handRect.left + handRect.width / 2 - rootRect.left,
        y1: handRect.top + handRect.height / 2 - rootRect.top,
        x2: targetRect.left + targetRect.width / 2 - rootRect.left,
        y2: targetRect.top + targetRect.height / 2 - rootRect.top,
      });
    }

    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [link?.handId, link?.targetId, link?.kind]);

  if (!link || !coords) return null;

  return (
    <svg className="replay-link-overlay" aria-hidden="true">
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" className={`replay-link__arrow replay-link__arrow--${link.kind}`} />
        </marker>
      </defs>
      <line
        className={`replay-link replay-link--${link.kind}`}
        x1={coords.x1}
        y1={coords.y1}
        x2={coords.x2}
        y2={coords.y2}
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  );
}
