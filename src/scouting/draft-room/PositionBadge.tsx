import type { CSSProperties } from "react";

type Props = {
  position: string;
  label?: string;
  style?: CSSProperties;
};

export function getPositionClass(position: string) {
  const upper = (position || "").toUpperCase();
  if (upper === "QB") return "cfc-pos cfc-pos-qb";
  if (upper === "RB") return "cfc-pos cfc-pos-rb";
  if (upper === "WR") return "cfc-pos cfc-pos-wr";
  if (upper === "TE") return "cfc-pos cfc-pos-te";
  return "cfc-pos cfc-pos-flex";
}

export function PositionBadge({ position, label, style }: Props) {
  return (
    <span className={getPositionClass(position)} style={style}>
      {label ?? position}
    </span>
  );
}
