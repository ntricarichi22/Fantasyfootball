import { NextRequest, NextResponse } from "next/server";
import { counterProse, type CounterPartner } from "@/inbox/thread/counterMath";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The counter drawer's director read. Thin Anthropic wrapper: the client hands
// us the partner's already-loaded situation (from the ai-counter feed) plus the
// exact deal on the slider, so we do NO database work per settle — we just frame
// it and ask the director for a grounded read. Falls back to the deterministic
// counterProse when there's no API key or the call fails, so the drawer always
// gets a usable line.

const ANTHROPIC_MODEL = "claude-opus-4-8";

type AssetLite = { name?: string };
type PartnerLite = {
  name?: string;
  persona?: string;
  window?: string;
  verdict?: string;
  wants?: string;
  sells?: string;
  tradeStance?: string;
  coreLabel?: string;
  topNeed?: string | null;
};
type Body = {
  partner?: PartnerLite;
  offer?: { send?: AssetLite[]; receive?: AssetLite[] };
  counter?: { send?: AssetLite[]; receive?: AssetLite[] };
  ratio?: number;
  offer_ratio?: number;
  our_floor?: number;
  their_floor?: number;
};

const PERSONA_LABEL: Record<string, string> = {
  hustler: "Hustler",
  closer: "Closer",
  straight_shooter: "Straight Shooter",
  architect: "Architect",
};

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : d);

function names(assets: AssetLite[] | undefined): string {
  if (!assets || assets.length === 0) return "nothing";
  return assets.map((a) => a.name).filter(Boolean).join(", ") || "nothing";
}

function lastWord(name: string | undefined): string {
  const parts = (name || "").trim().split(" ");
  return parts.length > 1 ? parts[parts.length - 1] : name || "they";
}

function toneOf(offerRatio: number, ourFloor: number): string {
  if (offerRatio < ourFloor) return "a lowball — below our floor";
  if (offerRatio > 1.05) return "generous — better than even for us";
  return "a fair opening";
}

function postureOf(ratio: number, ourFloor: number, theirFloor: number): string {
  const acceptLine = 1 / Math.max(0.1, theirFloor);
  if (ratio < ourFloor) return "still below our own floor — we'd be giving up value";
  if (ratio > acceptLine + 0.05) return "past their realistic-accept line — aggressive";
  if (ratio >= acceptLine - 0.05) return "right at their realistic-accept line — the sweet spot";
  return "fair for us and still inside what they'd take";
}

const SYSTEM =
  "You are the user's Pro Personnel director — a sharp, plain-spoken dynasty fantasy football front-office advisor, " +
  "speaking privately to your boss (the user) about a trade COUNTER they're shaping with a slider. Give one tight, " +
  "grounded read: weigh the partner's real situation — their build direction, what they're collecting versus shedding, " +
  "their biggest hole, and how their GM persona negotiates — against where this counter sits, and advise how to play it. " +
  "Say why they'll react the way they will; if it's aggressive, name what they'd likely want back to say yes; flag a " +
  "relationship risk only if there genuinely is one. Talk like a trusted advisor to one person — \"I'd…\", \"they'll…\", " +
  "\"you're…\". 2 to 4 sentences, plain prose. Output ONLY the read: no preamble, no reasoning, no headers, no bullet points.";

async function callAnthropic(user: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 320,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const partner = body.partner ?? {};
  const ourFloor = num(body.our_floor, 0.9);
  const theirFloor = num(body.their_floor, 0.9);
  const ratio = num(body.ratio, 1);
  const offerRatio = num(body.offer_ratio, 1);
  const personaLabel = PERSONA_LABEL[partner.persona ?? ""] ?? "GM";
  const tone = toneOf(offerRatio, ourFloor);
  const posture = postureOf(ratio, ourFloor, theirFloor);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const user = [
      `PARTNER: ${partner.name ?? "the other team"} — GM persona: ${personaLabel}.`,
      `Their read: ${partner.verdict ?? ""} Window: ${partner.window ?? "unknown"}. Chasing: ${partner.wants ?? "unknown"}. Shedding: ${partner.sells ?? "unknown"}. Stance: ${partner.tradeStance ?? "unknown"}.${partner.topNeed ? ` Biggest hole: ${partner.topNeed}.` : ""}${partner.coreLabel ? ` ${partner.coreLabel}.` : ""}`,
      `How they opened: they offered us ${names(body.offer?.receive)} for our ${names(body.offer?.send)} — ${tone}.`,
      `The counter I'm shaping now: we send ${names(body.counter?.send)}; we receive ${names(body.counter?.receive)}. Against their persona this sits ${posture}.`,
      `Give me your read on this counter.`,
    ].join("\n");
    const read = await callAnthropic(user, apiKey);
    if (read) return NextResponse.json({ read, source: "llm" });
  }

  // Fallback — the deterministic director read, so the drawer never goes blank.
  const p: CounterPartner = {
    nick: lastWord(partner.name),
    personaLabel,
    persona: partner.persona ?? "",
    window: partner.window ?? "",
    verdict: partner.verdict ?? "",
    wants: partner.wants ?? "",
    sells: partner.sells ?? "",
    topNeed: partner.topNeed ?? null,
  };
  const read = counterProse(ratio, ourFloor, theirFloor, offerRatio, false, p);
  return NextResponse.json({ read, source: "fallback" });
}
