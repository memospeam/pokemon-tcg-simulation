import { getDefinition, getOpponentId, getPlayer, remainingHp } from "@/lib/engine";
import type { EngineState } from "@/lib/engine";
import type { ActionCategory } from "@/lib/deck/simulationCapture";

/**
 * A human-readable "what the AI was thinking" for one playback frame, derived
 * purely by diffing the before/after engine state — no changes to the decision
 * engine. `reasoning` is the intent of the move; `badges` are its concrete
 * outcomes (KOs, prizes taken, cards drawn, energy attached, damage).
 */
export interface PlayInsight {
  reasoning: string;
  badges: { icon: string; text: string; tone: "good" | "bad" | "info" }[];
}

function inPlayIds(state: EngineState, playerId: ReturnType<typeof getOpponentId>): string[] {
  const p = getPlayer(state, playerId);
  return [...(p.active ? [p.active] : []), ...p.bench].map((m) => m.instanceId);
}

/** Names the actor knocked out: a Pokémon that left the opponent's board and
 *  is now in their discard pile. */
function knockedOutNames(prev: EngineState, cur: EngineState, actor: ReturnType<typeof getOpponentId>): string[] {
  const oppId = getOpponentId(actor);
  const before = new Set(inPlayIds(prev, oppId));
  const afterIds = new Set(inPlayIds(cur, oppId));
  const discard = getPlayer(cur, oppId).discard;
  const names: string[] = [];
  for (const id of before) {
    if (afterIds.has(id)) continue;
    const card = discard.find((c) => c.instanceId === id);
    if (card) {
      const def = getDefinition(cur, card.definitionId);
      if (def && def.supertype === "Pokémon") names.push(def.name);
    }
  }
  return names;
}

const FROM_LABEL = /(?:attached|played|evolved|retreated|used|drew)/i;

/** Extract a card / attack / Pokémon name from a log line like
 *  "Alice attached Darkness Energy to N's Zoroark ex." */
function tailName(label: string, after: RegExp): string | null {
  const m = label.match(after);
  return m?.[1]?.replace(/\.$/, "").trim() ?? null;
}

function describeTrainer(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("boss's orders") || l.includes("boss ")) return "ลากโปเกมอนเป้าหมายของคู่ต่อสู้ขึ้นมา Active เพื่อเปิดทาง KO";
  if (l.includes("crushing hammer")) return "ทำลายพลังงานคู่ต่อสู้ — ดีเลย์การโจมตีของอีกฝั่ง";
  if (l.includes("rare candy")) return "วิวัฒน์ข้ามขั้นเป็น Stage 2 ทันที เร่งตัวรุกหลัก";
  if (l.includes("ultra ball") || l.includes("nest ball")) return "ค้นโปเกมอนชิ้นส่วนที่ขาดจากเด็ค";
  if (l.includes("poffin") || l.includes("poké pad") || l.includes("poke pad")) return "เติมโปเกมอนลง Bench สร้างฐานบอร์ด";
  if (l.includes("iono") || l.includes("judge")) return "กวนมือคู่ต่อสู้ + รีเฟรชมือตัวเอง";
  if (l.includes("lillie") || l.includes("research") || l.includes("hilda") || l.includes("ariana")) return "จั่วการ์ดหาชิ้นส่วน setup";
  if (l.includes("crispin") || l.includes("dawn") || l.includes("gong")) return "เร่งพลังงานเข้าตัวรุก";
  if (l.includes("night stretcher") || l.includes("stretcher")) return "กู้โปเกมอน/พลังงานจากกองทิ้ง";
  if (l.includes("switch")) return "สลับตัว Active แบบไม่เสียค่าถอย";
  const name = tailName(label, /played (.+?)\.?$/i);
  return name ? `เล่นเทรนเนอร์ ${name}` : "เล่นการ์ดเทรนเนอร์";
}

function describeAbility(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("trade")) return "Trade: ทิ้ง 1 จั่ว 2 — หมุนการ์ดหาคำตอบ";
  if (l.includes("run away draw")) return "Run Away Draw: จั่ว 3 แล้วสับตัวเองกลับเด็ค (pivot ฟรี)";
  if (l.includes("champion's call")) return "Champion's Call: ค้นโปเกมอน Cynthia's ขึ้นมือ";
  if (l.includes("cursed blast")) return "Cursed Blast: วาง damage counter ใส่ bench แล้วสละตัวเอง";
  if (l.includes("subjugating chains")) return "Subjugating Chains: สลับตัว Darkness สด + ทำให้ติดพิษ (เปิด Binding Mochi)";
  if (l.includes("adrena-brain")) return "Adrena-Brain: ย้าย damage counter ไปปิด KO + ฮีลตัวเอง";
  if (l.includes("fan call")) return "Fan Call: ค้นโปเกมอน Colorless 3 ตัวเติม Bench (setup เทิร์นแรก)";
  if (l.includes("recon directive")) return "Recon Directive: เปิดไพ่บนสุด คัดคุณภาพการจั่ว";
  const name = tailName(label, /used (.+?)\.?$/i);
  return name ? `ใช้ความสามารถ ${name}` : "ใช้ความสามารถ";
}

export function deriveInsight(
  prev: EngineState | undefined,
  cur: EngineState,
  category: ActionCategory,
  label: string,
  logDelta: string[] = [],
): PlayInsight {
  const badges: PlayInsight["badges"] = [];
  const logText = logDelta.join("\n");

  // KO / prize outcomes read from this frame's log lines (robust even when the
  // frame's headline label is a follow-up prompt like "must promote…").
  const koNames = [...logText.matchAll(/(.+?) was Knocked Out/g)].map((m) => m[1]!.trim());
  if (koNames.length) badges.push({ icon: "💥", text: `KO ${koNames.join(", ")}`, tone: "good" });
  const prizeMatch = logText.match(/took (\d+) prize/i);
  if (prizeMatch) badges.push({ icon: "🏆", text: `เก็บ ${prizeMatch[1]} ไพรซ์`, tone: "good" });

  if (prev) {
    const actor = prev.currentPlayerId;
    // Fallback KO detection from state diff when the log phrasing differs.
    if (!koNames.length) {
      const kos = knockedOutNames(prev, cur, actor);
      if (kos.length) badges.push({ icon: "💥", text: `KO ${kos.join(", ")}`, tone: "good" });
    }

    const prevOppActive = getPlayer(prev, getOpponentId(actor)).active;
    const curOppActive = getPlayer(cur, getOpponentId(actor)).active;
    if (
      category === "attack" &&
      prevOppActive && curOppActive && prevOppActive.instanceId === curOppActive.instanceId
    ) {
      const dmg = remainingHp(prev, prevOppActive) - remainingHp(cur, curOppActive);
      if (dmg > 0) badges.push({ icon: "💢", text: `${dmg} ดาเมจ`, tone: "good" });
    }

    const drew = getPlayer(cur, actor).hand.length - getPlayer(prev, actor).hand.length;
    if (drew > 0 && (category === "trainer" || category === "ability" || category === "resolve")) {
      badges.push({ icon: "🃏", text: `จั่ว ${drew}`, tone: "info" });
    }

    const energyDelta =
      [...(getPlayer(cur, actor).active ? [getPlayer(cur, actor).active!] : []), ...getPlayer(cur, actor).bench]
        .reduce((s, m) => s + m.attachedEnergy.length, 0) -
      [...(getPlayer(prev, actor).active ? [getPlayer(prev, actor).active!] : []), ...getPlayer(prev, actor).bench]
        .reduce((s, m) => s + m.attachedEnergy.length, 0);
    if (energyDelta > 0 && category !== "energy") {
      badges.push({ icon: "⚡", text: `+${energyDelta} พลังงาน`, tone: "info" });
    }
  }

  // Prefer the most informative log line for name extraction (the action's
  // own line), not just the frame's final label.
  const energyLine = logDelta.find((l) => /attached .* to /i.test(l)) ?? label;
  const attackLine = logDelta.find((l) => /\bused\b/i.test(l)) ?? label;
  const evolveLine = logDelta.find((l) => /evolved .* into |into /i.test(l)) ?? label;
  const benchLine = logDelta.find((l) => /(?:played|benched) /i.test(l)) ?? label;

  let reasoning: string;
  switch (category) {
    case "start":
      reasoning = "ตั้งกระดาน — วางโปเกมอนเริ่มต้นและจั่วมือเปิดเกม";
      break;
    case "energy": {
      const name = tailName(energyLine, /to (.+?)\.?$/i);
      reasoning = name ? `เติมพลังงานให้ ${name} เพื่อสะสมพร้อมโจมตี` : "เติมพลังงานให้ตัวรุก";
      break;
    }
    case "attack": {
      const atk = tailName(attackLine, /used (.+?)(?: for | dealing |\.|!|$)/i);
      reasoning = atk ? `บุกด้วยท่า ${atk}` : "เปิดฉากโจมตี";
      break;
    }
    case "trainer":
      reasoning = describeTrainer(logDelta.find((l) => /played /i.test(l)) ?? label);
      break;
    case "ability":
      reasoning = describeAbility(logDelta.find((l) => /\bused\b|Trade|Draw|Call|Blast|Chains|Directive/i.test(l)) ?? label);
      break;
    case "evolve": {
      const name = tailName(evolveLine, /into (.+?)\.?$/i);
      reasoning = name ? `วิวัฒน์เป็น ${name} — อัปเกรดตัวรุก` : "วิวัฒน์โปเกมอน";
      break;
    }
    case "basic": {
      const name = tailName(benchLine, /(?:played|benched) (.+?)\.?$/i);
      reasoning = name ? `วาง ${name} ลง Bench ขยายฐานบอร์ด` : "วางโปเกมอนลง Bench";
      break;
    }
    case "retreat":
      reasoning = "ถอยตัว Active สลับตัวรุกที่พร้อมกว่า";
      break;
    case "endturn":
      reasoning = "จบเทิร์น — ไม่มีการเล่นที่คุ้มกว่านี้แล้ว ส่งต่อให้คู่ต่อสู้";
      break;
    case "resolve":
      reasoning = "ดำเนินผลที่ค้างจากการเล่นก่อนหน้า";
      break;
    default:
      reasoning = label;
  }

  return { reasoning, badges };
}
