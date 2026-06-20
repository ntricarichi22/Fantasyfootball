import { teamNickname } from "@/shared/league-data";
import type { LeagueData, StrategyProfile, MarketStance, OwnedPick } from "@/shared/league-data";
import type { TeamProfile } from "@/shared/team-profiles";
import type { TeamDossier, Confidence } from "./types";

// ── Tunable knobs ───────────────────────────────────────────────
// Mirror the profiler's age thresholds so the two layers agree.
const AGE_OLD = 28.0; // closing-window age
const AGE_YOUNG = 25.5; // genuinely-young core

// Onboarding stores SHORT want labels; the trade engine uses LONG ones.
// Accept both so the dossier reads correctly no matter which is stored.
const WANT_READABLE: Record<string, string> = {
  studs: "win-now studs",
  elite_producers: "win-now studs",
  picks: "draft picks",
  draft_picks: "draft picks",
  youth: "young upside",
  young_upside: "young upside",
  depth: "roster depth",
  roster_depth: "roster depth",
};

function isStrong(tier: TeamProfile["tier"]): boolean {
  return tier === "championship" || tier === "playoff";
}

// An attachment id is a pick when it carries the canonical pick-key prefix;
// otherwise it's a sleeper player id.
function isPickKey(id: string): boolean {
  return id.startsWith("pick:");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// "2027 1st" or, when acquired, "2027 1st (via Onslaught)".
function pickLabel(pick: OwnedPick, data: LeagueData): string {
  const base = `${pick.season} ${ordinal(pick.round)}`;
  if (pick.originalRosterId === pick.currentRosterId) return base;
  const orig = data.teams.find((t) => t.rosterId === pick.originalRosterId);
  const via = orig ? teamNickname(orig.teamName) : `roster ${pick.originalRosterId}`;
  return `${base} (via ${via})`;
}

function readWants(wantsMore: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of wantsMore) {
    const r = WANT_READABLE[w] ?? w;
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out.join(", ");
}

// Any untouchable PICK in the attachment map. Reads the attachment facts the
// owner set — no pickOwnership needed for the boolean itself.
function computePicksLocked(p: TeamProfile, data: LeagueData): boolean {
  const att = data.attachments.get(p.rosterId);
  if (!att) return false;
  for (const [id, level] of att) {
    if (level === "untouchable" && isPickKey(id)) return true;
  }
  return false;
}

// Profile-derived scout headline (display only; the engine reads storylines, not
// this). Same wording the old window→verdict map produced, computed inline.
function computeVerdict(p: TeamProfile): string {
  const age = p.strength.avgStarterAge;
  const old = age != null && age >= AGE_OLD;
  const young = age != null && age <= AGE_YOUNG;
  const ascending = p.trajectory.direction === "ascending";
  if (isStrong(p.tier)) {
    if (old && !ascending) return "Window's closing. Still strong, but aging fast — win now or bust.";
    return old
      ? "Win-now contender. Loaded, but the core isn't getting younger."
      : "Win-now contender. Deep, balanced, and built to push.";
  }
  if (p.tier === "rebuilding") return "Rebuild mode. Stockpiling picks and youth, playing the long game.";
  // retooling
  if (ascending) {
    return young
      ? "On the rise. Young talent outrunning the record — dangerous soon."
      : "On the rise. Roster's worth more than the record showed — dangerous soon.";
  }
  return "Rebuild mode. Stockpiling picks and youth, playing the long game.";
}

function computeWantsSells(
  p: TeamProfile,
  strat: StrategyProfile | null,
  picksLocked: boolean
): { wants: string; sells: string } {
  const markets: Record<string, MarketStance> = strat
    ? {
        QB: strat.qbMarket,
        RB: strat.rbMarket,
        "Pass catchers": strat.pcMarket,
        Picks: strat.picksMarket,
      }
    : {};
  const buying = Object.entries(markets)
    .filter(([, s]) => s === "buy")
    .map(([k]) => k);
  const selling = Object.entries(markets)
    .filter(([, s]) => s === "sell")
    .map(([k]) => k);
  const stated = strat ? readWants(strat.wantsMore) : "";

  // wants: explicit market signal, then stated wants, then tier fallback.
  let wants: string;
  if (buying.length) wants = `buying ${buying.join(", ")}`;
  else if (stated) wants = stated;
  else wants = isStrong(p.tier) ? "win-now players" : "picks & young upside";

  // sells: explicit market signal, then picks-locked override, then tier fallback.
  let sells: string;
  if (selling.length) sells = `shopping ${selling.join(", ")}`;
  else if (picksLocked) sells = "depth & vets — draft capital off the table";
  else sells = isStrong(p.tier) ? "spare picks & depth" : "vets for picks";

  return { wants, sells };
}

function computeCoreLabel(
  p: TeamProfile,
  data: LeagueData,
  pickByKey: Map<string, OwnedPick>
): string {
  const att = data.attachments.get(p.rosterId);
  const players: string[] = [];
  const picks: string[] = [];
  if (att) {
    for (const [id, level] of att) {
      if (level !== "untouchable") continue;
      if (isPickKey(id)) {
        const pk = pickByKey.get(id);
        picks.push(pk ? pickLabel(pk, data) : id);
      } else {
        players.push(data.players.get(id)?.name ?? id);
      }
    }
  }
  const parts: string[] = [];
  if (players.length) parts.push(`Untouchable: ${players.join(", ")}`);
  if (picks.length) parts.push(`Picks locked: ${picks.join(", ")}`);
  if (!parts.length) return "No untouchables — full roster moveable";
  parts.push("all others moveable");
  return parts.join(" · ");
}

function computeStance(p: TeamProfile, persona: string, picksLocked: boolean): string {
  const intent = p.trajectory.contendIntent;
  let base: string;
  if (isStrong(p.tier)) {
    base =
      intent >= 0
        ? "Aggressive buyer — pays in picks & youth to win now"
        : "Quietly opportunistic — buys selectively";
  } else if (p.tier === "retooling") {
    base = picksLocked
      ? "Building through the draft — capital's locked, all-in on a future window"
      : intent > 0
        ? "Buyer on the margins"
        : "Open for business — listens on most";
  } else {
    base = "Seller — collecting picks & youth";
  }
  if (persona && persona !== "unknown") base += ` (${persona})`;
  return base;
}

function computeConfidence(strat: StrategyProfile | null): Confidence {
  if (!strat) return "thin";
  const active = [
    strat.qbMarket,
    strat.rbMarket,
    strat.pcMarket,
    strat.picksMarket,
  ].some((s) => s === "buy" || s === "sell");
  return active ? "strong" : "thin";
}

// Turns the analysis layer into a plain-English stance. Reads the LIVE strategy
// + attachment rows, so the moment a team updates wants/markets/attachments in
// the app, every dossier reflects it on the next call. No rewiring.
export function buildTeamDossiers(profiles: TeamProfile[], data: LeagueData): TeamDossier[] {
  return profiles.map((p) => {
    const strat = data.strategy.get(p.rosterId) ?? null;
    const persona = strat?.persona ?? "unknown";
    const picksLocked = computePicksLocked(p, data);
    const { wants, sells } = computeWantsSells(p, strat, picksLocked);

    const pickByKey = new Map<string, OwnedPick>();
    for (const pk of data.pickOwnership.get(p.rosterId) ?? []) pickByKey.set(pk.key, pk);

    return {
      rosterId: p.rosterId,
      teamName: p.teamName,
      tier: p.tier,
      tierLabel: p.tierLabel,
      verdict: computeVerdict(p),
      wants,
      sells,
      coreLabel: computeCoreLabel(p, data, pickByKey),
      tradeStance: computeStance(p, persona, picksLocked),
      persona,
      picksLocked,
      confidence: computeConfidence(strat),
    };
  });
}