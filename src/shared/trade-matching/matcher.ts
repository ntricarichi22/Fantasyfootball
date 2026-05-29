import type { LeagueData, PlayerInfo } from "@/shared/league-data";
import type { NeedBucket } from "@/shared/team-profiles";
import {
  bucketOf,
  sellMarketBuckets,
  buyMarketBuckets,
} from "@/shared/team-profiles";
import type { Window } from "@/shared/team-dossier";
import { isYoung } from "@/shared/asset-values";
import {
  ARCHETYPE_OPPOSITES,
  ARCHETYPE_ROLE,
  type NarrativeBundle,
  type FiredNarrative,
} from "@/shared/team-narratives";

import type {
  AnchorBucket,
  CurrencyMatch,
  Match,
  MatchInput,
  RankReasons,
  TeamSlate,
  WindowComplement,
} from "./types";

// Below this many narrative-driven (tier 1) matches, the value-fit floor opens
// up to backfill the slate. At or above it, the floor stays hidden.
const TIER2_THRESHOLD = 3;

// ── small read helpers (no recomputation — straight reads off the layers) ──

function bucketKey(bucket: NeedBucket): "qb" | "rb" | "passCatcher" {
  return bucket === "QB" ? "qb" : bucket === "RB" ? "rb" : "passCatcher";
}

// FiredNarrative.assets carries player IDs and pick keys (not display names),
// so resolve players against the global id->PlayerInfo map. Anything not found
// there is a pick key (e.g. "pick:2027:1").
function resolvePlayer(data: LeagueData, asset: string): PlayerInfo | null {
  return data.players.get(asset) ?? null;
}

// The bucket of a headline piece. Players resolve through the shared
// position->bucket mapper; pick keys (and anything unresolvable) are "PICK".
function anchorBucketOf(data: LeagueData, asset: string): AnchorBucket | null {
  const info = resolvePlayer(data, asset);
  if (!info) return "PICK";
  return bucketOf(info.position);
}

// Human-readable label for an asset — the player's name, or the raw key.
function anchorLabel(data: LeagueData, asset: string): string {
  return resolvePlayer(data, asset)?.name ?? asset;
}

function scarcityBuckets(bundle: NarrativeBundle): Set<NeedBucket> {
  return new Set(bundle.rosterRead.scarcities.map((s) => s.bucket));
}

function surplusBuckets(bundle: NarrativeBundle): Set<NeedBucket> {
  return new Set(bundle.rosterRead.surpluses.map((s) => s.bucket));
}

function needScore(needs: MatchInput["needs"], rosterId: string, bucket: NeedBucket): number | null {
  const nd = needs.get(rosterId);
  return nd ? nd[bucketKey(bucket)].score : null;
}

// Contender <-> rebuilder is the clean pair. Same broad window gets the downbump.
function broadWindow(w: Window): "win" | "build" {
  return w === "contending" || w === "closing" ? "win" : "build";
}

function windowComplement(a: Window, b: Window): WindowComplement {
  return broadWindow(a) === broadWindow(b) ? "same_window" : "clean";
}

// Coarse read of what a partner can pay with — enough to rank, not to price.
// Strong = holds a future first; partial = holds any pick or a young body;
// weak = neither. Real pricing happens later in offer generation.
function currencyFor(data: LeagueData, rosterId: string): CurrencyMatch {
  const picks = data.pickOwnership.get(rosterId) ?? [];
  const hasFirst = picks.some((pk) => pk.round === 1);
  if (hasFirst) return "strong";
  const hasAnyPick = picks.length > 0;
  const roster = data.teams.find((t) => t.rosterId === rosterId);
  const hasYouth = !!roster && roster.players.some((p) => isYoung(p.position, p.age));
  return hasAnyPick || hasYouth ? "partial" : "weak";
}

const CURRENCY_RANK: Record<CurrencyMatch, number> = { strong: 2, partial: 1, weak: 0 };
const WINDOW_RANK: Record<WindowComplement, number> = { clean: 1, same_window: 0 };

// Order matches: need severity first (the desperate buyer leads), then
// currency, then window. All three stay visible on each match; this only
// decides the sequence.
function sortBySeverity(matches: Match[]): Match[] {
  return matches.slice().sort((x, y) => {
    const sx = x.reasons.needSeverity ?? -1;
    const sy = y.reasons.needSeverity ?? -1;
    if (sy !== sx) return sy - sx;
    const cx = CURRENCY_RANK[x.reasons.currencyMatch];
    const cy = CURRENCY_RANK[y.reasons.currencyMatch];
    if (cy !== cx) return cy - cx;
    return WINDOW_RANK[y.reasons.windowComplement] - WINDOW_RANK[x.reasons.windowComplement];
  });
}

// ── tier 1 — narrative-driven matching ────────────────────────────────────

// Our seller narrative ships an anchor. A partner qualifies if (a) they fire
// the opposite buyer archetype AND (b) they genuinely need the anchor's bucket.
function matchSellNarrative(
  active: NarrativeBundle,
  fired: FiredNarrative,
  input: MatchInput,
  windowByRoster: Map<string, Window>
): Match[] {
  const out: Match[] = [];
  const opposites = ARCHETYPE_OPPOSITES[fired.archetype];

  for (const asset of fired.assets) {
    const bk = anchorBucketOf(input.data, asset);
    // Pick anchors (e.g. trade-back) need pick-for-pick logic that lives in
    // offer generation, not here — skip them at the matching layer for now.
    if (bk === null || bk === "PICK") continue;
    const label = anchorLabel(input.data, asset);

    for (const [partnerId, partnerBundle] of input.bundles) {
      if (partnerId === active.rosterId) continue;

      const partnerBuyers = partnerBundle.firedNarratives.filter(
        (fn) => opposites.includes(fn.archetype) && ARCHETYPE_ROLE[fn.archetype] === "buyer"
      );
      if (partnerBuyers.length === 0) continue; // hard gate: opposite buyer archetype must actually fire

      // They must want this position: a real scarcity at the bucket, OR a buyer
      // narrative explicitly shopping it (insurance stamps QB even though a
      // depth/fragility need is not a listed scarcity).
      const wantsBucket =
        scarcityBuckets(partnerBundle).has(bk) || partnerBuyers.some((fn) => fn.targetBucket === bk);
      if (!wantsBucket) continue;

      // Prefer the buyer narrative explicitly shopping this bucket.
      const partnerOpp = partnerBuyers.find((fn) => fn.targetBucket === bk) ?? partnerBuyers[0];

      const sev = needScore(input.needs, partnerId, bk);
      const cur = currencyFor(input.data, partnerId);
      const win = windowComplement(
        windowByRoster.get(active.rosterId)!,
        windowByRoster.get(partnerId)!
      );

      const reasons: RankReasons = { needSeverity: sev, currencyMatch: cur, windowComplement: win };
      out.push({
        tier: 1,
        side: "we_sell",
        narrativeArchetype: fired.archetype,
        narrativeFlavor: fired.flavor,
        anchor: label,
        anchorBucket: bk,
        partnerRosterId: partnerId,
        partnerTeam: partnerBundle.teamName,
        partnerArchetype: partnerOpp.archetype,
        reasons,
        why: `${partnerBundle.teamName} needs ${bk} (${sev ?? "?"}) and fires ${partnerOpp.archetype}; currency ${cur}, window ${win}.`,
      });
    }
  }

  return sortBySeverity(out);
}

// Our buyer narrative shops at our scarcity buckets. A partner qualifies if
// they fire an opposite seller archetype AND are shipping a piece at one of
// those buckets. Ranked by the piece's value (best fit on top) since the
// desperation here is ours and doesn't separate partners.
function matchBuyNarrative(
  active: NarrativeBundle,
  fired: FiredNarrative,
  input: MatchInput,
  windowByRoster: Map<string, Window>
): Match[] {
  const out: Array<{ match: Match; value: number }> = [];
  const opposites = ARCHETYPE_OPPOSITES[fired.archetype];
  // A buyer narrative shops at its stamped target bucket when it has one
  // (insurance -> QB); otherwise it shops at our roster scarcities.
  const targets = fired.targetBucket ? new Set<NeedBucket>([fired.targetBucket]) : scarcityBuckets(active);

  for (const [partnerId, partnerBundle] of input.bundles) {
    if (partnerId === active.rosterId) continue;

    for (const fn of partnerBundle.firedNarratives) {
      if (!opposites.includes(fn.archetype) || ARCHETYPE_ROLE[fn.archetype] !== "seller") continue;

      for (const asset of fn.assets) {
        const bk = anchorBucketOf(input.data, asset);
        if (bk === null || bk === "PICK" || !targets.has(bk)) continue;

        const info = resolvePlayer(input.data, asset);
        const value = info ? input.data.values.value.get(info.id) ?? 0 : 0;
        const cur = currencyFor(input.data, partnerId);
        const win = windowComplement(
          windowByRoster.get(active.rosterId)!,
          windowByRoster.get(partnerId)!
        );

        out.push({
          value,
          match: {
            tier: 1,
            side: "we_buy",
            narrativeArchetype: fired.archetype,
            narrativeFlavor: fired.flavor,
            anchor: anchorLabel(input.data, asset),
            anchorBucket: bk,
            partnerRosterId: partnerId,
            partnerTeam: partnerBundle.teamName,
            partnerArchetype: fn.archetype,
            // needSeverity null on buy-side; we rank by piece value instead.
            reasons: { needSeverity: null, currencyMatch: cur, windowComplement: win },
            why: `${partnerBundle.teamName} is shipping ${anchorLabel(input.data, asset)} (${bk}, val ${value}) via ${fn.archetype} — fills our ${bk} hole.`,
          },
        });
      }
    }
  }

  // Buy-side: order by the headline piece's value (best stud first).
  return out.sort((a, b) => b.value - a.value).map((o) => o.match);
}

// ── tier 2 — the value-fit floor (symmetric stated-market rule) ────────────
//
// A stated SELL at a position matches a partner who has stated BUY there OR a
// genuine need there. A stated BUY at a position matches a partner who has
// stated SELL there OR a genuine surplus there. Only built when tier 1 is thin.

function buildFloor(
  active: NarrativeBundle,
  input: MatchInput,
  windowByRoster: Map<string, Window>
): Match[] {
  const out: Match[] = [];
  const strat = input.data.strategy.get(active.rosterId) ?? null;
  const ourSells = sellMarketBuckets(strat);
  const ourBuys = buyMarketBuckets(strat);

  for (const [partnerId, partnerBundle] of input.bundles) {
    if (partnerId === active.rosterId) continue;
    const pStrat = input.data.strategy.get(partnerId) ?? null;
    const pBuys = new Set(buyMarketBuckets(pStrat));
    const pSells = new Set(sellMarketBuckets(pStrat));
    const pNeeds = scarcityBuckets(partnerBundle);
    const pSurplus = surplusBuckets(partnerBundle);
    const win = windowComplement(windowByRoster.get(active.rosterId)!, windowByRoster.get(partnerId)!);

    // Our stated sells -> partner buys there OR needs there.
    for (const bk of ourSells) {
      if (!(pBuys.has(bk) || pNeeds.has(bk))) continue;
      const sev = needScore(input.needs, partnerId, bk);
      const reason = pBuys.has(bk) ? "stated buy" : `need ${sev ?? "?"}`;
      out.push(
        floorMatch("we_sell", bk, partnerId, partnerBundle.teamName, sev, currencyFor(input.data, partnerId), win,
          `We're shopping ${bk}; ${partnerBundle.teamName} has a ${reason} there.`)
      );
    }
    // Our stated buys -> partner sells there OR has surplus there.
    for (const bk of ourBuys) {
      if (!(pSells.has(bk) || pSurplus.has(bk))) continue;
      const reason = pSells.has(bk) ? "stated sell" : "surplus";
      out.push(
        floorMatch("we_buy", bk, partnerId, partnerBundle.teamName, null, currencyFor(input.data, partnerId), win,
          `We want ${bk}; ${partnerBundle.teamName} has a ${reason} there.`)
      );
    }
  }

  return sortBySeverity(out);
}

function floorMatch(
  side: Match["side"],
  bk: NeedBucket,
  partnerId: string,
  partnerTeam: string,
  sev: number | null,
  cur: CurrencyMatch,
  win: WindowComplement,
  why: string
): Match {
  return {
    tier: 2,
    side,
    narrativeArchetype: "stand_pat", // floor isn't driven by one of our narratives
    narrativeFlavor: null,
    anchor: `(${bk} — value-fit)`,
    anchorBucket: bk,
    partnerRosterId: partnerId,
    partnerTeam,
    partnerArchetype: null,
    reasons: { needSeverity: sev, currencyMatch: cur, windowComplement: win },
    why,
  };
}

// ── public entry ───────────────────────────────────────────────────────────

export function buildMatchSlates(input: MatchInput): Map<string, TeamSlate> {
  const windowByRoster = new Map<string, Window>();
  for (const d of input.dossiers) windowByRoster.set(d.rosterId, d.window);

  const slates = new Map<string, TeamSlate>();

  for (const [rosterId, active] of input.bundles) {
    const tier1: Match[] = [];

    for (const fired of active.firedNarratives) {
      const role = ARCHETYPE_ROLE[fired.archetype];
      if (role === "null_action") continue; // stand-pat produces no offers

      if (role === "seller") {
        tier1.push(...matchSellNarrative(active, fired, input, windowByRoster));
      } else {
        tier1.push(...matchBuyNarrative(active, fired, input, windowByRoster));
      }
    }

    const tier2 = tier1.length < TIER2_THRESHOLD ? buildFloor(active, input, windowByRoster) : [];

    slates.set(rosterId, {
      rosterId,
      team: active.teamName,
      tier1Count: tier1.length,
      tier1,
      tier2,
    });
  }

  return slates;
}