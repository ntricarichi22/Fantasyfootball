export type AttachmentLevel = "untouchable" | "core_piece" | "listening" | "moveable";

// Order top-to-bottom on the back-face picker: most protected → most available.
export const AVAILABILITY_ORDER: AttachmentLevel[] = [
  "untouchable",
  "core_piece",
  "listening",
  "moveable",
];

// Locked color system. Listening uses black text (yellow + white is unreadable).
// `dark` is the deep stop of the same hue, used for duotone silhouettes and
// the big round ordinal on pick cards (mirrors the big board's TierColor.dark).
export const AVAILABILITY_CONFIG: Record<
  AttachmentLevel,
  { label: string; fill: string; text: string; dark: string }
> = {
  untouchable: { label: "UNTOUCHABLE", fill: "#E8503A", text: "#FEFCF9", dark: "#5C150C" },
  core_piece: { label: "CORE PIECE", fill: "#3366CC", text: "#FEFCF9", dark: "#0D2A5C" },
  listening: { label: "LISTENING", fill: "#F5C230", text: "#1A1A1A", dark: "#7A5F0A" },
  moveable: { label: "MOVEABLE", fill: "#019942", text: "#FEFCF9", dark: "#0A4423" },
};

export const POSITION_FULL_NAME: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  K: "Kicker",
  DEF: "Defense",
};

export const NFL_TEAM_FULL_NAME: Record<string, string> = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

export type PickCounts = { firsts: number; seconds: number; thirds: number };
export type PickAnchors = { first: number; second: number; third: number };

// Fallback only — real anchors come from the trade-chart endpoint on load.
export const DEFAULT_PICK_ANCHORS: PickAnchors = { first: 3000, second: 1000, third: 350 };

const roundToTwo = (v: number) => Math.round(v * 100) / 100;

// Dollar value -> pick counts (greedy: max firsts, then seconds, then thirds; remainder dropped).
export const decomposeToPicks = (value: number, anchors: PickAnchors): PickCounts => {
  const firsts = Math.floor(value / anchors.first);
  const afterFirst = value - firsts * anchors.first;
  const seconds = Math.floor(afterFirst / anchors.second);
  const afterSecond = afterFirst - seconds * anchors.second;
  const thirds = Math.floor(afterSecond / anchors.third);
  return { firsts, seconds, thirds };
};

// Pick counts -> dollar value.
export const composeFromPicks = (picks: PickCounts, anchors: PickAnchors): number =>
  roundToTwo(
    picks.firsts * anchors.first +
      picks.seconds * anchors.second +
      picks.thirds * anchors.third,
  );

export const formatDollars = (value: number): string =>
  `$${Math.round(value).toLocaleString()}`;

// Maps legacy attachment values to the current set; null/unknown defaults to listening.
export const normalizeAttachment = (value: string | null | undefined): AttachmentLevel => {
  if (!value) return "listening";
  const map: Record<string, AttachmentLevel> = {
    love_my_guys: "untouchable",
    prefer_to_keep_them: "core_piece",
    neutral: "listening",
    ready_to_shake_it_up: "moveable",
    untouchable: "untouchable",
    core_piece: "core_piece",
    listening: "listening",
    moveable: "moveable",
  };
  return map[value.toLowerCase().trim()] ?? "listening";
};