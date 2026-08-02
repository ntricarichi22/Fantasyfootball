// POST /api/inbox/memos/sweep  { team_id }
//
// Idempotent composer for the Personnel director's inbound-offer emails
// (director_office.md: inbound offers are inbox correspondence, not office
// pings). The inbox calls this before listing memos; since the only time the
// GM can see the inbox is when it's loading, compose-on-read is
// indistinguishable from "the email arrived while you were away."
//
// Two generators, deduped via play_payload (kind + offer_id):
//   1. offer_received — a pending inbound offer with no memo yet. Subject +
//      short read in his voice; the offer itself rides as an OfferCard via
//      play_mode "offer_card" (the same global card as everywhere else), with
//      his verdict chip from the canonical engine and LLM-minted prose.
//   2. offer_reminder — the offer is STILL pending after ~36h and exactly one
//      reminder hasn't been sent. Tone is deferential (he's emailing his boss)
//      and modulates on whether the first email was even opened. One reminder,
//      then he goes quiet — this is the sanctioned exception to the "never two
//      emails about the same thing" rule: a follow-up is allowed only when the
//      first asked for a decision and none came, capped at one.
//
// Liveness: both generators only fire for offers that are still pending —
// answered/withdrawn offers never mint mail.

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getLeagueData } from "@/shared/league-data";
import { buildValuationContext } from "@/shared/asset-values";
import { priceDeal } from "@/pro-personnel/engine/pricing";
import { personaAwareGrade } from "@/pro-personnel/engine/core/gap";
import { normalizePersona } from "@/pro-personnel/engine/core/personas";
import type { Gap } from "@/pro-personnel/engine/core/types";
import type { EngineOfferAsset } from "@/pro-personnel/engine/types";
import { generateOfferProse } from "./offerProse";

export const dynamic = "force-dynamic";
// The director's read is now LLM-written at mint time (one call per new email).
export const maxDuration = 30;

const REMINDER_AFTER_MS = 36 * 60 * 60 * 1000;

// Deterministic memo id from (kind, offer, team) — concurrent sweeps (inbox
// auto-refresh racing a fresh page load) both compute the same id, and the
// primary key + ignoreDuplicates turns the race into a no-op. No extra
// dedupe column needed.
function memoIdFor(kind: string, offerId: string, teamId: string): string {
  const h = createHash("sha1").update(`cfc-memo:${kind}:${offerId}:${teamId}`).digest("hex");
  // Format as a v5-style UUID (version + variant bits set) so the uuid column accepts it.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// "Virginia Founders's offer" reads wrong — names ending in s take a bare
// apostrophe.
function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name}'` : `${name}'s`;
}

type OfferAsset = { key: string; type?: string; label?: string; value?: number };
type PendingOffer = {
  id: string;
  thread_id: string | null;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  created_at: string;
};

// trade_offers keys arrive in two formats depending on which surface created
// the offer: prefixed ("player:9484") from the manual builder, raw sleeper ids
// from the engine doors. Normalize both into the engine's key vocabulary
// (raw sleeper ids for players, canonical "pick:" keys for picks).
function toEngineAsset(a: OfferAsset, side: "send" | "receive"): EngineOfferAsset {
  const isPick = a.key.startsWith("pick:") || a.type === "pick";
  const key = a.key.startsWith("player:") ? a.key.slice(7) : a.key;
  return { key, name: a.label || a.key, type: isPick ? "pick" : "player", side };
}

function names(assets: OfferAsset[]): string {
  const ns = assets.map((a) => a.label || a.key).filter(Boolean);
  if (ns.length <= 1) return ns[0] ?? "nothing";
  if (ns.length === 2) return `${ns[0]} and ${ns[1]}`;
  return `${ns.slice(0, -1).join(", ")}, and ${ns[ns.length - 1]}`;
}

function daysAgoLabel(iso: string): string {
  const days = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 1 ? "yesterday" : `${days} days back`;
}

export async function POST(req: Request) {
  let body: { team_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const teamId = String(body.team_id ?? "").trim();
  if (!teamId) return NextResponse.json({ error: "team_id required" }, { status: 400 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

  try {
    // Pending inbound offers + every offer-card memo we've already sent
    // (ALL statuses — an archived email still counts as sent for dedupe).
    const [offersRes, memosRes, personaRes] = await Promise.all([
      client
        .from("trade_offers")
        .select("id, thread_id, from_team_id, to_team_id, assets_from, assets_to, created_at")
        .eq("league_id", LEAGUE_ID)
        .eq("to_team_id", teamId)
        .eq("status", "pending"),
      client
        .from("cfc_director_memos")
        .select("status, created_at, play_payload")
        .eq("team_id", teamId)
        .eq("play_mode", "offer_card"),
      client
        .from("cfc_team_strategy_profiles")
        .select("gm_persona")
        .eq("league_id", LEAGUE_ID)
        .eq("team_id", teamId)
        .maybeSingle(),
    ]);
    if (offersRes.error) return NextResponse.json({ error: offersRes.error.message }, { status: 500 });
    if (memosRes.error) return NextResponse.json({ error: memosRes.error.message }, { status: 500 });

    const offers = (offersRes.data ?? []) as PendingOffer[];
    if (offers.length === 0) return NextResponse.json({ created: 0 });

    // Dedupe index: kind:offer_id → memo status + sent time (status modulates
    // the reminder's tone; sent time is what the reminder clock runs on).
    const sent = new Map<string, { status: string; created_at: string }>();
    for (const m of memosRes.data ?? []) {
      const p = (m.play_payload ?? {}) as { kind?: string; offer_id?: string };
      if (p.kind && p.offer_id) {
        sent.set(`${p.kind}:${p.offer_id}`, {
          status: m.status as string,
          created_at: m.created_at as string,
        });
      }
    }

    const data = await getLeagueData();
    if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });
    const teamName = (id: string) =>
      data.teams.find((t) => t.rosterId === id)?.teamName ?? `Team ${id}`;
    const ctx = await buildValuationContext();
    const ourPersona = normalizePersona(personaRes.data?.gm_persona);

    const rows: Record<string, unknown>[] = [];
    const now = new Date().toISOString();

    for (const offer of offers) {
      const partner = teamName(offer.from_team_id);
      // Recipient perspective: we SEND assets_to, we RECEIVE assets_from.
      const sendAssets = offer.assets_to ?? [];
      const receiveAssets = offer.assets_from ?? [];

      // Verdict chip from the SAME engine as the builder/studio chip:
      // priceDeal's two-scoreboard pricing + personaAwareGrade on OUR seat.
      // An offer now grades identically here and in the trade builder.
      const engineAssets: EngineOfferAsset[] = [
        ...sendAssets.map((a) => toEngineAsset(a, "send")),
        ...receiveAssets.map((a) => toEngineAsset(a, "receive")),
      ];
      const { ours } = priceDeal({
        ourTeamId: teamId,
        partnerTeamId: offer.from_team_id,
        assets: engineAssets,
        ctx,
      });
      const gap: Gap = {
        sendValue: ours.sendValue,
        receiveValue: ours.receiveValue,
        ratio: ours.ratio,
        delta: ours.receiveValue - ours.sendValue,
        verdict: ours.verdict,
        hasSend: sendAssets.length > 0,
        hasReceive: receiveAssets.length > 0,
      };
      const grade = personaAwareGrade(gap, ourPersona);
      const verdict = grade.label;
      const verdictColor = grade.color;

      // Deterministic fallback if the LLM is unavailable/fails.
      const fallbackProse =
        `They're putting up ${names(receiveAssets)} and asking for ${names(sendAssets)}. ` +
        (grade.bucket === "great" || grade.bucket === "ahead" || grade.bucket === "fair"
          ? "The math works for us — I'd move on it before they rethink."
          : grade.bucket === "reaching"
            ? "It's close, but I think there's more in their pocket if we push."
            : "The ask is heavier than the return. I'd pass or make them earn it.");

      // The card minus prose. Prose is LLM-written, generated LAZILY (only inside
      // the mint branches below) so the per-load / 30s-interval sweep never fires
      // an LLM call for an offer whose email already exists.
      const cardBase = {
        offer_id: offer.id,
        thread_id: offer.thread_id,
        partner_team_id: offer.from_team_id,
        partner_name: partner,
        send: sendAssets.map((a) => ({ key: a.key, name: a.label || a.key, type: a.type === "pick" || a.key.startsWith("pick:") ? "pick" : "player" })),
        receive: receiveAssets.map((a) => ({ key: a.key, name: a.label || a.key, type: a.type === "pick" || a.key.startsWith("pick:") ? "pick" : "player" })),
        verdict,
        verdict_color: verdictColor,
      };

      const makeProse = () =>
        generateOfferProse({
          client,
          leagueId: LEAGUE_ID,
          teamId,
          ourName: teamName(teamId),
          partnerName: partner,
          partnerTeamId: offer.from_team_id,
          sendAssets,
          receiveAssets,
          verdict,
          fallback: fallbackProse,
        });

      // ── Email 1: the offer lands ─────────────────────────────────────────
      if (!sent.has(`offer_received:${offer.id}`)) {
        const prose = await makeProse();
        rows.push({
          id: memoIdFor("offer_received", offer.id, teamId),
          director_role: "personnel",
          team_id: teamId,
          subject: `Offer on the table from ${partner}`,
          read_body:
            `${partner} just sent us something, boss: ${names(receiveAssets)} for ${names(sendAssets)}. ` +
            `Here's my read:`,
          play_intro:
            "Answer it right here, or step into the thread if you want to talk it through or work a counter.",
          play_mode: "offer_card",
          play_payload: { kind: "offer_received", ...cardBase, prose },
          status: "unread",
          created_at: now,
          updated_at: now,
        });
        continue; // never mint the reminder in the same sweep as the original
      }

      // ── Email 2: the one polite reminder ─────────────────────────────────
      // The clock runs from when HIS FIRST EMAIL went unanswered, not from the
      // offer itself — a backfilled old offer shouldn't mint both at once.
      const first = sent.get(`offer_received:${offer.id}`);
      const oldEnough =
        !!first && Date.now() - new Date(first.created_at).getTime() > REMINDER_AFTER_MS;
      if (!oldEnough || sent.has(`offer_reminder:${offer.id}`)) continue;

      const firstUnread = first.status === "unread";
      const reminderProse = await makeProse();
      rows.push({
        id: memoIdFor("offer_reminder", offer.id, teamId),
        director_role: "personnel",
        team_id: teamId,
        subject: `No rush — ${possessive(partner)} offer is still open`,
        read_body: firstUnread
          ? `Don't want this one getting buried, boss — ${possessive(partner)} offer has been sitting with us since ${daysAgoLabel(offer.created_at)}. ` +
            `No pressure from my end, but they'll be looking for an answer before long. The card's below whenever you've got a minute.`
          : `Just keeping ${possessive(partner)} offer warm — I know you've had eyes on it. ` +
            `Whenever you're ready, tell me how you want to play it and I'll take care of the rest.`,
        play_intro: "Same table as before:",
        play_mode: "offer_card",
        play_payload: { kind: "offer_reminder", ...cardBase, prose: reminderProse },
        status: "unread",
        created_at: now,
        updated_at: now,
      });
    }

    if (rows.length > 0) {
      // Deterministic ids + ignoreDuplicates: a racing sweep inserts nothing.
      const { error } = await client
        .from("cfc_director_memos")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ created: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
