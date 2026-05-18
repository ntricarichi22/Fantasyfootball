import type { CSSProperties } from "react";

import {
  computeCoreTeamStrength,
  type StarterAsset,
} from "@/pro-personnel/trade-engine/starterLevel";
import type { PositionKey, TeamProfile } from "@/pro-personnel/trade-engine/profile";

type Props = {
  ownerProfile: TeamProfile | null;
  starterAssets: StarterAsset[];
  hasEmptyStarterSlot: Record<PositionKey, boolean>;
  teamCount: number;
};

type NeedLevel = "Critical" | "Moderate" | "Low";

const POSITION_BADGE: Record<PositionKey, { bg: string; color: string }> = {
  QB: { bg: "#E8503A", color: "#FFFFFF" },
  RB: { bg: "#3366CC", color: "#FFFFFF" },
  WR: { bg: "#F5C230", color: "#1A1A1A" },
  TE: { bg: "#1A1A1A", color: "#FFFFFF" },
};

const POSITIONS: PositionKey[] = ["RB", "WR", "QB"];

const cardStyle: CSSProperties = {
  background: "#FEFCF9",
  border: "1.5px solid #1A1A1A",
  borderRadius: 0,
};

const cardHeaderStyle: CSSProperties = {
  background: "#F5F0E6",
  borderBottom: "1.5px solid #1A1A1A",
  padding: "7px 12px",
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#1A1A1A",
};

const badgeStyle = (pos: PositionKey): CSSProperties => ({
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: "0.04em",
  background: POSITION_BADGE[pos].bg,
  color: POSITION_BADGE[pos].color,
  border: "1px solid #1A1A1A",
  borderRadius: 0,
  padding: "3px 6px",
  width: 32,
  textAlign: "center",
  flexShrink: 0,
});

const trackStyle: CSSProperties = {
  flex: 1,
  height: 8,
  background: "#EEE7D9",
  border: "1px solid #1A1A1A",
  borderRadius: 0,
  position: "relative",
  overflow: "hidden",
};

const fillStyle = (pct: number): CSSProperties => ({
  height: "100%",
  width: `${Math.max(0, Math.min(100, pct))}%`,
  background: "#E8503A",
  transition: "width 200ms ease",
});

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 10,
  fontWeight: 600,
  color: "#999",
  width: 60,
  flexShrink: 0,
  textAlign: "right",
};

const computeNeed = (
  pos: PositionKey,
  ownerProfile: TeamProfile | null,
  starterAssets: StarterAsset[],
  hasEmptyStarterSlot: Record<PositionKey, boolean>,
  teamCount: number,
): { level: NeedLevel; pct: number } => {
  // Auto-critical if there's an unfilled starting slot at this position.
  if (hasEmptyStarterSlot[pos]) {
    return { level: "Critical", pct: 100 };
  }

  // Use league-relative position rank (1 = best, teamCount = worst).
  const rank = ownerProfile?.positionRanks?.[pos] ?? teamCount;
  const tc = Math.max(teamCount, 1);
  // Higher rank => more critical (more red).
  const pct = Math.round((rank / tc) * 100);

  // Boost if the team's overall starter-level strength at the position is weak
  // (no starter-level assets at all at this position).
  const hasAnyStarter = starterAssets.some(
    (asset) => asset.position === pos && asset.adjustedValue > 0,
  );
  if (!hasAnyStarter) {
    return { level: "Critical", pct: Math.max(pct, 90) };
  }

  if (rank > Math.ceil((tc * 2) / 3)) return { level: "Critical", pct };
  if (rank > Math.ceil(tc / 3)) return { level: "Moderate", pct };
  return { level: "Low", pct };
};

export function TeamNeedsCard({
  ownerProfile,
  starterAssets,
  hasEmptyStarterSlot,
  teamCount,
}: Props) {
  // Reference computeCoreTeamStrength to keep the dependency from
  // build-strategy explicit; also surfaces a simple sanity number we
  // can use for a future tooltip.
  const coreStrength = computeCoreTeamStrength(starterAssets);

  return (
    <div style={cardStyle} aria-label={`Team needs (core strength ${Math.round(coreStrength)})`}>
      <div style={cardHeaderStyle}>Team Needs</div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {POSITIONS.map((pos) => {
          const { level, pct } = computeNeed(
            pos,
            ownerProfile,
            starterAssets,
            hasEmptyStarterSlot,
            teamCount,
          );
          return (
            <div
              key={pos}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
              aria-label={`${pos}: ${level}`}
            >
              <span style={badgeStyle(pos)}>{pos}</span>
              <div style={trackStyle}>
                <div style={fillStyle(pct)} />
              </div>
              <span style={labelStyle}>{level}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
