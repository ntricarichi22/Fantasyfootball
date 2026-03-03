import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";
import { getPickValue } from "../../../../lib/trade/value";
import type { DraftPick } from "../../../../lib/picks";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
}

type Preference =
  | "more_value"
  | "more_picks"
  | "more_depth"
  | "upgrade_at_QB"
  | "upgrade_at_RB"
  | "upgrade_at_WR"
  | "upgrade_at_TE"
  | "prefer_2026"
  | "prefer_2027";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

async function fetchSleeperRoster(
  rosterId: string,
  cfcValues: Record<string, number>,
): Promise<OfferAsset[]> {
  if (!LEAGUE_ID_ENV) return [];
  try {
    const [rosterRes, playerRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`),
      fetch("https://api.sleeper.app/v1/players/nfl"),
    ]);
    if (!rosterRes.ok || !playerRes.ok) return [];

    const rosters = await rosterRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerDict: Record<string, any> = await playerRes.json();

    const roster = rosters.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => String(r.roster_id) === String(rosterId),
    );
    if (!roster) return [];

    const assets: OfferAsset[] = [];

    // Players
    for (const pid of roster.players ?? []) {
      const id = String(pid);
      const info = playerDict[id];
      const value = cfcValues[id] ?? 0;
      if (!value) continue;
      const name =
        info?.full_name ||
        [info?.first_name, info?.last_name].filter(Boolean).join(" ") ||
        id;
      assets.push({
        key: `player:${id}`,
        label: name,
        type: "player",
        position: info?.position?.toUpperCase() || "–",
        team: info?.team || "FA",
        ageLabel: info?.age ? String(info.age) : "–",
        value,
      });
    }

    // Draft picks (roster.draft_picks may not exist without traded-picks context;
    // we use a simplified fetch here)
    const tradedRes = await fetch(
      `https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/traded_picks`,
    );
    const traded = tradedRes.ok ? await tradedRes.json() : [];

    // Build effective picks: picks currently owned by this roster (via traded_picks)
    const teamCount = rosters.length || 12;

    for (const tp of traded) {
      if (String(tp.owner_id) === String(rosterId)) {
        const pick: DraftPick = {
          season: tp.season,
          round: tp.round,
          roster_id: tp.owner_id,
          original_roster_id: tp.roster_id,
        };
        const value = getPickValue(pick, { teamCount, cfcValues });
        if (!value) continue;
        assets.push({
          key: `pick:${tp.season}-${tp.round}-${tp.roster_id}`,
          label: `${tp.season} Round ${tp.round} Pick`,
          type: "pick",
          value,
        });
      }
    }

    return assets;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Sort picks by round preference (3rd > 2nd > 1st) then year        */
/* ------------------------------------------------------------------ */

function sortPicksByPreference(picks: OfferAsset[], preferredYear: string): OfferAsset[] {
  return [...picks].sort((a, b) => {
    // Key format: "pick:YYYY-ROUND-ROSTERID"
    const aParts = a.key.split("-");
    const bParts = b.key.split("-");
    const aRound = Number(aParts[1]) || 99;
    const bRound = Number(bParts[1]) || 99;
    // Prefer higher round number first (3rd before 2nd before 1st)
    if (aRound !== bRound) return bRound - aRound;
    // Within same round, prefer the chosen year
    const aYearPref = a.key.startsWith(`pick:${preferredYear}`) ? 1 : 0;
    const bYearPref = b.key.startsWith(`pick:${preferredYear}`) ? 1 : 0;
    if (aYearPref !== bYearPref) return bYearPref - aYearPref;
    return a.value - b.value;
  });
}

/* ------------------------------------------------------------------ */
/*  Build up to 3 add-on sets from the sender's pool                  */
/*  Each set contains at most 2 assets to add to the sender's side    */
/* ------------------------------------------------------------------ */

function buildAddOnSets(senderPool: OfferAsset[], preference: Preference): OfferAsset[][] {
  const preferredYear = preference === "prefer_2027" ? "2027" : "2026";
  let candidates: OfferAsset[];

  if (
    preference === "more_picks" ||
    preference === "prefer_2026" ||
    preference === "prefer_2027"
  ) {
    // Picks only, sorted round-3-first then preferred year
    candidates = sortPicksByPreference(
      senderPool.filter((a) => a.type === "pick"),
      preferredYear,
    );
  } else if (preference === "more_depth") {
    // Lower-value players/picks first (2-for-1 flavour)
    candidates = [...senderPool].sort((a, b) => a.value - b.value);
  } else if (preference.startsWith("upgrade_at_")) {
    const pos = preference.replace("upgrade_at_", "").toUpperCase();
    candidates = senderPool.filter((a) => a.type === "player" && a.position === pos);
    candidates.sort((a, b) => b.value - a.value);
    // Fall back to picks if no matching players
    if (candidates.length === 0) {
      candidates = sortPicksByPreference(
        senderPool.filter((a) => a.type === "pick"),
        preferredYear,
      );
    }
  } else {
    // more_value: highest-value assets first
    candidates = [...senderPool].sort((a, b) => b.value - a.value);
  }

  if (candidates.length === 0) return [];

  const sets: OfferAsset[][] = [];

  // Option A: single best candidate
  sets.push([candidates[0]]);

  // Option B: second distinct candidate (different pick/player)
  if (candidates.length >= 2) {
    sets.push([candidates[1]]);
  }

  // Option C: two-asset combination (at most 2 assets)
  if (candidates.length >= 2) {
    sets.push([candidates[0], candidates[1]]);
  }

  return sets.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/*  Classify deal quality from the sender's perspective                 */
/* ------------------------------------------------------------------ */

function classifyDeal(senderGets: number, senderGives: number): string {
  const ratio = senderGets / Math.max(senderGives, 1);
  if (ratio >= 1.2) return "Steal";
  if (ratio >= 1.05) return "Good Deal";
  if (ratio >= 0.95) return "Fair";
  if (ratio >= 0.8) return "Slight Overpay";
  return "Big Overpay";
}

/* ------------------------------------------------------------------ */
/*  POST /api/trades/ai-counter                                        */
/*                                                                      */
/*  Body: {                                                             */
/*    thread_id: string,                                                */
/*    counter_team_id: string,        -- team making the counter        */
/*    preference?: Preference,                                          */
/*  }                                                                   */
/*                                                                      */
/*  Returns: { suggestions: AISuggestion[] }  (3 items)               */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { thread_id, counter_team_id, preference = "more_value" } = body as {
    thread_id?: string;
    counter_team_id?: string;
    preference?: Preference;
  };

  if (!thread_id || !counter_team_id) {
    return NextResponse.json(
      { error: "thread_id and counter_team_id are required" },
      { status: 400 },
    );
  }

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Fetch latest pending offer in the thread
  const { data: offers, error: offersError } = await client
    .from("trade_offers")
    .select("*")
    .eq("thread_id", thread_id)
    .eq("league_id", league_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (offersError || !offers?.length) {
    return NextResponse.json(
      { error: "No pending offer found in thread" },
      { status: 404 },
    );
  }

  const latestOffer = offers[0];

  // The counter team is the RECEIVER of the current pending offer.
  // When they counter, they want to adjust what the ORIGINAL SENDER gives them.
  // We must preserve both sides of the base offer and only ADD assets to the
  // sender's side (assets_from) based on the receiver's preference.

  const originalSenderId: string = latestOffer.from_team_id;
  const originalFromValue: number = latestOffer.from_value ?? 0; // what receiver currently gets
  const originalToValue: number = latestOffer.to_value ?? 0;     // what receiver currently sends

  // Fetch player + pick values from cfc_trade_values_current (single source of truth)
  const { data: pvData } = await client
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, asset_key, cfc_value");

  const cfcValues: Record<string, number> = {};
  for (const row of pvData ?? []) {
    if (typeof row.cfc_value !== "number") continue;
    // Players: keyed by sleeper_player_id
    if (row.sleeper_player_id) {
      cfcValues[row.sleeper_player_id] = row.cfc_value;
    }
    // Picks: keyed by asset_key (e.g. "pick.1.01")
    if (row.asset_key?.startsWith("pick.")) {
      cfcValues[row.asset_key] = row.cfc_value;
    }
  }

  // Fetch SENDER's available assets (the team whose offer is being countered).
  // The counter asks the sender to add assets, so we pull from their pool.
  const senderPool = await fetchSleeperRoster(originalSenderId, cfcValues);

  // Remove assets already in the base offer from the pool to avoid duplicates
  const baseFromKeys = new Set((latestOffer.assets_from ?? []).map((a: OfferAsset) => a.key));
  const availablePool = senderPool.filter((a) => !baseFromKeys.has(a.key));

  // Build up to 3 add-on sets (assets to append to the sender's side)
  const addOnSets = buildAddOnSets(availablePool, preference);

  if (addOnSets.length === 0) {
    return NextResponse.json(
      {
        suggestions: [],
        message:
          "No suitable assets found in the sender's roster to build a counter. " +
          "Try a different preference or use the manual counter instead.",
      },
      { status: 200 },
    );
  }

  const suggestions = addOnSets.map((addOns) => {
    const newFromAssets: OfferAsset[] = [...(latestOffer.assets_from ?? []), ...addOns];
    const addOnValue = addOns.reduce((s, a) => s + a.value, 0);
    const newFromValue = originalFromValue + addOnValue;

    const gradeLabel =
      addOns.length === 2
        ? "Two-asset add-on"
        : `${addOns[0].label} add-on`;

    return {
      grade_label: gradeLabel,
      assets_from: newFromAssets,          // augmented sender's side (receiver gets this)
      assets_to: latestOffer.assets_to,    // receiver's send side preserved
      from_value: newFromValue,
      to_value: originalToValue,
      grade: classifyDeal(newFromValue, originalToValue),
    };
  });

  return NextResponse.json({ suggestions, latest_offer_id: latestOffer.id });
}
