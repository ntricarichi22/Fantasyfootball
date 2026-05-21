import type { LeagueData, StrategyProfile, MarketStance } from "@/shared/league-data";
import type { TeamProfile } from "@/shared/team-profiles";
import type { TeamDossier, Window, Confidence } from "./types";

// ── Tunable knobs ───────────────────────────────────────────────
// Matches the profiler's closing-window age threshold so the two agree.
const AGE_OLD = 28.0;

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

function computeWindow(p: TeamProfile): Window {
  const old = p.strength.avgStarterAge != null && p.strength.avgStarterAge >= AGE_OLD;
  const ascending = p.trajectory.direction === "ascending";
  if (isStrong(p.tier)) {
    return old && !ascending ? "closing" : "contending";
  }
  // retooling / rebuilding
  return ascending ? "ascending" : "rebuilding";
}

function computeVerdict(p: TeamProfile, window: Window): string {
  const old = p.strength.avgStarterAge != null && p.strength.avgStarterAge >= AGE_OLD;
  switch (window) {
    case "contending":
      return old
        ? "Win-now contender. Loaded, but the core isn't getting younger."
        : "Win-now contender. Deep, balanced, and built to push.";
    case "closing":
      return "Window's closing. Still strong, but aging fast — win now or bust.";
    case "ascending":
      return "On the rise. Young talent outrunning the record — dangerous soon.";
    case "rebuilding":
      return "Rebuild mode. Stockpiling picks and youth, playing the long game.";
  }
}

function computeWantsSells(
  p: TeamProfile,
  strat: StrategyProfile | null
): { wants: string; sells: string } {
  const markets: Record<string, MarketStance> = strat
    ? {
        QB: strat.qbMarket,
        RB: strat.rbMarket,
        WR: strat.wrMarket,
        TE: strat.teMarket,
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

  // wants: prefer explicit market signal, then stated wants, then tier fallback.
  let wants: string;
  if (buying.length) wants = `buying ${buying.join(", ")}`;
  else if (stated) wants = stated;
  else wants = isStrong(p.tier) ? "win-now players" : "picks & young upside";

  // sells: prefer explicit market signal, then tier fallback.
  let sells: string;
  if (selling.length) sells = `shopping ${selling.join(", ")}`;
  else sells = isStrong(p.tier) ? "spare picks & depth" : "vets for picks";

  return { wants, sells };
}

function computeCoreLabel(p: TeamProfile, data: LeagueData): string {
  const att = data.attachments.get(p.rosterId);
  const untouchables: string[] = [];
  if (att) {
    for (const [pid, level] of att) {
      if (level === "untouchable") {
        untouchables.push(data.players.get(pid)?.name ?? pid);
      }
    }
  }
  if (!untouchables.length) return "No untouchables — full roster moveable";
  return `Untouchable: ${untouchables.join(", ")} · all others moveable`;
}

function computeStance(p: TeamProfile, persona: string): string {
  const intent = p.trajectory.contendIntent;
  let base: string;
  if (isStrong(p.tier)) {
    base =
      intent >= 0
        ? "Aggressive buyer — pays in picks & youth to win now"
        : "Quietly opportunistic — buys selectively";
  } else if (p.tier === "retooling") {
    base = intent > 0 ? "Buyer on the margins" : "Open for business — listens on most";
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
    strat.wrMarket,
    strat.teMarket,
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
    const window = computeWindow(p);
    const { wants, sells } = computeWantsSells(p, strat);
    return {
      rosterId: p.rosterId,
      teamName: p.teamName,
      tier: p.tier,
      tierLabel: p.tierLabel,
      verdict: computeVerdict(p, window),
      window,
      wants,
      sells,
      coreLabel: computeCoreLabel(p, data),
      tradeStance: computeStance(p, persona),
      persona,
      confidence: computeConfidence(strat),
    };
  });
}