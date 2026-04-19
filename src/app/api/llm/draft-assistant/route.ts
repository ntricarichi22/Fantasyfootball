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

type AssistantRequest = {
  mode: "briefing" | "recommendation" | "chat";
  teamName?: string;
  roster?: unknown;
  teamNeeds?: unknown;
  availablePlayers?: unknown;
  recentPicks?: unknown;
  draftLog?: unknown;
  currentPick?: { round?: number; pick?: number; onClock?: string };
  messages?: ChatMessage[];
};

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicContentBlock = AnthropicTextBlock | { type: string; [key: string]: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
};

const MODEL = "claude-sonnet-4-5";

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
    `Available players (top of board): ${JSON.stringify(body.availablePlayers ?? [])}.\n` +
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

  const userContent =
    `Team: ${body.teamName ?? "Unknown"}.\n` +
    `Roster: ${JSON.stringify(body.roster ?? [])}.\n` +
    `Team needs: ${JSON.stringify(body.teamNeeds ?? {})}.\n` +
    `Available players: ${JSON.stringify(body.availablePlayers ?? [])}.\n` +
    `Recent picks: ${JSON.stringify(body.recentPicks ?? [])}.\n` +
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

  const system =
    `You are the Assistant GM for the ${teamName} in the CFC dynasty fantasy football league. ` +
    "You are an expert dynasty analyst. Be concise and direct. You know this team's roster " +
    "inside and out.\n\n" +
    `TEAM ROSTER: ${JSON.stringify(body.roster ?? [])}\n` +
    `TEAM NEEDS: ${JSON.stringify(body.teamNeeds ?? {})}\n` +
    `DRAFT BOARD (available players): ${JSON.stringify(body.availablePlayers ?? [])}\n` +
    `PICKS MADE SO FAR: ${JSON.stringify(body.draftLog ?? [])}\n` +
    `CURRENT STATE: ${onClock} is on the clock, Round ${round}, Pick ${pick}\n\n` +
    "Answer questions about draft strategy, player comparisons, and trade ideas. When " +
    "recommending a pick, include a confidence percentage. Keep responses tight (1-3 short " +
    "paragraphs).";

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
      const text = await callAnthropic(apiKey, system, messages, 500);
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
      const text = await callAnthropic(apiKey, system, messages, 1000);
      return NextResponse.json({ ok: true, text });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown mode: ${body.mode}` },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
