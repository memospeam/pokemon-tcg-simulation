/**
 * Self-play diagnostics report — quantifies AI play quality across archetypes.
 *
 *   npm run report:selfplay
 *
 * Plays a spread of heuristic-vs-heuristic matchups and mines the frames for
 * play-quality symptoms: turns ended while an attack was legal (passive),
 * turns ended while a lethal attack on the opponent's Active was available
 * (missedKO), deck-out losses, and stall draws. Use it to find the next AI
 * improvement before/after heuristic changes. Excluded from the default
 * vitest run (see vitest.config.ts).
 */
import { it } from "vitest";
import { getTournamentDeckById } from "../src/lib/deck/tournamentPresets";
import { capturePresetSimulation } from "../src/lib/deck/simulationCapture";
import { getLegalActions } from "../src/lib/engine/reducer";
import { applyWeaknessAndResistance, parseDamage } from "../src/lib/engine/rules";
import { getDefinition, getOpponentId, getPlayer, remainingHp } from "../src/lib/engine/types";

const IDS: Record<string,string> = {
  Lopunny:"utrecht-1-miloslav-posledni", Dragapult:"utrecht-2-hasan-kunukcu",
  Honchkrow:"utrecht-4-joshua-vanoverschelde", Ogerpon:"utrecht-8-fabio-battistella",
  Greninja:"utrecht-14-niklas-leitz", Hydrapple:"utrecht-16-fabian-kern",
  Garchomp:"utrecht-13-constantin-geisb-sch", Alakazam:"utrecht-12-joris-van-dijk",
  "★Zoroark":"utrecht-masterclass-refined-ns-zoroark",
  "★DragaDusk":"utrecht-masterclass-refined-dragapult-dusknoir",
  "★Garchomp":"utrecht-masterclass-refined-cynthias-garchomp",
};
const MATCHUPS: [string,string][] = [
  ["Lopunny","★Garchomp"],["Dragapult","Greninja"],["Honchkrow","Hydrapple"],
  ["Ogerpon","Alakazam"],["★Zoroark","★DragaDusk"],["Garchomp","Lopunny"],
  ["Greninja","★Zoroark"],["Hydrapple","Dragapult"],["★DragaDusk","Honchkrow"],
  ["Alakazam","★Garchomp"],["Ogerpon","Garchomp"],
];

interface Stat { games:number; wins:number; passiveTurns:number; missedLethals:number;
  deckOutLosses:number; stallDraws:number; turnsTotal:number; attackTurns:number; turnsCounted:number }
const stats: Record<string,Stat> = {};
const stat = (n:string) => (stats[n] ??= {games:0,wins:0,passiveTurns:0,missedLethals:0,deckOutLosses:0,stallDraws:0,turnsTotal:0,attackTurns:0,turnsCounted:0});

it("self-play analysis", () => {
  const missedExamples: string[] = [];
  for (const [an,bn] of MATCHUPS) {
    for (let seed=1; seed<=3; seed++) {
      const A=getTournamentDeckById(IDS[an]!)!; const B=getTournamentDeckById(IDS[bn]!)!;
      const frames = capturePresetSimulation(A,B,{seed});
      const nameOf = (pid:string)=> pid==="p1"?an:bn;
      for (let i=1;i<frames.length;i++){
        const fr=frames[i]!;
        if (fr.category!=="endturn") continue;
        const pre=frames[i-1]!.state;
        const pid=pre.currentPlayerId;
        const s=stat(nameOf(pid));
        s.turnsCounted++;
        if (pre.turnFlags.attacked){ s.attackTurns++; continue; }
        let legalAttacks;
        try { legalAttacks = getLegalActions(pre).filter(a=>a.type==="ATTACK"); } catch { continue; }
        if (legalAttacks.length===0) continue;
        s.passiveTurns++;
        const me=getPlayer(pre,pid); const opp=getPlayer(pre,getOpponentId(pid));
        if (me.active && opp.active){
          const myDef=getDefinition(pre,me.active.definitionId); const oppDef=getDefinition(pre,opp.active.definitionId);
          const oppHp=remainingHp(pre,opp.active);
          const lethal=(myDef?.attacks??[]).some(atk=>{
            const named=legalAttacks.some(a=>(a as {attackName?:string}).attackName===atk.name);
            if(!named) return false;
            const dmg=applyWeaknessAndResistance(parseDamage(atk.damage),myDef?.types,oppDef!);
            return dmg>0 && dmg>=oppHp;
          });
          if (lethal){
            s.missedLethals++;
            if (missedExamples.length<6) missedExamples.push(`${nameOf(pid)} vs ${nameOf(getOpponentId(pid))} seed=${seed} turn=${pre.turnNumber}: ${myDef?.name} could KO ${oppDef?.name} (${oppHp} hp) but ended turn`);
          }
        }
      }
      const last=frames.at(-1)!.state;
      const logTail=last.log.slice(-6).join(" | ");
      for (const n of [an,bn]) stat(n).games++;
      if (last.winnerId) {
        stat(nameOf(last.winnerId)).wins++;
        const loser=nameOf(getOpponentId(last.winnerId));
        if (/deck.*out|no cards left|cannot draw|deck is empty/i.test(logTail)) stat(loser).deckOutLosses++;
      } else { stat(an).stallDraws++; stat(bn).stallDraws++; }
      stat(an).turnsTotal+=last.turnNumber; stat(bn).turnsTotal+=last.turnNumber;
    }
  }
  console.log("\n=== SELF-PLAY DIAGNOSTICS (33 games) ===");
  console.log("deck            | games | winrate | atk-turn% | passive | missedKO | deckout | draws");
  for (const [n,s] of Object.entries(stats).sort((a,b)=>b[1].missedLethals-a[1].missedLethals)) {
    console.log(`${n.padEnd(15)} | ${String(s.games).padStart(5)} | ${String(Math.round(100*s.wins/s.games)).padStart(6)}% | ${String(Math.round(100*s.attackTurns/Math.max(1,s.turnsCounted))).padStart(8)}% | ${String(s.passiveTurns).padStart(7)} | ${String(s.missedLethals).padStart(8)} | ${String(s.deckOutLosses).padStart(7)} | ${s.stallDraws}`);
  }
  console.log("\nMissed-lethal examples:");
  for (const e of missedExamples) console.log("  - "+e);
}, 2400000);
