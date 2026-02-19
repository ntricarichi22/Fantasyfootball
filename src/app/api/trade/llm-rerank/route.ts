import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  id: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  value: number;
}

interface Offer {
  id: string;
  partnerId: number | string;
  partner: string;
  send: OfferAsset[];
  receive: OfferAsset[];
  tags: string[];
  fairness: string;
  explanation: string;
  valueSent: number;
  valueReceived: number;
}

interface TeamProfile {
  rosterId: number | string;
  mode: string;
  posture: string;
  needs: string[];
  totalValue: number;
}

interface RerankRequestBody {
  userTeam?: string;
  partners?: string[];
  offers?: Offer[];
  teamProfiles?: Record<string, TeamProfile>;
}

interface RerankResult {
  offers: Offer[];
  source: "llm" | "deterministic";
}

/* ------------------------------------------------------------------ */
/*  Deterministic fallback                                             */
/* ------------------------------------------------------------------ */

const templateExplanation = (offer: Offer): string => {
  const sendFocus =
    offer.send.find((a) => a.type === "player")?.label ?? "picks";
  const receiveFocus =
    offer.receive.find((a) => a.type === "player")?.label ?? "picks";
  return `You send ${sendFocus} and receive ${receiveFocus}. ${offer.fairness} trade that addresses roster needs for both sides.`;
};

const deterministicRerank = (offers: Offer[]): RerankResult => {
  const ranked = [...offers].sort((a, b) => {
    const ratioA = a.valueReceived / Math.max(a.valueSent, 1);
    const ratioB = b.valueReceived / Math.max(b.valueSent, 1);
    const fairnessOrder: Record<string, number> = {
      Fair: 0,
      "Slight Underpay": 1,
      "Slight Overpay": 2,
      Underpay: 3,
      Overpay: 4,
    };
    const fa = fairnessOrder[a.fairness] ?? 5;
    const fb = fairnessOrder[b.fairness] ?? 5;
    if (fa !== fb) return fa - fb;
    return ratioB - ratioA;
  });

  return {
    offers: ranked.map((o) => ({
      ...o,
      explanation: templateExplanation(o),
    })),
    source: "deterministic",
  };
};

/* ------------------------------------------------------------------ */
/*  LLM rerank via OpenAI                                              */
/* ------------------------------------------------------------------ */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 2048;

const buildPrompt = (body: RerankRequestBody): string => {
  const offersJson = JSON.stringify(
    (body.offers ?? []).map((o) => ({
      id: o.id,
      partner: o.partner,
      sendLabels: o.send.map((a) => a.label),
      receiveLabels: o.receive.map((a) => a.label),
      valueSent: o.valueSent,
      valueReceived: o.valueReceived,
      fairness: o.fairness,
      tags: o.tags,
    })),
  );

  return [
    "You are an ESPN-style fantasy football trade analyst.",
    "Given these trade offers, rerank them from best to worst for the user.",
    "For each offer, write a 1–2 bullet explanation: why it fits both teams, and one suggested counter idea.",
    "",
    `User team: ${body.userTeam ?? "Unknown"}`,
    `Offers: ${offersJson}`,
    "",
    "Respond with ONLY valid JSON in this exact schema (no markdown, no extra text):",
    '{ "ranked": [ { "id": "<offer id>", "explanation": "<your 1-2 bullet explanation>" } ] }',
  ].join("\n");
};

interface LLMRankedItem {
  id?: string;
  explanation?: string;
}

const isValidLLMResponse = (
  parsed: unknown,
): parsed is { ranked: LLMRankedItem[] } => {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj.ranked);
};

const callOpenAI = async (
  body: RerankRequestBody,
  apiKey: string,
): Promise<RerankResult | null> => {
  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        messages: [{ role: "user", content: buildPrompt(body) }],
      }),
    });

    if (!response.ok) return null;

    const json = await response.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed: unknown = JSON.parse(content);
    if (!isValidLLMResponse(parsed)) return null;

    const offerMap = new Map((body.offers ?? []).map((o) => [o.id, o]));
    const reordered: Offer[] = [];

    for (const item of parsed.ranked) {
      const offer = item.id ? offerMap.get(item.id) : undefined;
      if (!offer) continue;
      reordered.push({
        ...offer,
        explanation:
          typeof item.explanation === "string" && item.explanation.length > 0
            ? item.explanation
            : offer.explanation,
      });
      offerMap.delete(offer.id);
    }

    // Append any offers not mentioned by the LLM.
    for (const remaining of offerMap.values()) {
      reordered.push(remaining);
    }

    return { offers: reordered, source: "llm" };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  let body: RerankRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const offers = body.offers;
  if (!Array.isArray(offers) || offers.length === 0) {
    return NextResponse.json(
      { error: "No offers provided" },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const result = deterministicRerank(offers);
    return NextResponse.json(result);
  }

  const llmResult = await callOpenAI(body, apiKey);

  if (llmResult) {
    return NextResponse.json(llmResult);
  }

  // Fallback to deterministic if LLM call failed or returned invalid JSON.
  const fallback = deterministicRerank(offers);
  return NextResponse.json(fallback);
}
