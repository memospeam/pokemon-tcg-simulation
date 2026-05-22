import { useMemo, useState } from "react";
import { openSamplePack } from "@/lib/simulation";
import { CardTile } from "./CardTile";

export function PackOpener() {
  const [seed, setSeed] = useState("");
  const [resultKey, setResultKey] = useState(0);
  const result = useMemo(() => {
    void resultKey;
    const parsedSeed = seed.trim() === "" ? undefined : Number(seed);
    return openSamplePack(Number.isFinite(parsedSeed) ? parsedSeed : undefined);
  }, [seed, resultKey]);

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2>Open Booster Pack</h2>
          <p>Simulate opening a 10-card booster from the sample pool.</p>
        </div>
        <div className="panel__actions">
          <label className="field">
            <span>Seed (optional)</span>
            <input
              type="number"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              placeholder="Random"
            />
          </label>
          <button type="button" onClick={() => setResultKey((value) => value + 1)}>
            Open Pack
          </button>
        </div>
      </header>

      <p className="panel__meta">
        Opened: <strong>{result.packName}</strong> · {result.cards.length} cards
      </p>

      <div className="card-grid">
        {result.cards.map((card) => (
          <CardTile key={`${resultKey}-${card.id}`} card={card} />
        ))}
      </div>
    </section>
  );
}
