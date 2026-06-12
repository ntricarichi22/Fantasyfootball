// POST /api/pro-personnel/door-beat
//
// The click-time CONTINUATION beat for the Build-a-Trade door: the GM just
// picked a storyline in the director's chat, and the director responds — as a
// continuation of that conversation, not a replay of the card text. He's
// pitching his boss: acknowledge the call, sell the direction, and set up the
// plays (referencing them by their exact labels), naming the one he'd start
// with and why.
//
// All context comes from the client (the storylines + live deal counts it
// already holds), so this route is fast — no league pipeline. Deterministic
// fallback when no API key / timeout.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const LLM_TIMEOUT_MS = 6_000;

type BeatGoal = { label: string; evidence: string; count: number };
type Body = {
  team_id?: string;
  headline?: string;
  source?: "intent" | "engine";
  opening?: string;     // what he said when the room opened
  prior_arg?: string;   // his one-line argument on the storyline card
  goals?: BeatGoal[];   // the plays, with live deal counts
};

const SYSTEM = `You are the Pro Personnel Director of a 12-team Superflex dynasty fantasy football franchise, mid-conversation with your GM in your office. You already opened the meeting and pitched the storylines; the GM just picked one. You are PITCHING your boss — you believe in this board and you want him to act. Persuade with conviction, don't recite, don't grovel, don't overdo it.

Hard rules:
1. This is a CONTINUATION. Do NOT greet him again and do NOT repeat your earlier argument verbatim — build on it.
2. Acknowledge his call in a few words, then sell the direction fresh and set up the plays.
3. Reference plays by their EXACT labels (they render as buttons right under your message). Name the ONE you'd start with and the reason — that's your recommendation, own it.
4. NEVER mention point values, ratios, or percentages. Deal counts are fine ("four live deals").
5. "We" and "us". 2-4 sentences total. Output ONLY the prose — no JSON, no markdown.`;

function fallback(goals: BeatGoal[], source?: string): string {
  const live = goals.filter(g => g.count > 0);
  if (live.length === 0) {
    return "That's the direction I'd go too — but I'll be straight with you, nothing clean came back on the phones today. Give me a day or get me a line out and we'll make our own.";
  }
  const top = [...live].sort((a, b) => b.count - a.count)[0];
  const total = live.reduce((s, g) => s + g.count, 0);
  const open = source === "intent"
    ? "Good — it's your plan, and I've already done the legwork on it."
    : "Good call — the roster's been screaming this for weeks.";
  const evid = top.evidence.replace(/\.$/, "");
  const evidLc = evid.charAt(0).toLowerCase() + evid.slice(1);
  return `${open} I've got ${total} live ${total === 1 ? "deal" : "deals"} across ${live.length} ${live.length === 1 ? "play" : "plays"}, and if it were me I'd start with "${top.label}" — ${evidLc}. The board's below; tap a play and I'll deal the cards.`;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const goals = (body.goals ?? []).slice(0, 8);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && goals.length > 0) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 300,
          system: SYSTEM,
          messages: [{
            role: "user",
            content:
              `YOUR OPENING (already said): ${body.opening ?? ""}\n` +
              `THE STORYLINE THE GM JUST PICKED: ${body.headline ?? ""} (${body.source === "intent" ? "his own stated plan" : "the roster's case"})\n` +
              `YOUR EARLIER ONE-LINER ON IT: ${body.prior_arg ?? ""}\n` +
              `THE PLAYS (these exact labels render as buttons under your message):\n` +
              goals.map(g => `- "${g.label}" — ${g.evidence} [${g.count} live ${g.count === 1 ? "deal" : "deals"}]`).join("\n") +
              `\n\nWrite your continuation.`,
          }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.content ?? [])
          .filter((b: { type: string }) => b.type === "text")
          .map((b: { text: string }) => b.text)
          .join("")
          .trim();
        if (text) return NextResponse.json({ prose: text });
      }
    } catch { /* fall through */ }
  }

  return NextResponse.json({ prose: fallback(goals, body.source) });
}
