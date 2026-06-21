// src/shared/roster-stacks.ts
//
// THE single source of truth for trade stack / concentration evaluation, lifted
// out of the two engines (Builder `construct.ts` and Studio `studio/offers.ts`)
// that had grown identical hand-written copies. Pure: kept-roster facts + a
// received player in, a verdict out — nothing stored, so the two engines can
// never drift.
//
// Three roster-construction effects, all judged by NFL-team adjacency between a
// player we'd RECEIVE and the players we'd KEEP:
//   • qb-stack         — a received pass-catcher (WR/TE) on the same NFL team as
//                        a QB we keep. Good.
//   • rb-handcuff      — a received RB behind a lead RB we keep (and we don't
//                        already hold 2+ RBs on that team). Good.
//   • wr-concentration — a received WR doubling up an NFL team we already start
//                        a WR on. Bad.
//
// A single received WR can be BOTH a qb-stack and a wr-concentration (its NFL
// team has a kept QB and a kept WR), so classifyStack returns an array, never a
// single verdict — that preserved the original engines' independent checks.

export type StackKind = "qb-stack" | "rb-handcuff" | "wr-concentration";

// Magnitudes the Builder folds into its deal score (qb-stack/rb-handcuff add to
// the stack bonus; wr-concentration subtracts as concentration). The Studio
// reads only the kind, not the weight.
export const STACK_WEIGHTS: Record<StackKind, number> = {
  "qb-stack": 1,
  "rb-handcuff": 0.5,
  "wr-concentration": 1,
};

export type StackContext = {
  qbTeams: Set<string>;
  wrTeams: Set<string>;
  leadRbTeams: Set<string>;
  rbCountByTeam: Map<string, number>;
};

export type KeptPlayer = {
  nflTeam: string | null | undefined;
  position: string | null | undefined;
  // Whether this RB is a "lead back" worth handcuffing. The caller decides the
  // predicate (and so stays the owner of that threshold); ignored for non-RBs.
  isLeadRb: boolean;
};

// Group the players we'd keep by NFL team: which teams we keep a QB / WR on,
// which teams we keep a lead RB on, and how many RBs we keep per team.
export function buildStackContext(kept: KeptPlayer[]): StackContext {
  const qbTeams = new Set<string>();
  const wrTeams = new Set<string>();
  const leadRbTeams = new Set<string>();
  const rbCountByTeam = new Map<string, number>();
  for (const p of kept) {
    const team = p.nflTeam;
    if (!team) continue;
    const pos = (p.position ?? "").toUpperCase();
    if (pos === "QB") qbTeams.add(team);
    else if (pos === "WR") wrTeams.add(team);
    else if (pos === "RB") {
      rbCountByTeam.set(team, (rbCountByTeam.get(team) ?? 0) + 1);
      if (p.isLeadRb) leadRbTeams.add(team);
    }
  }
  return { qbTeams, wrTeams, leadRbTeams, rbCountByTeam };
}

export type ReceivedPlayer = {
  nflTeam: string | null | undefined;
  position: string | null | undefined;
};

// Classify what roster-construction effects receiving `recv` would create given
// the kept-roster `ctx`. Returns every effect that applies (a WR can be both a
// qb-stack and a wr-concentration), or [] for none.
export function classifyStack(recv: ReceivedPlayer, ctx: StackContext): StackKind[] {
  const out: StackKind[] = [];
  const team = recv.nflTeam;
  if (!team) return out;
  const pos = (recv.position ?? "").toUpperCase();
  if ((pos === "WR" || pos === "TE") && ctx.qbTeams.has(team)) out.push("qb-stack");
  if (pos === "RB" && ctx.leadRbTeams.has(team) && (ctx.rbCountByTeam.get(team) ?? 0) < 2) out.push("rb-handcuff");
  if (pos === "WR" && ctx.wrTeams.has(team)) out.push("wr-concentration");
  return out;
}
