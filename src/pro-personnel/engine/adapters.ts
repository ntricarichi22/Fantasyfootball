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

export function studioRequest(
  ourTeamId: string,
  shopKeys: string[],
  opts?: { counterpartyTeamIds?: string[] },
): DealRequest {
  return {
    ourTeamId,
    offeringTeamId: ourTeamId, // constructor flips this to each partner (aim=partner)
    intent: "shop",
    anchors: shopKeys.map((key): Anchor => ({ key, side: "send" })),
    counterparty: counterpartyFrom(opts?.counterpartyTeamIds),
    leans: [],
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