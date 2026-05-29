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

import type { LeagueData, StrategyProfile, RosteredTeam, PlayerInfo, OwnedPick } from "@/shared/league-data";
import type { TeamProfile, TeamNeeds, NeedLevel } from "@/shared/team-profiles";
import { computeStrength } from "@/shared/team-profiles";
import type { TeamDossier } from "@/shared/team-dossier";
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
import { buildThesis, buildPartnerFit, type Thesis, type PartnerFit } from "./thesis";

// ─── The input bundle the route assembles (engine never hits the DB) ─────────

export type EngineContext = {
  data: LeagueData;
  profiles: TeamProfile[];
  dossiers: TeamDossier[];
  needs: Map<string, TeamNeeds>;
  ctx: ValuationContext;
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

  // Index profiles/needs by id for the thesis + partner-fit.
  const profileById = new Map(ec.profiles.map((p) => [p.rosterId, p]));
  const ourProfile = profileById.get(ourTeamId) ?? null;

  // OUR deal-thesis — the judgment that steers everything below.
  const thesis: Thesis = buildThesis(ourTeamId, data, ourProfile, ourDossier, ourNeeds ?? null);

  // Which of our picks are protected (war chest) per posture. accumulate →
  // shield all; non_first → shield 1sts; all → shield none. Protected picks
  // stay out of the send filler pool (they can still be explicit anchors).
  const ourPicks = data.pickOwnership.get(ourTeamId) ?? [];
  const protectedPickKeys = new Set<string>(
    thesis.pickSpend === "all"
      ? []
      : ourPicks
          .filter((p) => (thesis.pickSpend === "none" ? true : p.round === 1))
          .map((p) => p.key),
  );

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
    const partnerProfile = profileById.get(partnerId) ?? null;
    const partnerNeeds = ec.needs.get(partnerId) ?? null;

    // Partner-fit: how natural a counterparty this is for our thesis, plus the
    // per-position desperation-premium read.
    const fit: PartnerFit = buildPartnerFit(
      partnerId,
      data,
      partnerProfile,
      partnerDossier,
      partnerNeeds,
      ourNeeds ?? null,
    );

    // In open acquire mode, skip clearly poor-fit partners (same window/wants
    // as us, no need-mirroring) so we call the right teams instead of everyone.
    // Locked counterparties (Studio/Scouting targets) are always honored.
    if (req.counterparty.mode === "open" && req.intent === "acquire" && fit.fitScore <= 0) {
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

      // Resolve + seed both sides.
      const seedSend = sendAnchors.map(resolve).filter((r): r is Resolved => !!r);
      const seedRecv = recvKeys.map(resolve).filter((r): r is Resolved => !!r);

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
      const anchored = new Set([...sendAnchors, ...recvKeys]);
      const sendPool = ourTeam!.playerIds
        .concat((data.pickOwnership.get(ourTeamId) ?? []).map((p) => p.key))
        .filter((k) => !anchored.has(k))
        .map(resolve)
        .filter((r): r is Resolved => !!r)
        .filter((r) => !isUntouchable(r.key, ourAttachment))
        .filter((r) => !(r.type === "pick" && protectedPickKeys.has(r.key)))
        .filter((r) => !(r.type === "player" && marketFor(ourStrategy, r.bucket) === "buy"))
        // Partner won't accept a player at a position they're selling.
        .filter((r) => !(r.type === "player" && marketFor(partnerStrategy, r.bucket) === "sell"))
        .map((r) => valued(r, "send", aim, pId));

      const recvResolvedPool = partnerTeam!.playerIds
        .concat((data.pickOwnership.get(pId) ?? []).map((p) => p.key))
        .filter((k) => !anchored.has(k))
        .map(resolve)
        .filter((r): r is Resolved => !!r)
        .filter((r) => wantsToAcquire(r.bucket, ourStrategy ?? null, ourNeeds ?? null).ok)
        // Partner won't ship a player at a position they're buying (collecting).
        .filter((r) => !(r.type === "player" && marketFor(partnerStrategy, r.bucket) === "buy"));

      const recvPool = recvResolvedPool.map((r) => valued(r, "receive", aim, pId));

      // Lean bias: when the seller's narrative wants future capital
      // (prefer_picks — reset / vet-liquidation), the return should be PICKS or
      // YOUNG players, never proven studs — a team resetting builds for the
      // future, it doesn't take back win-now stars. So the fill pool keeps
      // every pick plus any non-stud player who is young (isYoung), and drops
      // studs and prime/aging vets. Seeded receive anchors are untouched; this
      // only constrains what balance ADDS. prefer_players (de-consolidate)
      // leaves the pool as-is.
      const preferPicks = (req.leans ?? []).includes("prefer_picks");
      const resetEligibleKeys = new Set(
        recvResolvedPool
          .filter((r) => {
            if (r.type === "pick") return true;
            if (r.isStud) return false;
            const info = data.players.get(r.key);
            return isYoung(r.position, info?.age ?? null);
          })
          .map((r) => r.key),
      );
      const recvFillPool = preferPicks
        ? recvPool.filter((a) => resetEligibleKeys.has(a.key))
        : recvPool;

      // Opening ratio is from the offering team's seat; translate to OUR seat
      // (balance always reads receive/send from our seat).
      const targetRatio = aim === "us" ? knobs.openingRatio : 1 / knobs.openingRatio;

      const balanced = balanceDeal({
        send: sendSeedVA,
        receive: recvSeedVA,
        sendPool,
        receivePool: recvFillPool,
        targetRatio,
        maxPerSide: knobs.maxPerSide,
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

      const assets: EngineOfferAsset[] = [
        ...sendVA.map((a) => ({ key: a.key, name: a.name, type: a.type, side: "send" as Side })),
        ...recvVA.map((a) => ({ key: a.key, name: a.name, type: a.type, side: "receive" as Side })),
      ];

      const sendKeys = sendVA.map((a) => a.key);
      const recvKeysAll = recvVA.map((a) => a.key);

      // Post-trade safety — never gut our own lineup.
      if (!survivesSafety(sendKeys, recvKeysAll)) return null;

      // Real two-scoreboard pricing.
      const pricing: PricingInput = { ourTeamId, partnerTeamId: pId, assets, ctx };
      const { ours, theirs } = priceDeal(pricing);

      const ourBand = effectiveBand(ourTeamId, ourPersona);
      let theirBand = effectiveBand(pId, partnerPersona);
      // Desperation premium: if we're shipping a position this partner is
      // win-now desperate for, they'll pay above flat value — model that by
      // lowering their effective floor toward the locked stretch floor, so a
      // deal that asks them to "overpay" still reads as acceptable for them.
      const sellingBuckets = new Set(
        sendVA.map((a) => resolve(a.key)?.bucket).filter((b): b is Bucket => !!b && b !== "PICK"),
      );
      const premiumOn = [...sellingBuckets].some((b) => fit.premiumFires(b));
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
      const sevByBucket = new Map(thesis.buy.map((b) => [b.bucket, b.severity]));
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
        W_PARTNERFIT * fit.fitScore +
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