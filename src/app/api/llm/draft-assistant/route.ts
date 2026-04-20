import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// Anthropic API proxy for the in-draft Assistant GM panel.
//
// Three "modes" share the same proxy so we only need one route:
//   - "briefing"        -> generate the auto-briefing trends summary
//   - "recommendation"  -> recommend the next best pick + confidence
//   - "chat"            -> conversational Q&A with full draft context
//
// Keeping the Anthropic API key server-side is required: the spec
// suggests calling the API directly from the browser, but doing so
// would leak the key in the bundle.
// ============================================================

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type LeagueTeamContext = {
  rosterId?: string;
  teamName?: string;
  players?: Array<{ name: string; pos: string; value: number }>;
  needs?: string[];
  mode?: string;
  posture?: string;
  positionBands?: Record<string, string>;
};

type LeagueDraftContext = {
  status?: string;
  isPaused?: boolean;
  totalPicks?: number;
  picksRemaining?: number;
  teams?: LeagueTeamContext[];
  fullAvailablePlayers?: unknown;
  myTeamTradeValues?: Array<{ name: string; pos: string; value: number }>;
};

type AssistantRequest = {
  mode: "briefing" | "recommendation" | "chat";
  teamName?: string;
  roster?: unknown;
  teamNeeds?: unknown;
  availablePlayers?: unknown;
  recentPicks?: unknown;
  draftLog?: unknown;
  currentPick?: { round?: number; pick?: number; onClock?: string };
  isDraftPaused?: boolean;
  leagueContext?: LeagueDraftContext | null;
  myTeamTradeValues?: Array<{ name: string; pos: string; value: number }>;
  messages?: ChatMessage[];
};

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicContentBlock = AnthropicTextBlock | { type: string; [key: string]: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
};

const MODEL = "claude-sonnet-4-5";

// Strip any normalized 0-100 board scores (`value`, `fit`) from a list of
// available-player payloads so the LLM only ever sees the raw cfc trade
// value. Defense in depth — the client should already be sending the
// scrubbed shape, but enforce it server-side too.
function sanitizeAvailableForLLM(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return [];
  return input.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(p)) {
      if (key === "value" || key === "fit") continue;
      out[key] = p[key];
    }
    return out;
  });
}

function buildBriefingMessages(body: AssistantRequest): {
  system: string;
  messages: { role: "user"; content: string }[];
} {
  const system =
    "You are the Assistant GM for a dynasty fantasy football team. Be concise and direct. " +
    "Analyze the recent draft picks and identify trends. Keep your response to 2-3 sentences. " +
    "Highlight any position runs or notable patterns. When you call out a key pattern (like a " +
    "position run or a notable name), wrap the keyword in double asterisks so the UI can render " +
    "it bold (e.g. **RB run:**). Do not use markdown headings or lists.";

  const userContent =
    `Recent draft picks: ${JSON.stringify(body.recentPicks ?? [])}.\n` +
    `Available players (top of board): ${JSON.stringify(sanitizeAvailableForLLM(body.availablePlayers))}.\n` +
    `My team needs: ${JSON.stringify(body.teamNeeds ?? {})}.\n` +
    `What are the key trends I should know about?`;

  return { system, messages: [{ role: "user", content: userContent }] };
}

function buildRecommendationMessages(body: AssistantRequest): {
  system: string;
  messages: { role: "user"; content: string }[];
} {
  const system =
    "You are the Assistant GM for a dynasty fantasy football team. Recommend the single best " +
    "available player to draft right now given the team's roster, positional needs, and the " +
    "remaining player pool. Respond in strict JSON only, with this exact shape:\n" +
    `{"playerId":"<id from availablePlayers>","playerName":"<full name>","position":"<POS>",` +
    `"meta":"<one short line, e.g. 'RB · Iowa · Rookie · 21'>",` +
    `"rationale":"<one sentence reason>","confidence":<integer 0-100>}\n` +
    "Do not wrap the JSON in code fences. Do not include any prose outside the JSON.";

  const ctx = body.leagueContext || {};
  const userContent =
    `Team: ${body.teamName ?? "Unknown"}.\n` +
    `Roster: ${JSON.stringify(body.roster ?? [])}.\n` +
    `Team needs: ${JSON.stringify(body.teamNeeds ?? {})}.\n` +
    `Available players: ${JSON.stringify(sanitizeAvailableForLLM(body.availablePlayers))}.\n` +
    `Recent picks: ${JSON.stringify(body.recentPicks ?? [])}.\n` +
    `My team trade values: ${JSON.stringify(body.myTeamTradeValues ?? [])}.\n` +
    `League draft state: ${JSON.stringify({
      status: ctx.status,
      isPaused: ctx.isPaused,
      totalPicks: ctx.totalPicks,
      picksRemaining: ctx.picksRemaining,
    })}.\n` +
    `Recommend the best pick now.`;

  return { system, messages: [{ role: "user", content: userContent }] };
}

function buildChatMessages(body: AssistantRequest): {
  system: string;
  messages: ChatMessage[];
} {
  const teamName = body.teamName || "your team";
  const round = body.currentPick?.round ?? "?";
  const pick = body.currentPick?.pick ?? "?";
  const onClock = body.currentPick?.onClock ?? "Unknown";
  const ctx = body.leagueContext || {};
  const status = ctx.status || (body.isDraftPaused ? "paused" : "running");
  const totalPicks = ctx.totalPicks ?? 0;
  const picksRemaining = ctx.picksRemaining ?? 0;
  const allTeams: LeagueTeamContext[] = ctx.teams || [];

  // PICKS MADE SO FAR — list of {pickNumber, playerName, position, teamName}
  const picksLines = Array.isArray(body.draftLog)
    ? (body.draftLog as Array<{
        pick?: string | number;
        player?: string;
        pos?: string;
        team?: string;
      }>)
        .map(
          (p) =>
            `Pick ${p.pick ?? "?"}: ${p.player ?? "?"} (${p.pos ?? "?"}) to ${p.team ?? "?"}`
        )
        .join("\n")
    : "";

  // AVAILABLE PLAYERS — use real trade values from cfc_trade_values_current
  // so the model can compare prospects against rostered players on the same
  // scale. Limit to top 36 to keep prompt size in check. Never include the
  // normalized 0-100 board scores.
  const availLines = Array.isArray(body.availablePlayers)
    ? (body.availablePlayers as Array<{
        name?: string;
        pos?: string;
        school?: string;
        team?: string;
        tradeValue?: number;
      }>)
        .slice(0, 36)
        .map((p) => {
          const tradeVal =
            typeof p.tradeValue === "number" && Number.isFinite(p.tradeValue)
              ? p.tradeValue
              : 0;
          return `${p.name ?? "?"} - ${p.pos ?? "?"} - ${p.school || p.team || ""} - Trade Value: ${tradeVal}`;
        })
        .join("\n")
    : "";

  // MY TEAM ROSTER
  const myTeam = allTeams.find((t) => t.teamName === body.teamName);
  const myRosterLines = myTeam
    ? (myTeam.players ?? [])
        .map((p) => `${p.pos || "?"}: ${p.name}`)
        .join("\n")
    : JSON.stringify(body.roster ?? []);

  const myNeedsLines = JSON.stringify(body.teamNeeds ?? []);

  // ALL TEAM ROSTERS AND NEEDS
  const allTeamsLines = allTeams
    .map((t) => {
      const players = (t.players ?? [])
        .slice(0, 20)
        .map((p) => `  - ${p.pos || "?"}: ${p.name} (val ${p.value ?? 0})`)
        .join("\n");
      const needs = (t.needs ?? []).join(", ") || "—";
      return `Team: ${t.teamName} [mode: ${t.mode || "?"}, posture: ${t.posture || "?"}]\nNeeds: ${needs}\nKey players:\n${players}`;
    })
    .join("\n\n");

  // TRADE VALUES (active team)
  const tradeValuesLines = (body.myTeamTradeValues ?? [])
    .map((p) => `${p.name} (${p.pos || "?"}): ${p.value}`)
    .join("\n");

  const system =
    `You are the Assistant GM for the ${teamName} in the CFC dynasty fantasy football league. ` +
    `You have deep knowledge of every team's roster, needs, and strategy.\n\n` +
    `CURRENT DRAFT STATE:\n` +
    `- Status: ${status}\n` +
    `- Current pick: Round ${round}, Pick ${pick}\n` +
    `- Team on the clock: ${onClock}\n` +
    `- Picks remaining: ${picksRemaining} of ${totalPicks}\n\n` +
    `PICKS MADE SO FAR:\n${picksLines || "(no picks yet)"}\n\n` +
    `AVAILABLE PLAYERS (not yet drafted):\n${availLines || "(none)"}\n\n` +
    `MY TEAM (${teamName}) ROSTER:\n${myRosterLines || "(empty)"}\n\n` +
    `MY TEAM NEEDS:\n${myNeedsLines}\n\n` +
    `ALL TEAM ROSTERS AND NEEDS:\n${allTeamsLines || "(unavailable)"}\n\n` +
    `TRADE VALUES (${teamName}):\n${tradeValuesLines || "(unavailable)"}\n\n` +
    `Trade values are on a consistent scale. A player with trade value 288 is worth ` +
    `roughly 2.6x a player valued at 109. Use these values for direct comparisons ` +
    `between prospects and rostered players.\n\n` +
    `You are an expert dynasty fantasy football analyst. Be concise and direct. ` +
    `When recommending picks, include a confidence percentage. When analyzing other ` +
    `teams, use their actual roster data and needs. Always reference specific player ` +
    `names and positions.`;

  const messages: ChatMessage[] = (body.messages ?? []).filter(
    (m): m is ChatMessage =>
      !!m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.length > 0
  );

  if (messages.length === 0) {
    return {
      system,
      messages: [{ role: "user", content: "Give me one quick thought on the current draft." }],
    };
  }

  return { system, messages };
}

async function callAnthropic(
  apiKey: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const textBlocks = (data.content ?? []).filter(
    (b): b is AnthropicTextBlock => b.type === "text" && typeof (b as AnthropicTextBlock).text === "string"
  );
  return textBlocks
    .map((b) => b.text)
    .join("\n")
    .trim();
}

type RecommendationPayload = {
  playerId: string;
  playerName: string;
  position: string;
  meta: string;
  rationale: string;
  confidence: number;
};

function tryParseRecommendation(raw: string): RecommendationPayload | null {
  // The model is instructed to return raw JSON, but be defensive in case it
  // wraps in code fences or adds prose around the object.
  const trimmed = raw.trim();
  const candidates: string[] = [];
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<RecommendationPayload> & {
        confidence?: unknown;
      };
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.playerName === "string" &&
        typeof parsed.confidence !== "undefined"
      ) {
        const confidence = Math.max(
          0,
          Math.min(100, Math.round(Number(parsed.confidence) || 0))
        );
        return {
          playerId: String(parsed.playerId ?? ""),
          playerName: String(parsed.playerName ?? ""),
          position: String(parsed.position ?? ""),
          meta: String(parsed.meta ?? ""),
          rationale: String(parsed.rationale ?? ""),
          confidence,
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing ANTHROPIC_API_KEY" },
      { status: 500 }
    );
  }

  let body: AssistantRequest;
  try {
    body = (await request.json()) as AssistantRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || !body.mode) {
    return NextResponse.json({ ok: false, error: "Missing 'mode'" }, { status: 400 });
  }

  try {
    if (body.mode === "briefing") {
      const { system, messages } = buildBriefingMessages(body);
      const text = await callAnthropic(apiKey, system, messages, 600);
      return NextResponse.json({ ok: true, text });
    }

    if (body.mode === "recommendation") {
      const { system, messages } = buildRecommendationMessages(body);
      console.log("[draft-assistant] recommendation system prompt length", system.length);
      const text = await callAnthropic(apiKey, system, messages, 500);
      console.log("[draft-assistant] recommendation raw response", text);
      const parsed = tryParseRecommendation(text);
      if (!parsed) {
        return NextResponse.json(
          { ok: false, error: "Recommendation could not be parsed", raw: text },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: true, recommendation: parsed });
    }

    if (body.mode === "chat") {
      const { system, messages } = buildChatMessages(body);
      console.log("[draft-assistant] chat system prompt length", system.length);
      const text = await callAnthropic(apiKey, system, messages, 1200);
      return NextResponse.json({ ok: true, text });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown mode: ${body.mode}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("[draft-assistant] error", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
