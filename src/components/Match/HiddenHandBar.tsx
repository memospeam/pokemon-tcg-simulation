interface HiddenHandBarProps {
  playerName: string;
  count: number;
  isOpponent?: boolean;
}

/** Face-down hand row — PTCGL-style hidden information. */
export function HiddenHandBar({ playerName, count, isOpponent = false }: HiddenHandBarProps) {
  const cls = `hidden-hand-bar${isOpponent ? " hidden-hand-bar--opponent" : ""}`;
  if (count === 0) {
    return <div className={`${cls} hidden-hand-bar--empty`}>{playerName} — no cards in hand</div>;
  }

  return (
    <div className={cls}>
      <div className="hidden-hand-bar__label">
        <span className="hidden-hand-bar__name">{playerName}</span>
        Hand · {count} {count === 1 ? "card" : "cards"}
      </div>
      <div className="hidden-hand-bar__backs" aria-hidden>
        {Array.from({ length: Math.min(count, 10) }, (_, i) => (
          <div key={i} className="hidden-hand-bar__back" style={{ zIndex: i }} />
        ))}
        {count > 10 && <span className="hidden-hand-bar__more">+{count - 10}</span>}
      </div>
    </div>
  );
}
