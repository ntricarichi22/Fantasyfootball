import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { getLeagueData } from "@/shared/league-data";
import { fetchPlayers } from "@/shared/league-data/sleeper";
import { buildScrubSets, bucketOf } from "@/shared/team-profiles";
import { normalizePersona, bandFor } from "@/pro-personnel/engine/core/personas";
import {
  buildValuationContext,
  valueAsset,
  isYoung,
  type AssetRef,
} from "@/shared/asset-values";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The counter drawer's data feed. EVERYTHING comes from the canonical league
// pipeline — the same getLeagueData() the trade engine reads. We do NOT re-load
// rosters, re-classify youth, re-derive scrub cutoffs, or hand-parse picks here;
// those are the engine's single sources of truth (spent-aware pickOwnership,
// buildScrubSets, isYoung, bandFor). The only thing unique to counter mode lives
// client-side: the slider UI and how the card re-balances as you slide.

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
}

function refFor(key: string): AssetRef {
  if (key.startsWith("pick:")) return { type: "pick", key };
  if (key.startsWith("player:")) return { type: "player", sleeperPlayerId: key.slice(7) };
  return { type: "player", sleeperPlayerId: key };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { thread_id, counter_team_id } = body as { thread_id?: string; counter_team_id?: string };
  if (!thread_id || !counter_team_id) {
    return NextResponse.json({ error: "thread_id and counter_team_id are required" }, { status: 400 });
  }

  const league_id = LEAGUE_ID;
  if (!league_id) return NextResponse.json({ error: "League ID not configured" }, { status: 500 });

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

  // Latest live offer in the thread — what we're countering.
  const { data: offers, error: offersError } = await client
    .from("trade_offers")
    .select("*")
    .eq("thread_id", thread_id)
    .eq("league_id", league_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (offersError || !offers?.length) {
    return NextResponse.json({ error: "No pending offer found in thread" }, { status: 404 });
  }

  const latestOffer = offers[0];
  const us = String(counter_team_id);
  const them =
    String(latestOffer.from_team_id) === us
      ? String(latestOffer.to_team_id)
      : String(latestOffer.from_team_id);

  // Canonical inputs. data carries spent-aware pickOwnership (incl. originals),
  // player age+exp, stud flags, strategy/markets, and personas. nflDict is the
  // raw Sleeper dictionary — used ONLY for the NFL-team display string (the one
  // field the value pipeline doesn't carry); it's TTL-cached, so this is free.
  const [data, ctx, nflDict] = await Promise.all([
    getLeagueData(),
    buildValuationContext(),
    fetchPlayers(),
  ]);
  if ("error" in data) return NextResponse.json({ error: data.error }, { status: 500 });

  const ourStrat = data.strategy.get(us) ?? null;
  const ourPersona = normalizePersona(data.strategy.get(us)?.persona);
  const theirPersona = normalizePersona(data.strategy.get(them)?.persona);
  const our_band = bandFor(ourPersona);
  const their_band = bandFor(theirPersona);

  const teamById = new Map(data.teams.map((t) => [t.rosterId, t]));

  // A team's ENTIRE roster as OfferAssets — players + spent-aware picks, every
  // asset valued from OUR seat. Unfiltered: this is what the manual +add panel
  // shows for BOTH sides. No scrub gate, no market gate — the user can add anyone.
  const fullRoster = (teamId: string): OfferAsset[] => {
    const team = teamById.get(teamId);
    if (!team) return [];
    const assets: OfferAsset[] = [];
    for (const p of team.players) {
      const value = valueAsset({ type: "player", sleeperPlayerId: p.id }, ctx, { perspective: us });
      assets.push({
        key: `player:${p.id}`,
        label: p.name,
        type: "player",
        position: p.position,
        team: nflDict[p.id]?.team || "FA",
        ageLabel: p.age != null ? String(p.age) : "–",
        value,
      });
    }
    for (const pk of data.pickOwnership.get(teamId) ?? []) {
      const value = valueAsset({ type: "pick", key: pk.key }, ctx, { perspective: us });
      assets.push({ key: pk.key, label: `${pk.season} Round ${pk.round} Pick`, type: "pick", value });
    }
    return assets;
  }

  const our_roster = fullRoster(us);
  const their_roster = fullRoster(them);

  // The slider's auto-demand pool — a CONSERVATIVE subset of the partner's roster
  // (the manual panel can still reach everyone). Canonical scrub gate: keep picks,
  // studs, and starter-level (within startable depth) unconditionally; keep buried
  // youth only at a position we're buying; drop the rest so the slider never
  // dribbles in scrubs. Uses buildScrubSets + isYoung — no reinvented cutoffs.
  const scrubSets = buildScrubSets(data);
  const isScrub = (id: string, position: string): boolean => {
    const b = bucketOf(position);
    return b ? scrubSets.get(b)?.has(id) ?? false : false;
  };
  const buyPositions = new Set<string>();
  if (ourStrat?.qbMarket === "buy") buyPositions.add("QB");
  if (ourStrat?.rbMarket === "buy") buyPositions.add("RB");
  if (ourStrat?.pcMarket === "buy") { buyPositions.add("WR"); buyPositions.add("TE"); }

  const existingKeys = new Set([
    ...(latestOffer.assets_from ?? []).map((a: OfferAsset) => a.key),
    ...(latestOffer.assets_to ?? []).map((a: OfferAsset) => a.key),
  ]);

  const demand_pool = their_roster.filter((a) => {
    if (existingKeys.has(a.key)) return false;
    if (a.type === "pick") return true;
    const id = a.key.replace("player:", "");
    const info = data.players.get(id);
    if (!info) return false;
    if (data.values.isStud.get(id)) return true;
    if (!isScrub(id, info.position)) return true; // starter-level
    if (isYoung(info.position, info.age, info.exp)) return buyPositions.has(info.position);
    return false;
  });

  // Re-price the offer's own assets from our seat (intent-aware) — the seed the
  // slider/card open from.
  const offer_values: Record<string, number> = {};
  for (const a of [
    ...(latestOffer.assets_from ?? []),
    ...(latestOffer.assets_to ?? []),
  ] as OfferAsset[]) {
    offer_values[a.key] = valueAsset(refFor(a.key), ctx, { perspective: us });
  }

  return NextResponse.json({
    latest_offer_id: latestOffer.id,
    their_persona: theirPersona,
    their_band,
    our_persona: ourPersona,
    our_band,
    demand_pool, // slider auto-demand (scrub-gated)
    our_roster, // full roster, manual +add (our side)
    their_roster, // full roster, manual +add (their side)
    offer_values,
  });
}
