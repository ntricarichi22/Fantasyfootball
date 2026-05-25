import type {
  Position,
  PositionNeed,
  NeedSeverity,
  RosterPlayer,
  AvailablePlayer,
  TeamProfile,
  BehavioralRead,
} from "./types";
import { POSITIONS } from "./types";
import type { LeagueData, RawTeam } from "./dataLayer";

// Tunable: consensus value at/above which a player counts as "starter-tier".
// Surfaced in the debug output so we can calibrate against the real value
// distribution before relying on it.
const STARTER_VALUE_FLOOR = 100;

// Rough count of quality players a team wants at each position before the
// position reads as "set" (starter + reasonable depth for a 12-team league).
const SET_THRESHOLD: Record<Position, number> = {
  QB: 1,
  RB: 3,
  WR: 4,
  TE: 1,
};

// Round-1 baseline. A team holding more than this owns extra capital.
const STARTING_PICKS_PER_TEAM = 1;

function severityFor(pos: Position, starterCount: number): NeedSeverity {
  const need = SET_THRESHOLD[pos];
  if (starterCount === 0) return "critical";
  if (starterCount < need) return "moderate";
  if (starterCount === need) return "set";
  return "surplus";
}

function computeNeeds(roster: RosterPlayer[]): PositionNeed[] {
  const needs: PositionNeed[] = POSITIONS.map((pos) => {
    const atPos = roster.filter((p) => p.position === pos);
    const starters = atPos.filter((p) => p.value >= STARTER_VALUE_FLOOR);
    const topValue = atPos.reduce((m, p) => Math.max(m, p.value), 0);
    return {
      position: pos,
      starterCount: starters.length,
      totalCount: atPos.length,
      topValue,
      severity: severityFor(pos, starters.length),
    };
  });
  const order: Record<NeedSeverity, number> = {
    critical: 0,
    moderate: 1,
    set: 2,
    surplus: 3,
  };
  return needs.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.topValue - a.topValue
  );
}

function qualityAvailableAt(available: AvailablePlayer[], pos: Position): number {
  return available.filter((p) => p.position === pos && p.value >= STARTER_VALUE_FLOOR).length;
}

function classify(
  team: RawTeam,
  needs: PositionNeed[],
  available: AvailablePlayer[]
): BehavioralRead {
  const firstPick = team.pickSlots.length ? team.pickSlots[0] : null;
  const topNeed = needs[0];
  const hasExtraPicks = team.pickSlots.length > STARTING_PICKS_PER_TEAM;
  const hasSurplus = needs.some((n) => n.severity === "surplus");
  const hasCapital = hasExtraPicks || hasSurplus;

  if (firstPick == null) {
    return {
      classification: "move_up",
      reason: "owns no early pick — would have to move up to get into the action",
      confidence: "low",
    };
  }

  const pressing =
    !!topNeed && (topNeed.severity === "critical" || topNeed.severity === "moderate");
  const qualityAtNeed = pressing ? qualityAvailableAt(available, topNeed.position) : 0;
  const qualityRunsOut = pressing && qualityAtNeed > 0 && qualityAtNeed < firstPick;

  if (pressing && qualityRunsOut && hasCapital) {
    return {
      classification: "move_up",
      reason: `${topNeed.position} is their biggest hole and the quality there likely won't last to pick ${firstPick}`,
      confidence: "medium",
    };
  }

  const wantsPicks = team.intent.picksMarket === "buy";
  if ((!pressing && firstPick <= 4) || (wantsPicks && hasSurplus)) {
    return {
      classification: "move_down",
      reason: !pressing
        ? `set across the board — a pick at ${firstPick} is worth more to them as trade capital`
        : `they have surplus to spare and a pick at ${firstPick} can bring more back`,
      confidence: !pressing ? "medium" : "low",
    };
  }

  return {
    classification: "stand_pat",
    reason:
      topNeed && pressing
        ? `picks at ${firstPick} and the value lines up with their ${topNeed.position} need`
        : `picks at ${firstPick} with no reason to move`,
    confidence: "medium",
  };
}

export function buildTeamProfiles(data: LeagueData, ourRosterId: string): TeamProfile[] {
  const profiles: TeamProfile[] = data.teams.map((team) => {
    const needs = computeNeeds(team.roster);
    const behavioral = classify(team, needs, data.available);
    return {
      teamId: team.rosterId,
      teamName: team.teamName,
      isUs: team.rosterId === ourRosterId,
      pickSlots: team.pickSlots,
      firstPick: team.pickSlots.length ? team.pickSlots[0] : null,
      roster: [...team.roster].sort((a, b) => b.value - a.value),
      needs,
      intent: team.intent,
      behavioral,
    };
  });
  profiles.sort((a, b) => (a.firstPick ?? 999) - (b.firstPick ?? 999));
  return profiles;
}