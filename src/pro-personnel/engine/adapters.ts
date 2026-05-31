// src/pro-personnel/engine/adapters.ts
//
// The three doors. Each is a thin translator: take what a UI surface knows and
// emit a DealRequest the one constructor understands. No deal logic lives here
// — adapters only decide WHAT to feed the front door (anchors, intent, aim,
// counterparty, leans). The constructor does the building.
//
//   Studio   — anchor = our shop list on SEND; aim at the PARTNER ("what can I
//              get for these guys"). Each candidate partner shapes their own
//              offer inside the constructor.
//   Builder  — intent acquire, aim at US. No fixed anchor: the constructor
//              discovers the partner targets that fill our needs and crack our
//              lineup, then builds the best deal for us around each.
//   Scouting — pick-centric, directed door: our pick(s) anchored on SEND, an
//              intent (shop / trade_up / trade_back), optional counterparty
//              lock, an optional required partner pick (the two-anchor case),
//              and soft return leans.

import type { Anchor, Counterparty, DealRequest, Intent, Lean } from "./types";

function counterpartyFrom(teamIds?: string[]): Counterparty {
  return teamIds && teamIds.length > 0 ? { mode: "locked", teamIds } : { mode: "open" };
}

// ─── Studio ──────────────────────────────────────────────────────────────────

// One asset on the shop list, already resolved to the facts inference needs.
// The route resolves these from shared data (value, stud flag, youth flag,
// type) so this helper stays pure and engine-only — no DB, no data dict.
export type ShopListItem = {
  key: string;
  type: "player" | "pick";
  value: number;
  isStud: boolean;
  isYoung: boolean;
};

// What the user puts on the block IS the narrative — infer it from the shape
// of the shop list, using the SAME leans the auto door fires from the roster.
// There the engine decides what we should do; here the user has told us by
// their selection. Output feeds the one constructor, so both doors converge.
//
//   • A single stud, alone                 → selling high / reset → prefer_picks
//     (return future capital + youth, never another win-now stud).
//   • A single prime non-stud vet, and we're a CONTENDER → vet-liquidation
//     → prefer_picks (convert a win-now piece into future capital).
//   • Anything else (multiple pieces, a starter + a pick, plain depth)
//     → consolidation / lateral → no lean; the constructor balances toward the
//       best single return on its own.
//
// We never infer "insurance" here: insurance is a BUY storyline (acquiring a
// backup), but a Studio shop list is always assets we are SENDING.
export function inferShopListLeans(
  items: ShopListItem[],
  ourTier: string | null,
): { leans: Lean[] } {
  const players = items.filter((i) => i.type === "player");

  // Single stud on the block → reset / sell-high: bias the return to picks
  // (prefer_picks in the constructor means picks + non-stud youth).
  if (players.length === 1 && players[0].isStud) {
    return { leans: ["prefer_picks"] };
  }

  // A lone prime vet (not a stud, not a kid) shopped by a contender reads as
  // vet-liquidation: convert a win-now piece into future capital. Contender =
  // the top two tiers (championship | playoff).
  const contender = ourTier === "championship" || ourTier === "playoff";
  if (
    players.length === 1 &&
    !players[0].isStud &&
    !players[0].isYoung &&
    contender
  ) {
    return { leans: ["prefer_picks"] };
  }

  // Everything else — multiple pieces, starter + pick, plain depth — is a
  // consolidation or lateral move. No lean: the constructor finds the best
  // single return that balances, which is what consolidating wants.
  return { leans: [] };
}

export function studioRequest(
  ourTeamId: string,
  shopKeys: string[],
  opts?: { counterpartyTeamIds?: string[]; leans?: Lean[] },
): DealRequest {
  return {
    ourTeamId,
    offeringTeamId: ourTeamId, // constructor flips this to each partner (aim=partner)
    intent: "shop",
    anchors: shopKeys.map((key): Anchor => ({ key, side: "send" })),
    counterparty: counterpartyFrom(opts?.counterpartyTeamIds),
    leans: opts?.leans ?? [],
    aimAt: "partner",
  };
}

// ─── Builder ───────────────────────────────────────────────────────────────────

export function builderRequest(
  ourTeamId: string,
  opts?: { counterpartyTeamIds?: string[]; leans?: Lean[] },
): DealRequest {
  return {
    ourTeamId,
    offeringTeamId: ourTeamId,
    intent: "acquire",
    anchors: [], // no fixed target → constructor discovers needs-filling targets
    counterparty: counterpartyFrom(opts?.counterpartyTeamIds),
    leans: opts?.leans ?? [],
    aimAt: "us",
  };
}

// Builder with a SPECIFIC target the user picked (acquire that exact player).
export function builderRequestForTarget(
  ourTeamId: string,
  targetKey: string,
  opts?: { counterpartyTeamIds?: string[]; leans?: Lean[] },
): DealRequest {
  return {
    ourTeamId,
    offeringTeamId: ourTeamId,
    intent: "acquire",
    anchors: [{ key: targetKey, side: "receive" }],
    counterparty: counterpartyFrom(opts?.counterpartyTeamIds),
    leans: opts?.leans ?? [],
    aimAt: "us",
  };
}

// ─── Scouting ──────────────────────────────────────────────────────────────────

export function scoutingRequest(
  ourTeamId: string,
  args: {
    pickKeys: string[];
    intent: Intent; // "shop" | "trade_up" | "trade_back"
    counterpartyTeamIds?: string[];
    requiredCounterpartyKeys?: string[];
    leans?: Lean[];
  },
): DealRequest {
  return {
    ourTeamId,
    offeringTeamId: ourTeamId,
    intent: args.intent,
    anchors: args.pickKeys.map((key): Anchor => ({ key, side: "send" })),
    counterparty: counterpartyFrom(args.counterpartyTeamIds),
    requiredCounterpartyKeys: args.requiredCounterpartyKeys,
    leans: args.leans ?? [],
    aimAt: "us",
  };
}