// src/pro-personnel/engine/construct.ts
//
// THE front door. Every door (Studio, Builder, Scouting) funnels through one
// deal-constructor: given a partner set and the anchors an adapter locked in,
// build the rest of the deal until it's fair on the scoreboard the door aims
// at and would plausibly be signed. The constructor owns all the new/risky
// reasoning; the salvaged brains (shapes, balance, gap math) stay simple and
// get fed from here.
//
// The pipeline, per (partner, candidate target):
//   1. seed the anchors the adapter locked to each side
//   2. build fill pools in the AIM lens (aim=us → our values, aim=partner →
//      partner values) so balance closes on the right scoreboard
//   3. balance to the offering persona's opening ratio, then apply that
//      persona's finishing sweetener (shapes)
//   4. price BOTH real scoreboards (pricing) — never the aim-lens shortcut
//   5. grade our chip (personaAwareGrade) + read the partner (their band,
//      empirical override when we have their history)
//   6. demand gate (the one hard gate) + soft friction (untouchable / picks)
//   7. post-trade safety: don't crater our starting lineup (computeStrength)
//   8. score: surplus↔need fit + VOR + aim-board cleanliness + partner
//      motivation + complementarity − friction
//   9. slate: best-per-partner + per-position caps + reserved blind-spot slots
//
// The engine touches ZERO database — the route loads all shared inputs and the
// ValuationContext and hands them in via EngineContext.

import type { LeagueData, StrategyProfile, RosteredTeam, PlayerInfo, OwnedPick, Position } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedLevel } from "@/shared/team-profiles";
import { computeStrength, bucketOf, buildScrubSets } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
import type { NarrativeBundle } from "@/shared/team-narratives";
import { startsForAtLeast } from "@/shared/team-narratives";
import { valueAsset, isYoung, type AssetRef, type ValuationContext } from "@/shared/asset-values";

import type {
  DealRequest,
  EngineOffer,
  EngineOfferAsset,
  EngineSlate,
  Bucket,
  Side,
  AimAt,
  PartnerRead,
  PersonaKey,
} from "./types";
import { normalizePersona, bandFor, type PersonaBand } from "./core/personas";
import { personaAwareGrade } from "./core/gap";
import type { Gap } from "./core/types";
import { priceDeal, type PricingInput } from "./pricing";
import { bucketForPosition, wantsToAcquire, isUntouchable, shippingPickIsFriction, isBlindSpot } from "./gates";
import { shapeKnobsFor } from "./shapes";
import { balanceDeal, type ValuedAsset } from "./balance";
// ─── The input bundle the route assembles (engine never hits the DB) ─────────

export type EngineContext = {
  data: LeagueData;
  profiles: TeamProfile[];
  dossiers: TeamDossier[];
  needs: Map<string, TeamNeeds>;
  ctx: ValuationContext;
  // The brain's per-team NarrativeBundle, keyed by rosterId. The constructor
  // reads rosterRead (surpluses, buried young) from here rather than recomputing
  // — single source. Optional so non-narrative callers (Studio/Builder/Scouting
  // doors) still work without it.
  bundles?: Map<string, NarrativeBundle>;
  // Optional per-team empirical accept band (>= 5 accepted trades on file).
  // When present for a team it overrides the persona fallback band.
  empiricalBands?: Map<string, PersonaBand>;
};

// ─── Tunables (calibrate against live output after wiring) ────────────────────

const SAFETY_DROP = 0.12; // post-trade starter value may fall at most this fraction
const MAX_TARGETS_PER_PARTNER = 4; // acquire: candidate targets tried per partner
const MAX_OFFERS_PER_PARTNER = 2; // how many surfaced offers one partner may hold
const SLATE_MAX = 12; // hard ceiling on offers returned
const PER_POSITION_CAP = 3; // at most this many offers anchored on one bucket
const BLIND_SPOT_SLOTS = 2; // reserved "fix the hole they say they don't have" slots

// Partner stretch (LOCKED). We surface a deal even when the partner would balk,
// as long as it isn't fantasy for them. "Stretch" = how far BELOW their band
// floor we'll still float it — a flat 0.10, which auto-differentiates by
// persona since the band floors already differ (Closer 0.85→0.75, SS/Architect
// 0.90→0.80, Hustler 1.00→0.90). HARD_FLOOR is the universal non-starter line:
// nobody, no matter how loose their (possibly empirical) band, gets a deal
// floated below it.
const PARTNER_STRETCH = 0.1;
const HARD_FLOOR = 0.75;

// Ranking weights.
const W_FIT = 3.0;
const W_VOR = 2.5;
const W_AIM = 1.5;
const W_LIKELY = 2.0; // deals the partner would take outright float above stretches
const W_PARTNERFIT = 1.0; // natural counterparties (window + need mirroring) rank up
const W_PREMIUM = 1.0; // desperation-premium deals (selling into a thin contender) rank up
const W_MOTIVATION = 1.0;
const W_COMPLEMENT = 0.75;
const W_FRICTION = 1.5;

// ─── Small helpers ────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function toRef(key: string, type: "player" | "pick"): AssetRef {
  return type === "pick" ? { type: "pick", key } : { type: "player", sleeperPlayerId: key };
}

// Bucket → the player positions that fill it (PASS_CATCHER = WR + TE). Inverse
// of bucketForPosition, used for same-bucket backfill discovery.
function bucketPositions(bucket: Bucket): Set<string> {
  if (bucket === "QB") return new Set(["QB"]);
  if (bucket === "RB") return new Set(["RB"]);
  if (bucket === "PASS_CATCHER") return new Set(["WR", "TE"]);
  return new Set();
}

function needLevel(needs: TeamNeeds | undefined, bucket: Bucket): NeedLevel | null {
  if (!needs) return null;
  if (bucket === "QB") return needs.qb.level;
  if (bucket === "RB") return needs.rb.level;
  if (bucket === "PASS_CATCHER") return needs.passCatcher.level;
  return null;
}

function needScore(level: NeedLevel | null): number {
  return level === "high" ? 2 : level === "med" ? 1 : 0;
}

// ─── Inline ranking reads (formerly engine/thesis, now killed) ────────────────
// These are pure roster-truth ranking signals — they make NO direction call and
// do NOT compete with the brain's storyline thesis. They only ORDER the offers
// the constructor surfaces: how badly we need a bucket, and how natural a
// counterparty a partner is. Stripped of the old posture/wantsMore/archetype
// baggage that used to ride along in the thesis folder.

const NEED_BUCKETS: Bucket[] = ["QB", "RB", "PASS_CATCHER"];
const WIN_NOW_WINDOWS = new Set(["contending", "closing"]);

// Our relative-need severity (0..1) at a bucket — the ranking weight on a
// received piece. Was thesis.buy[].severity; it's just the need score.
function needSeverity(needs: TeamNeeds | undefined, bucket: Bucket): number {
  if (!needs) return 0;
  if (bucket === "QB") return needs.qb.score;
  if (bucket === "RB") return needs.rb.score;
  if (bucket === "PASS_CATCHER") return needs.passCatcher.score;
  return 0;
}

// How natural a counterparty this partner is for us: a win-now window buys what
// others sell, and need/surplus mirroring (thin where we're deep, deep where
// we're thin) makes a clean swap. Was buildPartnerFit.fitScore.
function partnerFitScore(
  partnerWindow: string,
  partnerNeeds: TeamNeeds | null,
  ourNeeds: TeamNeeds | undefined,
): number {
  let s = 0;
  if (WIN_NOW_WINDOWS.has(partnerWindow)) s += 1.5;
  for (const b of NEED_BUCKETS) {
    const theirs = partnerNeeds ? needSeverity(partnerNeeds, b) : null;
    const ours = ourNeeds ? needSeverity(ourNeeds, b) : null;
    if (theirs === null || ours === null) continue;
    if (theirs >= 0.6 && ours <= 0.4) s += 1; // we sell into their thin spot
    if (theirs <= 0.4 && ours >= 0.6) s += 1; // we buy from their surplus
  }
  return s;
}

// Desperation premium: a win-now partner who is genuinely THIN at a bucket we're
// selling will pay above flat value. Was buildPartnerFit.premiumFires. (The old
// "not if accumulate-posture" guard is dropped — it read the retired wantsMore.)
function premiumFiresFor(
  bucket: Bucket,
  partnerWindow: string,
  partnerNeeds: TeamNeeds | null,
): boolean {
  if (!WIN_NOW_WINDOWS.has(partnerWindow)) return false;
  return needLevel(partnerNeeds ?? undefined, bucket) === "high";
}

function marketFor(strat: StrategyProfile | undefined, bucket: Bucket): string {
  if (!strat) return "unknown";
  if (bucket === "QB") return strat.qbMarket;
  if (bucket === "RB") return strat.rbMarket;
  if (bucket === "PASS_CATCHER") return strat.pcMarket;
  return strat.picksMarket;
}

// A resolved asset — players and picks both reduce to this for construction.
type Resolved = {
  key: string;
  name: string;
  type: "player" | "pick";
  position: string;
  bucket: Bucket;
  isStud: boolean;
  ownerTeamId: string;
  pick?: OwnedPick;
};

// ─── The constructor ───────────────────────────────────────────────────────────

export function construct(req: DealRequest, ec: EngineContext): EngineSlate {
  const { data, ctx } = ec;
  const ourTeamId = req.ourTeamId;

  // Index everything once.
  const dossierById = new Map(ec.dossiers.map((d) => [d.rosterId, d]));
  const teamById = new Map(data.teams.map((t) => [t.rosterId, t]));
  const playerOwner = new Map<string, string>();
  for (const t of data.teams) for (const id of t.playerIds) playerOwner.set(id, t.rosterId);
  const pickByKey = new Map<string, OwnedPick>();
  for (const picks of data.pickOwnership.values()) for (const p of picks) pickByKey.set(p.key, p);

  const ourTeam = teamById.get(ourTeamId);
  if (!ourTeam) {
    return { generatedAt: new Date().toISOString(), offers: [], reason: "no_clean_offers" };
  }
  const ourStrategy = data.strategy.get(ourTeamId);
  const ourNeeds = ec.needs.get(ourTeamId);
  const ourDossier = dossierById.get(ourTeamId) ?? null;
  const ourPersona = normalizePersona(ourDossier?.persona);
  const ourAttachment = (data.attachments.get(ourTeamId) ?? null) as Map<string, string> | null;
  const rosterPositions = data.settings.rosterPositions;
  const ourBaseStarter = computeStrength(ourTeam, data.values, rosterPositions).starterValue;

  // Which of our picks are protected (war chest). The thesis fence
  // (req.spendable) is authoritative: a pick is protected iff it's not in the
  // spendable set — so the win-now story can spend the future 1sts the build
  // holds sacred. Our offers pipeline always passes a fence; a fence-less caller
  // (a raw door with no storyline) protects nothing extra here and relies on its
  // own anchors. Protected picks stay out of the send filler pool (still allowed
  // as anchors).
  const ourPicks = data.pickOwnership.get(ourTeamId) ?? [];
  const protectedPickKeys = new Set<string>(
    req.spendable
      ? ourPicks.filter((p) => !req.spendable!.has(p.key)).map((p) => p.key)
      : [],
  );

  // Scrub guard: a player ranked beyond his position's startable depth by league
  // value (a QB outside the top 35, an RB outside the top 40, a pass-catcher
  // outside the top 75) is a dead-weight body with no trade market. We keep such
  // players OUT of the auto-balancer fill pool, so a gap closes with a pick (a
  // late 2nd / 3rd) or a real piece, never a worthless makeweight. They stay
  // usable as an explicit ANCHOR (a deliberate "cash this guy" move), just never
  // as silent filler.
  const scrubSets = buildScrubSets(data);
  const isScrub = (key: string): boolean => {
    const p = data.players.get(key);
    if (!p) return false;
    const b = bucketOf(p.position);
    return b ? scrubSets.get(b)?.has(key) ?? false : false;
  };

  // Resolve any asset key to its facts.
  function resolve(key: string): Resolved | null {
    const p = data.players.get(key);
    if (p) {
      const bucket = bucketForPosition(p.position);
      return {
        key,
        name: p.name,
        type: "player",
        position: p.position,
        bucket,
        isStud: data.values.isStud.get(key) ?? false,
        ownerTeamId: playerOwner.get(key) ?? "",
      };
    }
    const pk = pickByKey.get(key);
    if (pk) {
      return {
        key,
        name: `${pk.season} ${ordinal(pk.round)}`,
        type: "pick",
        position: "PICK",
        bucket: "PICK",
        isStud: false,
        ownerTeamId: pk.currentRosterId,
        pick: pk,
      };
    }
    return null;
  }

  // Value of an asset under the AIM lens, given which side it sits on.
  function aimValue(r: Resolved, side: Side, aim: AimAt, partnerId: string): number {
    const ref = toRef(r.key, r.type);
    const ours = side === "send";
    if (aim === "us") {
      return ours ? valueAsset(ref, ctx, { perspective: ourTeamId }) : valueAsset(ref, ctx);
    }
    return ours ? valueAsset(ref, ctx) : valueAsset(ref, ctx, { perspective: partnerId });
  }

  function valued(r: Resolved, side: Side, aim: AimAt, partnerId: string): ValuedAsset {
    return { key: r.key, name: r.name, type: r.type, value: aimValue(r, side, aim, partnerId) };
  }

  // Effective accept band: empirical override if we have it, else persona.
  function effectiveBand(teamId: string, persona: PersonaKey): PersonaBand {
    return ec.empiricalBands?.get(teamId) ?? bandFor(persona);
  }

  // Partner read against THEIR band, locked tiers:
  //   likely        — their ratio is at/above their floor (in comfort, or
  //                    winning — both are a yes).
  //   needs_selling  — within the 0.10 stretch below their floor: they'll
  //                    likely balk, but it's a real ask worth floating.
  //   long_shot      — past the stretch (or below the universal hard floor):
  //                    fantasy for them; the constructor filters these out.
  function stretchFloorFor(band: PersonaBand): number {
    return Math.max(HARD_FLOOR, band.min - PARTNER_STRETCH);
  }

  function readFor(ratio: number, band: PersonaBand): PartnerRead {
    if (ratio >= band.min) return "likely";
    if (ratio >= stretchFloorFor(band)) return "needs_selling";
    return "long_shot";
  }
  const inBand = (ratio: number, band: PersonaBand) => ratio >= band.min && ratio <= band.max;

  // Post-trade: does our starting lineup survive? Picks don't touch the lineup.
  function survivesSafety(sendKeys: string[], receiveKeys: string[]): boolean {
    const sent = new Set(sendKeys.filter((k) => data.players.has(k)));
    const gained: PlayerInfo[] = receiveKeys
      .map((k) => data.players.get(k))
      .filter((p): p is PlayerInfo => !!p);
    if (sent.size === 0 && gained.length === 0) return true;
    const players = ourTeam!.players.filter((p) => !sent.has(p.id)).concat(gained);
    const after: RosteredTeam = { ...ourTeam!, players };
    const afterStarter = computeStrength(after, data.values, rosterPositions).starterValue;
    return afterStarter >= ourBaseStarter * (1 - SAFETY_DROP);
  }

  // Marginal starter-value gain to us from the received players (VOR).
  function vorOfReceive(receiveKeys: string[]): number {
    const gained: PlayerInfo[] = receiveKeys
      .map((k) => data.players.get(k))
      .filter((p): p is PlayerInfo => !!p);
    if (gained.length === 0) return 0;
    const players = ourTeam!.players.concat(gained);
    const after: RosteredTeam = { ...ourTeam!, players };
    const afterStarter = computeStrength(after, data.values, rosterPositions).starterValue;
    return Math.max(0, afterStarter - ourBaseStarter);
  }

  const gapFrom = (sb: { sendValue: number; receiveValue: number; ratio: number; verdict: Gap["verdict"] }): Gap => ({
    sendValue: sb.sendValue,
    receiveValue: sb.receiveValue,
    ratio: sb.ratio,
    delta: sb.receiveValue - sb.sendValue,
    verdict: sb.verdict,
    hasSend: sb.sendValue > 0,
    hasReceive: sb.receiveValue > 0,
  });

  // Eligible partners.
  const eligible: string[] =
    req.counterparty.mode === "locked"
      ? req.counterparty.teamIds
      : data.teams.map((t) => t.rosterId).filter((id) => id !== ourTeamId);

  // Anchors split by side (resolved).
  const sendAnchors = req.anchors.filter((a) => a.side === "send").map((a) => a.key);
  const receiveAnchorsBase = req.anchors.filter((a) => a.side === "receive").map((a) => a.key);
  const requiredKeys = req.requiredCounterpartyKeys ?? [];

  const offers: EngineOffer[] = [];

  for (const partnerId of eligible) {
    const partnerTeam = teamById.get(partnerId);
    if (!partnerTeam) continue;
    const partnerDossier = dossierById.get(partnerId) ?? null;
    const partnerStrategy = data.strategy.get(partnerId);
    const partnerPersona = normalizePersona(partnerDossier?.persona);
    const partnerNeeds = ec.needs.get(partnerId) ?? null;
    const partnerWindow = partnerDossier?.window ?? "unknown";

    // Partner-fit: how natural a counterparty this is (window complementarity +
    // need/surplus mirroring) — a pure ranking read, no direction call.
    const fitScore = partnerFitScore(partnerWindow, partnerNeeds, ourNeeds);

    // In open acquire mode, skip clearly poor-fit partners (same window, no
    // need-mirroring) so we call the right teams instead of everyone. Locked
    // counterparties (our offers pipeline, Studio/Scouting targets) are always
    // honored.
    if (req.counterparty.mode === "open" && req.intent === "acquire" && fitScore <= 0) {
      continue;
    }

    // Offering persona = whoever shapes the offer. Studio (aim=partner) → the
    // partner shapes their own offer; otherwise it's us.
    const offeringPersona = req.aimAt === "partner" ? partnerPersona : ourPersona;
    const knobs = shapeKnobsFor(offeringPersona);

    // Required partner picks are forced receive anchors (trade-up slot, etc.).
    const receiveAnchors = [...receiveAnchorsBase, ...requiredKeys];

    // Candidate targets: for an "acquire" door with no fixed receive anchor,
    // discover what we'd realistically chase from this partner. VOR is a
    // RANKER here, never a gate (locked decision) — we consider every asset at
    // a position we have demand for, plus blind-spot positions we objectively
    // need despite a stated set/sell, and rank best-fit first.
    let targetSets: string[][];
    if (req.intent === "acquire" && receiveAnchors.length === 0) {
      // Players we'd take: demand-gated OR a glaring blind spot. Ranked by
      // lineup impact (VOR), then raw value — but not filtered on either.
      const playerCands = partnerTeam.playerIds
        .map((k) => resolve(k))
        .filter((r): r is Resolved => !!r)
        .filter(
          (r) =>
            wantsToAcquire(r.bucket, ourStrategy ?? null, ourNeeds ?? null).ok ||
            isBlindSpot(r.bucket, ourStrategy ?? null, ourNeeds ?? null),
        )
        .map((r) => ({ r, score: vorOfReceive([r.key]) * 1000 + valueAsset(toRef(r.key, "player"), ctx) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);

      // Picks we'd chase, only when we're actually hunting capital (picks
      // market is "buy", or our wants-more list calls for picks). This is what
      // turns on "ship the RB, get picks back."
      const huntPicks =
        ourStrategy?.picksMarket === "buy" ||
        (ourStrategy?.wantsMore ?? []).some((w) => w.toLowerCase().includes("pick"));
      const pickCands = huntPicks
        ? (data.pickOwnership.get(partnerId) ?? [])
            .map((p) => resolve(p.key))
            .filter((r): r is Resolved => !!r)
            .sort((a, b) => valueAsset(toRef(b.key, "pick"), ctx) - valueAsset(toRef(a.key, "pick"), ctx))
        : [];

      // Take the best players, and reserve a slot for the top pick when hunting
      // so capital deals aren't crowded out by players.
      const picked: Resolved[] = [];
      if (pickCands.length > 0) picked.push(pickCands[0]);
      for (const r of playerCands) {
        if (picked.length >= MAX_TARGETS_PER_PARTNER) break;
        picked.push(r);
      }
      targetSets = picked.map((r) => [r.key]);
    } else {
      targetSets = [receiveAnchors];
    }
    if (targetSets.length === 0) continue;

    for (const targetKeys of targetSets) {
      const offer = buildOne(partnerId, targetKeys);
      if (offer) offers.push(offer);
    }

    // Build a single offer for this partner around fixed send/receive anchors.
    function buildOne(pId: string, recvKeys: string[]): EngineOffer | null {
      const aim = req.aimAt;

      // ── Required backfill (HARD return-shape constraint) ──────────────────
      // Some moves cannot open a hole at the donor position: ship a QB when you
      // only start two and you must get a competent QB back, or the move isn't
      // your storyline (it's a teardown). So before balancing we seed a
      // competent same-bucket starter from THIS partner as a forced receive
      // anchor. "Competent" = the start-for test (would start for >= 1 other
      // team) — keeps a clipboard QB out. We seed the CHEAPEST competent piece
      // so the rest of the package (the value the anchor frees up) flows to the
      // youth / picks the storyline actually wants. Partner has no competent
      // piece there → no deal with them (correct: they can't satisfy the move).
      let recvKeysEff = recvKeys;
      let backfillKey: string | null = null;
      const backfillBucket = req.returnShape?.requireBackfill;
      if (backfillBucket) {
        const positions = bucketPositions(backfillBucket);
        const already = recvKeys
          .map(resolve)
          .some((r) => r && positions.has(r.position.toUpperCase()));
        if (!already) {
          const cand = partnerTeam!.players
            .filter((p) => positions.has(p.position.toUpperCase()))
            .map((p) => ({ p, value: data.values.value.get(p.id) ?? 0 }))
            .filter(({ p, value }) =>
              startsForAtLeast(p.id, p.position as Position, value, pId, data, 1),
            )
            .sort((a, b) => a.value - b.value)[0]; // cheapest competent
          if (!cand) return null; // partner can't backfill the hole → no deal
          backfillKey = cand.p.id;
          recvKeysEff = [cand.p.id, ...recvKeys];
        }
      }

      // Resolve + seed both sides.
      const seedSend = sendAnchors.map(resolve).filter((r): r is Resolved => !!r);
      const seedRecv = recvKeysEff.map(resolve).filter((r): r is Resolved => !!r);

      const sendSeedVA = seedSend.map((r) => valued(r, "send", aim, pId));
      const recvSeedVA = seedRecv.map((r) => valued(r, "receive", aim, pId));

      // Fill pools. Send: our movable assets, but thesis-aware — never the
      // war-chest picks, never a position we're actively buying (don't ship
      // what we're collecting), never an untouchable. Plus the PARTNER-SIDE
      // gate: don't offer the partner a player at a position THEY are selling
      // (they won't take more of what they're dumping). Receive: partner assets
      // we'd actually take (our demand gate), AND that the partner would
      // actually part with — never a position the partner is buying (they're
      // collecting it, not trading it away).
      const anchored = new Set([...sendAnchors, ...recvKeysEff]);

      // Insurance currency: a contender protecting a win-now roster pays in
      // PICKS plus genuinely-EXCESS players — never anyone who fills a real
      // role (a starter OR a needed backup), since shipping a useful piece to
      // fix one depth spot just opens another. "Excess" = the brain's already-
      // computed surplus pieces (bench bodies who'd start for 2+ other teams)
      // plus buried young players (below our worst starter at their position).
      // Read from ec.bundles (single source — not recomputed here).
      const insuranceCurrencyKeys: Set<string> | null = (() => {
        if (req.dealKind !== "insurance") return null;
        const bundle = ec.bundles?.get(ourTeamId);
        const keys = new Set<string>();
        for (const s of bundle?.rosterRead.surpluses ?? []) {
          for (const k of s.surplusPlayerIds) keys.add(k);
        }
        for (const b of bundle?.rosterRead.buriedYoungPlayers ?? []) keys.add(b.playerId);
        return keys;
      })();

      // Acquiring a QB? Ship at most ONE, never a stack. In superflex QB is the
      // scarcest position — bundling 2-3 QBs to land one is positionally absurd (you
      // gut your own QB room), so the balancer must close the gap with OTHER-bucket
      // depth + picks. The one allowed QB is either the anchored consolidation chip
      // (a deep team shipping a spare arm) or, when no anchor is a QB, the single most
      // valuable spendable QB — the incumbent the new starter displaces (e.g. Buffalo
      // shipping Goff). Detected off the receive aim (preferBuckets exactly [QB]);
      // RB/PC consolidations, which legitimately bundle depth, are untouched.
      const aimBuckets = req.returnShape?.preferBuckets;
      const qbAcquire =
        req.intent === "acquire" && aimBuckets?.length === 1 && aimBuckets[0] === "QB";
      const anchorHasQB =
        qbAcquire && sendAnchors.map(resolve).some((r) => r?.type === "player" && r.bucket === "QB");
      const allowedFillQB: string | null = (() => {
        if (!qbAcquire || anchorHasQB) return null; // anchor already supplies the one QB
        const cands = ourTeam!.playerIds
          .filter((k) => !anchored.has(k))
          .map(resolve)
          .filter((r): r is Resolved => !!r && r.type === "player" && r.bucket === "QB")
          .filter((r) => !(!!req.spendable && !req.spendable.has(r.key)))
          .filter((r) => !isScrub(r.key))
          .sort((a, b) => (data.values.value.get(b.key) ?? 0) - (data.values.value.get(a.key) ?? 0));
        return cands[0]?.key ?? null;
      })();

      const sendPool = ourTeam!.playerIds
        .concat((data.pickOwnership.get(ourTeamId) ?? []).map((p) => p.key))
        .filter((k) => !anchored.has(k))
        .map(resolve)
        .filter((r): r is Resolved => !!r)
        // QB acquire ships at most ONE QB: keep only the allowed chip, drop the rest.
        .filter((r) => !(qbAcquire && r.type === "player" && r.bucket === "QB" && r.key !== allowedFillQB))
        // Teardown ships ONLY the anchored stud — never bundle a second player and
        // never give away our own picks. The whole haul is assembled on the RECEIVE
        // side, so the send fill pool is empty. Without this the balancer pairs two
        // studs to match a pricey young anchor (a 2-for-1 that isn't a teardown) and
        // mishandles the highest-value studs.
        .filter(() => req.dealKind !== "teardown")
        .filter((r) => !isUntouchable(r.key, ourAttachment))
        .filter((r) => !(r.type === "pick" && protectedPickKeys.has(r.key)))
        // Fence is authoritative for PLAYERS too (not just picks): a sacred
        // player never funds a deal. Without this the balancer reaches for the
        // nearest-value body — often a core player — and the offer is built then
        // discarded downstream, starving the goal of any deal.
        .filter((r) => !(r.type === "player" && !!req.spendable && !req.spendable.has(r.key)))
        // Scrubs (outside their position's startable depth) never fill a gap — picks do.
        .filter((r) => !(r.type === "player" && isScrub(r.key)))
        .filter((r) => !(r.type === "player" && marketFor(ourStrategy, r.bucket) === "buy"))
        // Partner won't accept a player at a position they're selling.
        .filter((r) => !(r.type === "player" && marketFor(partnerStrategy, r.bucket) === "sell"))
        // Insurance: players must be genuinely excess; picks may fund it but
        // NEVER a 1st — a depth backup is not worth a premium pick (the brain's
        // insurance promise is "a proven backup, never for a 1st").
        .filter((r) => !insuranceCurrencyKeys || (r.type === "pick" ? (r.pick?.round ?? 1) >= 2 : insuranceCurrencyKeys.has(r.key)))
        .map((r) => valued(r, "send", aim, pId));

      // The PARTNER's fence: we can only RECEIVE what their storyline will move —
      // the union of their theses' spendable pools. Without this the fill pool
      // pulls a partner's SACRED body (a young building block / future 1st) into
      // the return, an unreal haul. Anchors are already matched against this; this
      // gates the pieces construct ADDS. No bundle for them → no extra fence.
      const partnerSpendable: Set<string> | null = (() => {
        const pb = ec.bundles?.get(pId);
        if (!pb) return null;
        const s = new Set<string>();
        for (const th of pb.theses) for (const k of th.spendable) s.add(k);
        return s;
      })();

      const recvResolvedPool = partnerTeam!.playerIds
        .concat((data.pickOwnership.get(pId) ?? []).map((p) => p.key))
        .filter((k) => !anchored.has(k))
        .map(resolve)
        .filter((r): r is Resolved => !!r)
        // Only what the partner's storyline will actually part with.
        .filter((r) => !partnerSpendable || partnerSpendable.has(r.key))
        // We'd take it if our normal demand says so — OR if the storyline is
        // explicitly aiming at this bucket. A sell→consolidate ("ship RB depth
        // to land ONE better RB") sets preferBuckets:[RB] even though our RB
        // market is "sell", and the consolidation TARGET must be exempt from
        // the don't-buy-what-you-sell gate or the shape can never fill.
        .filter(
          (r) =>
            wantsToAcquire(r.bucket, ourStrategy ?? null, ourNeeds ?? null).ok ||
            (req.returnShape?.preferBuckets?.includes(r.bucket) ?? false),
        )
        // Partner won't ship a player at a position they're buying (collecting).
        .filter((r) => !(r.type === "player" && marketFor(partnerStrategy, r.bucket) === "buy"));

      const recvPool = recvResolvedPool.map((r) => valued(r, "receive", aim, pId));

      // ── Return aim: shape the fill, don't just balance to value ───────────
      // The storyline's ReturnAim decides WHAT the gap-closer pulls. An aim
      // match is a pick of the wanted tier OR a young non-stud player.
      //   strength "hard"  → restrict the fill pool to aim matches only (a build
      //                      selling a stud takes back youth/picks, full stop —
      //                      this subsumes the old prefer_picks lean).
      //   strength "soft"  → keep the full pool but PREFER aim matches among the
      //                      in-band candidates (consolidate — the player is the
      //                      point, just tilt him young).
      // Back-compat: no returnShape but prefer_picks lean set → behave as the
      // old reset/vet-liq hard youth+picks filter.
      const shape = req.returnShape ?? null;
      const legacyPreferPicks = !shape && (req.leans ?? []).includes("prefer_picks");

      const pickTier = shape?.preferPickTier ?? (legacyPreferPicks ? "any" : undefined);
      // Buckets the fill may pull players from. undefined = any. Empty array =
      // NO players (picks-only shape).
      const preferBuckets = shape?.preferBuckets;
      // Buckets whose returned players must be young. Legacy prefer_picks meant
      // youth everywhere.
      const youthBuckets = new Set<Bucket>(
        shape?.youthBuckets ?? (legacyPreferPicks ? ["QB", "RB", "PASS_CATCHER"] : []),
      );
      const hasAim =
        !!pickTier ||
        youthBuckets.size > 0 ||
        preferBuckets !== undefined ||
        legacyPreferPicks;

      const pickMatchesTier = (r: Resolved): boolean => {
        if (r.type !== "pick" || !r.pick) return false;
        if (!pickTier || pickTier === "any") return true;
        if (pickTier === "premium") return r.pick.round === 1;
        if (pickTier === "future") return r.pick.kind === "future";
        return true;
      };
      const aimMatch = (r: Resolved): boolean => {
        if (r.type === "pick") return pickMatchesTier(r);
        // Player: must sit in an allowed bucket (if preferBuckets restricts it),
        // and must be young when its bucket carries a youth intent.
        if (preferBuckets !== undefined && !preferBuckets.includes(r.bucket)) return false;
        if (youthBuckets.has(r.bucket)) {
          if (r.isStud) return false;
          return isYoung(r.position, data.players.get(r.key)?.age ?? null, data.players.get(r.key)?.exp);
        }
        return true;
      };

      const aimKeys = new Set(recvResolvedPool.filter(aimMatch).map((r) => r.key));
      const hard = shape?.strength === "hard" || legacyPreferPicks;

      // Hard aim filters the pool; soft aim passes preferKeys to the balancer.
      const recvFillPool = hard && hasAim ? recvPool.filter((a) => aimKeys.has(a.key)) : recvPool;
      const preferKeys = !hard && hasAim ? aimKeys : undefined;

      // Opening ratio is from the offering team's seat; translate to OUR seat
      // (balance always reads receive/send from our seat).
      const targetRatio = aim === "us" ? knobs.openingRatio : 1 / knobs.openingRatio;

      const balanced = balanceDeal({
        send: sendSeedVA,
        receive: recvSeedVA,
        sendPool,
        receivePool: recvFillPool,
        targetRatio,
        // A teardown haul is many small picks for one big stud — it needs more
        // room per side than a normal deal to assemble the bounty.
        maxPerSide: req.dealKind === "teardown" ? Math.max(knobs.maxPerSide, 6) : knobs.maxPerSide,
        preferKeys,
      });

      let sendVA = balanced.send;
      let recvVA = balanced.receive;

      // Persona finishing sweetener: a low pick added to the indicated side.
      if (knobs.sweetenerSide === "send" && sendVA.length < knobs.maxPerSide) {
        const lowPick = [...sendPool]
          .filter((a) => a.type === "pick" && !sendVA.some((s) => s.key === a.key))
          .sort((a, b) => a.value - b.value)[0];
        if (lowPick) sendVA = [...sendVA, lowPick];
      } else if (knobs.sweetenerSide === "receive" && recvVA.length < knobs.maxPerSide) {
        const smallPick = [...recvFillPool]
          .filter((a) => a.type === "pick" && !recvVA.some((s) => s.key === a.key))
          .sort((a, b) => a.value - b.value)[0];
        if (smallPick) recvVA = [...recvVA, smallPick];
      }

      // Need a real two-sided deal.
      if (sendVA.length === 0 || recvVA.length === 0) return null;

      // A backfill is the COST of the downgrade, not the return. If the only
      // thing coming back is the backfill piece, the move buys nothing for the
      // storyline (a stud-for-stud lateral) — drop it. Real value must come
      // back elsewhere: picks or players at the intent-cued positions.
      if (backfillKey && !recvVA.some((a) => a.key !== backfillKey)) return null;

      const assets: EngineOfferAsset[] = [
        ...sendVA.map((a) => ({ key: a.key, name: a.name, type: a.type, side: "send" as Side })),
        ...recvVA.map((a) => ({ key: a.key, name: a.name, type: a.type, side: "receive" as Side })),
      ];

      const sendKeys = sendVA.map((a) => a.key);
      const recvKeysAll = recvVA.map((a) => a.key);

      // Post-trade safety — never gut our own lineup. EXCEPT a teardown, whose
      // whole intent is to cash a starter (an aging stud QB/RB/WR) for future
      // capital: the starter-value drop IS the point, not an accident. The teardown
      // band (ourBand.min = HARD_FLOOR) already guarantees a fair haul of picks +
      // youth comes back, so value isn't given away — we just accept the present-
      // lineup hit. Applying the 12% floor here silently killed every teardown that
      // ships a true starter (Doylestown's Lamar, Founders' studs → 0 offers).
      if (req.dealKind !== "teardown" && !survivesSafety(sendKeys, recvKeysAll)) return null;

      // Real two-scoreboard pricing.
      const pricing: PricingInput = { ourTeamId, partnerTeamId: pId, assets, ctx };
      const { ours, theirs } = priceDeal(pricing);

      let ourBand = effectiveBand(ourTeamId, ourPersona);
      let theirBand = effectiveBand(pId, partnerPersona);
      // NB: a teardown gets NO value-floor discount. We never surface a deal where
      // WE take a meaningful haircut (sub-persona-floor, ~0.85-0.90) — teardown or
      // not. A mega-stud no single buyer can pay fair value for (a 626 QB) simply
      // doesn't produce a surfaceable offer; better to hold him than dump at 80
      // cents on the dollar. The teardown's only special-casing is the post-trade
      // SAFETY exemption above (the lineup hit is intended) — not the value band.
      // Desperation premium: if we're shipping a position this partner is
      // win-now desperate for, they'll pay above flat value — model that by
      // lowering their effective floor toward the locked stretch floor, so a
      // deal that asks them to "overpay" still reads as acceptable for them.
      const sellingBuckets = new Set(
        sendVA.map((a) => resolve(a.key)?.bucket).filter((b): b is Bucket => !!b && b !== "PICK"),
      );
      const premiumOn = [...sellingBuckets].some((b) => premiumFiresFor(b, partnerWindow, partnerNeeds));
      if (premiumOn) {
        theirBand = { ...theirBand, min: Math.max(HARD_FLOOR, theirBand.min - PARTNER_STRETCH) };
      }
      const grade = personaAwareGrade(gapFrom(ours), ourPersona);
      const partnerRead = readFor(theirs.ratio, theirBand);
      const clears = inBand(ours.ratio, ourBand) && inBand(theirs.ratio, theirBand);

      // Surfacing floors (LOCKED).
      if (aim === "us") {
        // 1) Works for us: at or above OUR band floor. The persona band is the
        //    single source of truth now — no separate grade-bucket gate. We do
        //    NOT cap on our ceiling; a steal for us is fine and gets killed by
        //    the partner floor below anyway.
        if (ours.ratio < ourBand.min) return null;
        // 2) Not fantasy for them: within their stretch. long_shot = past the
        //    stretch (or below the hard floor) → don't surface.
        if (partnerRead === "long_shot") return null;
      } else {
        // Studio: only surface what the partner would realistically take.
        if (!inBand(theirs.ratio, theirBand)) return null;
      }

      // Ranking.
      const recvResolved = recvKeysAll.map(resolve).filter((r): r is Resolved => !!r);
      // Relative-need severity per bucket, straight from our needs (was the
      // engine thesis's buy list — same numbers, no archetype baggage).
      const sevByBucket = new Map<Bucket, number>(
        NEED_BUCKETS.map((b) => [b, needSeverity(ourNeeds, b)]),
      );
      let needFit = 0;
      let motivation = 0;
      for (const r of recvResolved) {
        // Relative-need weighted: a pass-catcher at severity 0.92 outranks an RB
        // at 0.72 instead of both counting as a flat "high".
        needFit += (sevByBucket.get(r.bucket) ?? 0) * 2 + needScore(needLevel(ourNeeds, r.bucket));
        if (marketFor(partnerStrategy, r.bucket) === "sell") motivation += 1;
      }
      const vor = vorOfReceive(recvKeysAll);
      const vorNorm = ourBaseStarter > 0 ? Math.min(1, vor / (ourBaseStarter * 0.15)) : 0;
      const aimRatio = aim === "us" ? ours.ratio : theirs.ratio;
      const aimScore = Math.max(0, Math.min(2, aimRatio)); // reward favorable-on-aim-board

      // Complementarity: we buy what they sell, and vice-versa.
      let complement = 0;
      for (const b of ["QB", "RB", "PASS_CATCHER", "PICK"] as Bucket[]) {
        const my = marketFor(ourStrategy, b);
        const th = marketFor(partnerStrategy, b);
        if ((my === "buy" && th === "sell") || (my === "sell" && th === "buy")) complement += 1;
      }

      // Friction: leading with an untouchable (anchors can be) or shipping a
      // pick while we're accumulating.
      let friction = 0;
      for (const k of sendKeys) {
        if (isUntouchable(k, ourAttachment)) friction += 1;
        if (pickByKey.has(k) && shippingPickIsFriction(ourStrategy ?? null, ourDossier)) friction += 0.5;
      }

      const score =
        W_FIT * needFit +
        W_VOR * vorNorm +
        W_AIM * aimScore +
        W_LIKELY * (partnerRead === "likely" ? 1 : 0) +
        W_PARTNERFIT * fitScore +
        W_PREMIUM * (premiumOn ? 1 : 0) +
        W_MOTIVATION * motivation +
        W_COMPLEMENT * complement -
        W_FRICTION * friction;

      const id = `${pId}:${[...sendKeys].sort().join(",")}>${[...recvKeysAll].sort().join(",")}`;

      return {
        id,
        partnerTeamId: pId,
        partnerTeamName: partnerTeam!.teamName,
        partnerPersona,
        intent: req.intent,
        assets,
        ourScoreboard: ours,
        grade,
        partnerScoreboard: theirs,
        partnerRead,
        clears,
        prose: "",
        score,
      };
    }
  }

  // ─── Slate assembly: best-per-partner, position caps, blind-spot slots ──────

  // Primary bucket of an offer = bucket of its highest-value receive player.
  function primaryBucket(o: EngineOffer): Bucket {
    const players = o.assets.filter((a) => a.side === "receive" && a.type === "player");
    let best: Bucket = "PICK";
    let bestVal = -1;
    for (const a of players) {
      const r = resolve(a.key);
      if (!r) continue;
      const v = valueAsset(toRef(r.key, "player"), ctx);
      if (v > bestVal) {
        bestVal = v;
        best = r.bucket;
      }
    }
    return best;
  }

  // Up to MAX_OFFERS_PER_PARTNER per partner (best-scoring), deduped by id, so
  // one team can show e.g. a player deal and a picks deal without flooding.
  const byPartner = new Map<string, EngineOffer[]>();
  for (const o of offers) {
    const list = byPartner.get(o.partnerTeamId) ?? [];
    list.push(o);
    byPartner.set(o.partnerTeamId, list);
  }
  const kept: EngineOffer[] = [];
  for (const list of byPartner.values()) {
    const top = list.sort((a, b) => b.score - a.score).slice(0, MAX_OFFERS_PER_PARTNER);
    kept.push(...top);
  }
  const ranked = kept.sort((a, b) => b.score - a.score);

  // Blind-spot buckets: worst-in-league need we marked set/sell.
  const blindBuckets = (["QB", "RB", "PASS_CATCHER"] as Bucket[]).filter((b) =>
    isBlindSpot(b, ourStrategy ?? null, ourNeeds ?? null),
  );

  const chosen: EngineOffer[] = [];
  const posCount = new Map<Bucket, number>();
  const usedIds = new Set<string>();

  // Reserve up to BLIND_SPOT_SLOTS for offers that fix a glaring hole first.
  if (blindBuckets.length > 0) {
    let reserved = 0;
    for (const o of ranked) {
      if (reserved >= BLIND_SPOT_SLOTS) break;
      if (blindBuckets.includes(primaryBucket(o)) && !usedIds.has(o.id)) {
        chosen.push(o);
        usedIds.add(o.id);
        const b = primaryBucket(o);
        posCount.set(b, (posCount.get(b) ?? 0) + 1);
        reserved++;
      }
    }
  }

  // Fill the rest with the per-position cap.
  for (const o of ranked) {
    if (chosen.length >= SLATE_MAX) break;
    if (usedIds.has(o.id)) continue;
    const b = primaryBucket(o);
    if ((posCount.get(b) ?? 0) >= PER_POSITION_CAP) continue;
    chosen.push(o);
    usedIds.add(o.id);
    posCount.set(b, (posCount.get(b) ?? 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    offers: chosen,
    reason: chosen.length > 0 ? "ok" : "no_clean_offers",
  };
}