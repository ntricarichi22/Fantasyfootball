// POST /api/pro-personnel/office/respond
//
// Free-text lane of the Personnel director's chat. v1 understands ONE deal-
// shaped ask end to end: "what would it take to get <player>?" — the targeted
// acquire. The director answers with a cost-shape summary in his voice and the
// REAL packages ride along in the response; the client opens the offer drawer
// the moment his message lands (director_office.md: he frames the deal, the
// engine builds the offers — he never invents trade content).
//
// Pipeline: resolve the player name against league rosters (normalizeName;
// full-name first, then unique last-name) → run the unified deal engine with
// the target locked as a receive anchor (builderRequestForTarget — the same
// constructor every door uses) → map to the frozen DoorOffer wire shape → LLM
// summarizes the SHAPES THAT ACTUALLY SURVIVED (never independent speculation,
// so prose and cards can't disagree) and explicitly hands the GM the edit
// affordance. Deterministic fallback when no API key / timeout.
//
// Realism note: a targeted run bypasses the matcher's partner-fence pairing
// (anchors are user-chosen), so the route reads the target's fence status from
// the partner's narrative bundle and feeds it to the prose — "surface, don't
// kill": a sacred/untouchable target gets built AND flagged as a blow-away ask.

import { NextResponse } from "next/server";
import { getLeagueData, getPlayoffHistory } from "@/shared/league-data";
import { buildTeamProfiles, computeNeeds } from "@/shared/team-profiles";
import { buildTeamDossiers } from "@/shared/team-dossier";
import { buildTeamNarratives } from "@/shared/team-narratives";
import { buildValuationContext } from "@/shared/asset-values";
import { normalizeName } from "@/infrastructure/strings/normalize";
import { ttlMemo } from "@/infrastructure/ttlCache";
import { construct, builderRequestForTarget, type EngineContext, type EngineOffer } from "@/pro-personnel/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const LLM_TIMEOUT_MS = 6_000;

type FenceStatus = "spendable" | "sacred" | "unknown";

type RosteredName = { playerId: string; name: string; position: string; teamId: string; teamName: string };

// ─── Name resolution ─────────────────────────────────────────────────────────

function rosteredPlayers(data: Awaited<ReturnType<typeof getLeagueData>>): RosteredName[] {
  if ("error" in data) return [];
  const out: RosteredName[] = [];
  for (const t of data.teams) {
    for (const p of t.players) {
      out.push({ playerId: p.id, name: p.name, position: p.position, teamId: t.rosterId, teamName: t.teamName });
    }
  }
  return out;
}

// Full-name first (substring on the stripped message — "tuckerkraft" inside
// "whatwouldittaketogettuckerkraft"), then unique last-name as a whole word.
// Ambiguous last name → return the candidates so the director can ask which.
function resolveTarget(message: string, players: RosteredName[]): { match?: RosteredName; ambiguous?: RosteredName[] } {
  const normMsg = normalizeName(message);
  const tokens = message
    .split(/[^A-Za-z0-9'.-]+/)
    .map((w) => normalizeName(w))
    .filter(Boolean);
  const tokenSet = new Set(tokens);

  const full = players.filter((p) => {
    const n = normalizeName(p.name);
    return n.length >= 5 && normMsg.includes(n);
  });
  if (full.length > 0) return { match: full[0] };

  const byLast = players.filter((p) => {
    const parts = p.name.trim().split(/\s+/);
    const last = normalizeName(parts[parts.length - 1]);
    return last.length >= 4 && tokenSet.has(last);
  });
  if (byLast.length === 1) return { match: byLast[0] };
  if (byLast.length > 1) return { ambiguous: byLast.slice(0, 4) };
  return {};
}

// ─── Targeted slate (the engine half, memoized like the door slate) ─────────

type TargetPayload = {
  offers: Array<Record<string, unknown>>;
  fence: FenceStatus;
  untouchable: boolean;
  partnerName: string;
};

async function buildTargetPayload(teamId: string, target: RosteredName): Promise<TargetPayload | { error: string }> {
  const data = await getLeagueData();
  if ("error" in data) return { error: data.error };

  const profiles = buildTeamProfiles(data);
  const needs = computeNeeds(data);
  const dossiers = buildTeamDossiers(profiles, data);
  const playoffHistory = await getPlayoffHistory();
  const bundles = buildTeamNarratives(data, profiles, dossiers, needs, playoffHistory);
  const ctx = await buildValuationContext();
  const ec: EngineContext = { data, profiles, dossiers, needs, ctx, bundles };

  // The constructor builds ONE best package per partner-target pair, but the
  // cost question deserves alternatives ("our 1st — or keep it and send a 2nd
  // plus a young back"). So: base run, then re-runs with the send pool fenced —
  // (a) without our round-1 picks, (b) without anything the base package used —
  // deduped by offer id. Each run is partner-locked, so the variants are cheap.
  const baseReq = () => builderRequestForTarget(teamId, target.playerId, { counterpartyTeamIds: [target.teamId] });
  const engineOffers: EngineOffer[] = [...construct(baseReq(), ec).offers];

  const ourTeam = data.teams.find((t) => t.rosterId === teamId);
  const ourPicks = data.pickOwnership.get(teamId) ?? [];
  const allOurKeys = [...(ourTeam?.playerIds ?? []), ...ourPicks.map((p) => p.key)];

  const fences: Set<string>[] = [];
  const noFirsts = new Set(allOurKeys);
  for (const p of ourPicks) if (p.round === 1) noFirsts.delete(p.key);
  fences.push(noFirsts);
  const baseSend = engineOffers[0]?.assets.filter((a) => a.side === "send").map((a) => a.key) ?? [];
  if (baseSend.length > 0) {
    const withoutBase = new Set(allOurKeys);
    for (const k of baseSend) withoutBase.delete(k);
    fences.push(withoutBase);
  }
  for (const fenceSet of fences) {
    const s = construct({ ...baseReq(), spendable: fenceSet }, ec);
    for (const o of s.offers) {
      if (!engineOffers.some((x) => x.id === o.id)) engineOffers.push(o);
    }
  }
  const slate = { offers: engineOffers.slice(0, 4) };

  // Fence status: is the target something the partner's own storylines would
  // move? (Same read the matcher uses; here it's narration, not suppression.)
  const partnerBundle = bundles.get(target.teamId);
  let fence: FenceStatus = "unknown";
  if (partnerBundle) {
    const spend = new Set<string>();
    for (const th of partnerBundle.theses) for (const k of th.spendable) spend.add(k);
    fence = spend.has(target.playerId) ? "spendable" : "sacred";
  }
  const partnerAttachment = data.attachments.get(target.teamId) as Map<string, string> | undefined;
  const untouchable = partnerAttachment?.get(target.playerId) === "untouchable";

  const mapOffer = (o: EngineOffer) => ({
    id: o.id,
    partnerTeam: { id: o.partnerTeamId, name: o.partnerTeamName, persona: o.partnerPersona },
    sendAssets: o.assets.filter((a) => a.side === "send").map((a) => ({ key: a.key, name: a.name, type: a.type })),
    receiveAssets: o.assets.filter((a) => a.side === "receive").map((a) => ({ key: a.key, name: a.name, type: a.type })),
    gap: {
      sendValue: o.ourScoreboard.sendValue,
      receiveValue: o.ourScoreboard.receiveValue,
      ratio: o.ourScoreboard.ratio,
      verdict: o.ourScoreboard.verdict,
    },
    grade: { label: o.grade.label, color: o.grade.color },
    verdict: o.ourScoreboard.verdict,
    prose: "",
    narrative: "target_acquire",
    partnerRead: o.partnerRead,
    partnerAngle: { storylineHeadline: null, goalKind: null, goalEvidence: null },
  });

  return {
    offers: slate.offers.map(mapOffer),
    fence,
    untouchable,
    partnerName: target.teamName,
  };
}

// ─── Director prose (LLM with deterministic fallback) ───────────────────────

const SYSTEM = `You are the Pro Personnel Director of a 12-team Superflex dynasty fantasy football franchise, talking with your GM in your office. He asked what it would take to acquire a specific player from another team. You made the calls and built real trade packages — they render as offer cards in a drawer beside the chat THE MOMENT your message lands.

Hard rules:
1. 2-4 sentences, spoken like a person. "We" and "us" — you work for this franchise.
2. Answer the cost question first, in natural language, from the ACTUAL package shapes you're given (name the lead assets — e.g. "our 1st gets it done, or keep it and send a 2nd with one of the young backs"). Never invent a package you weren't given.
3. Explicitly say you put together packages for him to react to, and that if he wants to tweak one he should hit EDIT on the card.
4. If fence status says the player is sacred or untouchable to them, be straight: they don't want to move him, so these are blow-away asks.
5. NEVER mention point values, ratios, or percentages. Package counts are fine ("three packages").
6. Output ONLY the prose — no JSON, no markdown.`;

const SYSTEM_NO_OFFERS = `You are the Pro Personnel Director of a 12-team Superflex dynasty fantasy football franchise, talking with your GM in your office. He asked what it would take to acquire a specific player from another team. You made the calls and NOTHING workable came back — no package cleared our own floor and their realistic asking range at the same time.

Hard rules:
1. 2-3 sentences, spoken like a person. "We" and "us".
2. Be straight that you couldn't line up a deal worth doing, and give the honest reason from the context you're given (they're not moving him / it would gut our lineup / the price is past what he's worth to us).
3. NEVER mention point values, ratios, or percentages.
4. Output ONLY the prose — no JSON, no markdown.`;

type OfferShape = { send: string[]; read: string };

async function llmProse(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system,
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

function fenceLine(fence: FenceStatus, untouchable: boolean): string {
  if (untouchable) return "They have him flagged untouchable — prying him loose takes a blow-away offer.";
  if (fence === "sacred") return "He's a core piece of their plan — they are not shopping him, so this is a pay-up situation.";
  if (fence === "spendable") return "Their own storyline would move him for the right return — this is a real conversation.";
  return "No strong read on how attached they are.";
}

function offersFallback(targetName: string, partnerName: string, shapes: OfferShape[], fence: FenceStatus, untouchable: boolean): string {
  const n = shapes.length;
  const lead = shapes[0]?.send.join(" + ") ?? "";
  const alt = shapes[1]?.send.join(" + ");
  const attach =
    untouchable || fence === "sacred"
      ? ` Fair warning — they don't want to move him, so every one of these is a pay-up.`
      : "";
  const shapeLine = alt
    ? `the cleanest is ${lead}, and if you'd rather hold that, there's a version built on ${alt}`
    : `it's built around ${lead}`;
  return (
    `I called ${partnerName} about ${targetName}.${attach} ` +
    `I put together ${n === 1 ? "a package" : `${n} packages`} for you to react to — ${shapeLine}. ` +
    `They're on the board now; if you want to tweak one, hit EDIT on the card and we'll work it from there.`
  );
}

function noOffersFallback(targetName: string, partnerName: string, fence: FenceStatus, untouchable: boolean): string {
  if (untouchable || fence === "sacred") {
    return `I called ${partnerName} about ${targetName}, and I'll be straight with you — he's a piece they're building around, and getting him means an offer that hurts us more than he helps. I'd let that one sit.`;
  }
  return `I worked the phones on ${targetName} and couldn't line up a package worth sending — everything that gets ${partnerName} to the table costs us more than he's worth to our room. If you disagree, get me on the phones and we'll build it by hand.`;
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { roster_id?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const teamId = String(body.roster_id ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!teamId || !message) {
    return NextResponse.json({ error: "roster_id and message required" }, { status: 400 });
  }

  try {
    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

    const { match, ambiguous } = resolveTarget(message, rosteredPlayers(data));

    if (ambiguous) {
      const names = ambiguous.map((p) => `${p.name} (${p.teamName})`).join(", or ");
      return NextResponse.json({
        prose: [`Which one are we talking about — ${names}? Give me the full name and I'll get on the phones.`],
      });
    }

    if (!match) {
      return NextResponse.json({
        prose: [
          "If you want me to work the market, name a player on another roster — \"what would it take to get Tucker Kraft\" style — and I'll make the calls and put real packages in front of you. The rest of the league chatter comes online soon.",
        ],
      });
    }

    // Their player → the targeted acquire. Our own player → point at the shop door.
    if (match.teamId === teamId) {
      return NextResponse.json({
        prose: [
          `${match.name} is already ours, boss. If you're thinking about moving him, that's a shop-him conversation — let's do it where I can spread the offers out.`,
        ],
        action: {
          items: [
            { id: "__shop_studio__", label: "Shop my guys", kind: "navigate", href: "/pro-personnel/trade-studio" },
          ],
        },
      });
    }

    const payload = await ttlMemo(`office-target:v2:${teamId}:${match.playerId}`, 60_000, () =>
      buildTargetPayload(teamId, match),
    );
    if ("error" in payload) return NextResponse.json({ error: payload.error }, { status: 500 });

    const shapes: OfferShape[] = payload.offers.map((o) => ({
      send: (o.sendAssets as Array<{ name: string }>).map((a) => a.name),
      read: String(o.partnerRead ?? "likely"),
    }));

    if (shapes.length === 0) {
      const user =
        `TARGET: ${match.name} (${match.position}), rostered by ${match.teamName}.\n` +
        `FENCE STATUS: ${fenceLine(payload.fence, payload.untouchable)}\n` +
        `RESULT: no package survived (our floor + their realistic range never overlapped).\n\nWrite your reply.`;
      const prose =
        (await llmProse(SYSTEM_NO_OFFERS, user)) ??
        noOffersFallback(match.name, match.teamName, payload.fence, payload.untouchable);
      return NextResponse.json({ prose: [prose] });
    }

    const user =
      `TARGET: ${match.name} (${match.position}), rostered by ${match.teamName}.\n` +
      `FENCE STATUS: ${fenceLine(payload.fence, payload.untouchable)}\n` +
      `THE PACKAGES YOU BUILT (these render as cards in the drawer; "needs selling" = they'll want convincing):\n` +
      shapes
        .map((s, i) => `${i + 1}. We send: ${s.send.join(" + ")} [${s.read === "likely" ? "they'd take it" : "needs selling"}]`)
        .join("\n") +
      `\n\nWrite your reply.`;
    const prose =
      (await llmProse(SYSTEM, user)) ??
      offersFallback(match.name, match.teamName, shapes, payload.fence, payload.untouchable);

    return NextResponse.json({
      prose: [prose],
      offers: payload.offers,
      drawer_label: `Getting ${match.name}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
