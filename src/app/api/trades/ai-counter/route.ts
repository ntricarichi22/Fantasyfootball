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
  playerValues: Record<string, number>,
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
      const value = playerValues[id] ?? 0;
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
        const value = getPickValue(pick, { teamCount });
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
/*  Greedy knapsack: find a subset of assets close to target value     */
/* ------------------------------------------------------------------ */

function selectAssets(
  pool: OfferAsset[],
  targetValue: number,
  preference: Preference,
): OfferAsset[] {
  // Sort pool by preference
  const sorted = [...pool];

  if (preference === "more_picks") {
    sorted.sort((a, b) => {
      if (a.type === "pick" && b.type !== "pick") return -1;
      if (a.type !== "pick" && b.type === "pick") return 1;
      return b.value - a.value;
    });
  } else if (preference === "more_depth") {
    // Prefer lower-value assets (2-for-1 style)
    sorted.sort((a, b) => a.value - b.value);
  } else if (preference.startsWith("upgrade_at_")) {
    const pos = preference.replace("upgrade_at_", "").toUpperCase();
    sorted.sort((a, b) => {
      const aMatch = a.position === pos ? 1 : 0;
      const bMatch = b.position === pos ? 1 : 0;
      if (bMatch !== aMatch) return bMatch - aMatch;
      return b.value - a.value;
    });
  } else if (preference === "prefer_2026") {
    sorted.sort((a, b) => {
      const aYear = a.key.includes("2026") ? 1 : 0;
      const bYear = b.key.includes("2026") ? 1 : 0;
      if (bYear !== aYear) return bYear - aYear;
      return b.value - a.value;
    });
  } else if (preference === "prefer_2027") {
    sorted.sort((a, b) => {
      const aYear = a.key.includes("2027") ? 1 : 0;
      const bYear = b.key.includes("2027") ? 1 : 0;
      if (bYear !== aYear) return bYear - aYear;
      return b.value - a.value;
    });
  } else {
    // default: more_value – largest assets first
    sorted.sort((a, b) => b.value - a.value);
  }

  const selected: OfferAsset[] = [];
  let remaining = targetValue;

  for (const asset of sorted) {
    if (remaining <= 0) break;
    // Allow up to 30 % overshoot on the remaining budget so we can always
    // include at least one meaningful asset even when the remaining value
    // is small relative to individual asset prices.
    if (asset.value <= remaining * 1.3) {
      selected.push(asset);
      remaining -= asset.value;
    }
  }

  return selected;
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

  // The counter team is the receiver of the current latest offer.
  // They want to counter-propose:
  //   - Keep what they receive (assets_from) unchanged (they still want those)
  //   - Change what they send (assets_to) to different value targets

  // What the original sender asked for (value the counter team will "receive"):
  const originalFromValue: number = latestOffer.from_value ?? 0;
  // What the counter team is currently asked to send:
  // const originalToValue: number = latestOffer.to_value ?? 0;

  // Fetch player values from DB
  const { data: pvData } = await client
    .from("player_values")
    .select("player_id, value")
    .eq("league_id", league_id);

  const playerValues: Record<string, number> = {};
  for (const row of pvData ?? []) {
    playerValues[row.player_id] = row.value;
  }

  // Fetch counter team's available assets from Sleeper
  const pool = await fetchSleeperRoster(counter_team_id, playerValues);

  // Target values for three quality levels (from counter team's perspective):
  // "Fair" means the counter team sends ≈ same value as what they'd receive (originalFromValue)
  const targets = [
    { label: "Fair", multiplier: 1.0 },
    { label: "Slight Overpay", multiplier: 1.12 }, // generous counter
    { label: "Slight Underpay", multiplier: 0.88 }, // tighter counter
  ];

  const suggestions = targets.map(({ label, multiplier }) => {
    const targetValue = Math.round(originalFromValue * multiplier);
    const selectedAssets = selectAssets(pool, targetValue, preference);
    const totalValue = selectedAssets.reduce((s, a) => s + a.value, 0);

    return {
      grade_label: label,
      assets_from: latestOffer.assets_from, // counter team receives (unchanged)
      assets_to: selectedAssets,            // counter team sends (new)
      from_value: originalFromValue,
      to_value: totalValue,
      grade: classifyDeal(originalFromValue, totalValue),
    };
  });

  return NextResponse.json({ suggestions, latest_offer_id: latestOffer.id });
}
