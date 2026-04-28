import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";
import { LEAGUE_ID } from "../../../../lib/config";
import { getPickValue } from "../../../../lib/trade/value";
import type { DraftPick } from "../../../../lib/picks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

interface CounterSuggestion {
  number: number;
  label: string;
  description: string;
  delta_points: number;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  grade: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function extractName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

function classifyDeal(getsValue: number, givesValue: number): string {
  const ratio = getsValue / Math.max(givesValue, 1);
  if (ratio >= 1.2) return "Steal";
  if (ratio >= 1.05) return "Good Deal";
  if (ratio >= 0.95) return "Fair";
  if (ratio >= 0.8) return "Slight Overpay";
  return "Big Overpay";
}

/* ------------------------------------------------------------------ */
/*  Fetch a team's full roster from Sleeper                            */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roster = rosters.find((r: any) => String(r.roster_id) === String(rosterId));
    if (!roster) return [];

    const assets: OfferAsset[] = [];

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

    const tradedRes = await fetch(
      `https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/traded_picks`,
    );
    const traded = tradedRes.ok ? await tradedRes.json() : [];
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
/*  Generate 3 delta-based counter suggestions                        */
/*                                                                      */
/*  aggression 0   = "Get it done"    (small pullbacks)                */
/*  aggression 100 = "Test their floor" (big pullbacks)               */
/* ------------------------------------------------------------------ */

function generateSuggestions(
  assetsFrom: OfferAsset[],
  assetsTo: OfferAsset[],
  fromValue: number,
  toValue: number,
  aggression: number,
  swapPool: OfferAsset[],
): CounterSuggestion[] {
  const suggestions: CounterSuggestion[] = [];
  const factor = Math.max(0, Math.min(1, aggression / 100));

  const removable = [...assetsTo].sort((a, b) => a.value - b.value);
  const poolPicks = swapPool
    .filter((a) => a.type === "pick" && !assetsTo.some((t) => t.key === a.key))
    .sort((a, b) => b.value - a.value);
  const poolPlayers = swapPool
    .filter((a) => a.type === "player" && !assetsTo.some((t) => t.key === a.key))
    .sort((a, b) => a.value - b.value);

  // --- Strategy A: Remove an asset ---
  if (removable.length > 1) {
    const idx = Math.min(
      Math.floor(factor * (removable.length - 0.01)),
      removable.length - 1,
    );
    const target = removable[idx];
    const newTo = assetsTo.filter((a) => a.key !== target.key);
    const newToVal = newTo.reduce((s, a) => s + a.value, 0);
    suggestions.push({
      number: 1,
      label: `Drop ${extractName(target.label)}`,
      description: `Remove ${extractName(target.label)}, keep everything else`,
      delta_points: Math.round(newToVal - toValue),
      assets_from: assetsFrom,
      assets_to: newTo,
      from_value: fromValue,
      to_value: newToVal,
      grade: classifyDeal(fromValue, newToVal),
    });
  }

  // --- Strategy B: Swap a pick for a lower pick ---
  const picksInSend = assetsTo
    .filter((a) => a.type === "pick")
    .sort((a, b) => b.value - a.value);

  if (picksInSend.length > 0 && poolPicks.length > 0) {
    const target = picksInSend[0];
    const targetVal = target.value * (1 - 0.2 - factor * 0.4);
    const bestSwap = poolPicks.reduce((best, p) =>
      p.value < target.value &&
      Math.abs(p.value - targetVal) < Math.abs(best.value - targetVal)
        ? p
        : best,
      poolPicks[0],
    );
    if (bestSwap && bestSwap.value < target.value) {
      const newTo = assetsTo.map((a) => (a.key === target.key ? bestSwap : a));
      const newToVal = newTo.reduce((s, a) => s + a.value, 0);
      const delta = Math.round(newToVal - toValue);
      const dup = suggestions.some((s) => Math.abs(s.delta_points - delta) < 20);
      if (!dup) {
        suggestions.push({
          number: 2,
          label: `Swap ${extractName(target.label)}`,
          description: `Replace ${extractName(target.label)} with ${extractName(bestSwap.label)}`,
          delta_points: delta,
          assets_from: assetsFrom,
          assets_to: newTo,
          from_value: fromValue,
          to_value: newToVal,
          grade: classifyDeal(fromValue, newToVal),
        });
      }
    }
  }

  // --- Strategy C: Replace a pick with a cheaper player ---
  const picksForSwap = assetsTo
    .filter((a) => a.type === "pick")
    .sort((a, b) => a.value - b.value);

  if (picksForSwap.length > 0 && poolPlayers.length > 0) {
    const pickIdx = Math.min(
      Math.floor(factor * picksForSwap.length),
      picksForSwap.length - 1,
    );
    const target = picksForSwap[pickIdx];
    const targetVal = target.value * (0.5 + (1 - factor) * 0.4);
    const bestPlayer = poolPlayers.reduce((best, p) =>
      Math.abs(p.value - targetVal) < Math.abs(best.value - targetVal)
        ? p
        : best,
      poolPlayers[0],
    );
    if (bestPlayer) {
      const newTo = assetsTo.map((a) => (a.key === target.key ? bestPlayer : a));
      const newToVal = newTo.reduce((s, a) => s + a.value, 0);
      const delta = Math.round(newToVal - toValue);
      const dup = suggestions.some((s) => Math.abs(s.delta_points - delta) < 20);
      if (!dup) {
        suggestions.push({
          number: 3,
          label: `Add ${extractName(bestPlayer.label)} instead`,
          description: `Drop ${extractName(target.label)}, add ${extractName(bestPlayer.label)} instead`,
          delta_points: delta,
          assets_from: assetsFrom,
          assets_to: newTo,
          from_value: fromValue,
          to_value: newToVal,
          grade: classifyDeal(fromValue, newToVal),
        });
      }
    }
  }

  // --- Fallback: additional removal options to reach 3 ---
  if (suggestions.length < 3 && removable.length > 1) {
    for (let i = removable.length - 1; i >= 0 && suggestions.length < 3; i--) {
      const target = removable[i];
      if (suggestions.some((s) => s.label.includes(extractName(target.label)))) continue;
      const newTo = assetsTo.filter((a) => a.key !== target.key);
      const newToVal = newTo.reduce((s, a) => s + a.value, 0);
      suggestions.push({
        number: suggestions.length + 1,
        label: `Drop ${extractName(target.label)}`,
        description: `Remove ${extractName(target.label)} from your side`,
        delta_points: Math.round(newToVal - toValue),
        assets_from: assetsFrom,
        assets_to: newTo,
        from_value: fromValue,
        to_value: newToVal,
        grade: classifyDeal(fromValue, newToVal),
      });
    }
  }

  // Sort by delta magnitude (smallest change first) and renumber
  suggestions.sort((a, b) => Math.abs(a.delta_points) - Math.abs(b.delta_points));
  suggestions.forEach((s, i) => (s.number = i + 1));

  return suggestions.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/*  Generate AI negotiation brief via Anthropic                       */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  threadId: string,
  leagueId: string,
  counterTeamId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  latestOffer: any,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "AI brief unavailable — no API key configured.";

  const [offersRes, messagesRes, teamRows] = await Promise.all([
    client
      .from("trade_offers")
      .select("from_team_id, to_team_id, assets_from, assets_to, from_value, to_value, status, created_at")
      .eq("thread_id", threadId)
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true }),
    client
      .from("trade_messages")
      .select("from_team_id, message, created_at")
      .eq("thread_id", threadId)
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true }),
    client.from("team_email_map").select("roster_id, team_name"),
  ]);

  const teamNames: Record<string, string> = {};
  for (const row of teamRows.data ?? []) {
    if (row.roster_id && row.team_name)
      teamNames[String(row.roster_id)] = row.team_name;
  }
  const getName = (id: string) => teamNames[id] || `Team ${id}`;

  const offers = offersRes.data ?? [];
  const messages = messagesRes.data ?? [];

  const offerSummary = offers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((o: any, i: number) => {
      const from = getName(o.from_team_id);
      const fromAssets = (o.assets_from ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any) => `${extractName(a.label)} (${Math.round(a.value ?? 0)})`)
        .join(", ");
      const toAssets = (o.assets_to ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any) => `${extractName(a.label)} (${Math.round(a.value ?? 0)})`)
        .join(", ");
      return `Offer #${i + 1} (${o.status}): ${from} sends ${fromAssets} for ${toAssets}`;
    })
    .join("\n");

  const chatSummary = messages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => `${getName(m.from_team_id)}: "${m.message}"`)
    .join("\n");

  const counterName = getName(counterTeamId);
  const otherTeamId =
    latestOffer.from_team_id === counterTeamId
      ? latestOffer.to_team_id
      : latestOffer.from_team_id;
  const otherName = getName(otherTeamId);

  const prompt = [
    `You are advising ${counterName} on a dynasty fantasy football trade negotiation with ${otherName}.`,
    "",
    "Offer history:",
    offerSummary,
    "",
    chatSummary ? `Chat messages:\n${chatSummary}` : "No chat messages yet.",
    "",
    `${counterName} is about to send a counter-offer. Write a 2-3 sentence negotiation brief:`,
    "- What has the other team shown they want or need?",
    "- Where is there room to pull back or adjust?",
    "- What leverage does each side have?",
    "",
    "Be direct. Reference player names. No generic advice. Return ONLY the brief text.",
  ].join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 250,
        system:
          "You are a sharp dynasty fantasy football trade advisor. " +
          "Give concise, insider-style negotiation reads. 2-3 sentences max. " +
          "Reference specific players and values. No markdown.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return "AI brief unavailable — API error.";

    const data = await response.json();
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();

    return text || "AI brief unavailable.";
  } catch {
    return "AI brief unavailable.";
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/trades/ai-counter                                        */
/*                                                                      */
/*  Body: {                                                             */
/*    thread_id: string,                                                */
/*    counter_team_id: string,                                          */
/*    aggression?: number,    // 0-100, default 50                      */
/*  }                                                                   */
/*                                                                      */
/*  Returns: {                                                          */
/*    suggestions: CounterSuggestion[],                                */
/*    brief: string,                                                    */
/*    latest_offer_id: string                                           */
/*  }                                                                   */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    thread_id,
    counter_team_id,
    aggression: rawAggression = 50,
  } = body as {
    thread_id?: string;
    counter_team_id?: string;
    aggression?: number;
  };

  if (!thread_id || !counter_team_id) {
    return NextResponse.json(
      { error: "thread_id and counter_team_id are required" },
      { status: 400 },
    );
  }

  const aggression = Math.max(0, Math.min(100, Number(rawAggression) || 50));

  const league_id = LEAGUE_ID;
  if (!league_id) {
    return NextResponse.json({ error: "League ID not configured" }, { status: 500 });
  }

  const { client, error: clientError } = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: clientError }, { status: 500 });
  }

  // Fetch latest pending offer in thread
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

  // Fetch CFC values
  const { data: pvData } = await client
    .from("cfc_trade_values_current")
    .select("sleeper_player_id, asset_key, cfc_value");

  const cfcValues: Record<string, number> = {};
  for (const row of pvData ?? []) {
    if (typeof row.cfc_value !== "number") continue;
    if (row.sleeper_player_id) cfcValues[row.sleeper_player_id] = row.cfc_value;
    if (row.asset_key?.startsWith("pick.")) cfcValues[row.asset_key] = row.cfc_value;
  }

  // Fetch counter team's full roster for swap candidates
  const fullRoster = await fetchSleeperRoster(counter_team_id, cfcValues);
  const existingKeys = new Set([
    ...(latestOffer.assets_from ?? []).map((a: OfferAsset) => a.key),
    ...(latestOffer.assets_to ?? []).map((a: OfferAsset) => a.key),
  ]);
  const swapPool = fullRoster.filter((a) => !existingKeys.has(a.key));

  // Generate suggestions and brief in parallel
  const [suggestions, brief] = await Promise.all([
    Promise.resolve(
      generateSuggestions(
        latestOffer.assets_from ?? [],
        latestOffer.assets_to ?? [],
        latestOffer.from_value ?? 0,
        latestOffer.to_value ?? 0,
        aggression,
        swapPool,
      ),
    ),
    generateBrief(client, thread_id, league_id, counter_team_id, latestOffer),
  ]);

  if (suggestions.length === 0) {
    return NextResponse.json({
      suggestions: [],
      brief,
      latest_offer_id: latestOffer.id,
      message:
        "No suitable modifications found. Try adjusting the slider or use the Trade Machine to build a counter manually.",
    });
  }

  return NextResponse.json({
    suggestions,
    brief,
    latest_offer_id: latestOffer.id,
  });
}
