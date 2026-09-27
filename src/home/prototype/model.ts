import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  ClipboardList,
  History,
  Landmark,
  Palette,
  Shield,
  SlidersHorizontal,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { lineupSlots, demoLeague } from "./leagueFixture";
export type RoleId = "coach" | "gm" | "owner" | "league";
export type FeatureId =
  | "matchup"
  | "lineup"
  | "strategy"
  | "trades"
  | "draft"
  | "waivers"
  | "transactions"
  | "rules"
  | "meetings"
  | "identity"
  | "standings"
  | "scores"
  | "activity"
  | "history";
export type Role = {
  id: RoleId;
  label: string;
  headline: string;
  description: string;
  image: string;
  options: {
    id: FeatureId;
    label: string;
    description: string;
    icon: LucideIcon;
  }[];
};
export const roles: Role[] = [
  {
    id: "coach",
    label: "Coach",
    headline: "EVERY SPOT.\nEVERY POINT.",
    description: "Set your starters. Trust your next man up.",
    image: "sideline-v3",
    options: [
      {
        id: "matchup",
        label: "Matchup",
        description: "Your opponent. Your path to a win.",
        icon: Shield,
      },
      {
        id: "lineup",
        label: "Lineup",
        description: "Set your starters. Rank your subs.",
        icon: Users,
      },
    ],
  },
  {
    id: "gm",
    label: "GM",
    headline: "BUILD YOUR\nADVANTAGE.",
    description: "The next great move is yours.",
    image: "studio-gm",
    options: [
      {
        id: "strategy",
        label: "Strategy",
        description: "Know your rooms. Set your priorities.",
        icon: SlidersHorizontal,
      },
      {
        id: "trades",
        label: "Trades",
        description: "Find the deal that changes your season.",
        icon: ArrowLeftRight,
      },
      {
        id: "draft",
        label: "Draft",
        description: "Find the next face of your franchise.",
        icon: ClipboardList,
      },
      {
        id: "waivers",
        label: "Waivers",
        description: "Find your edge in the available talent.",
        icon: Wallet,
      },
      {
        id: "transactions",
        label: "Transaction History",
        description: "Every move. The complete record.",
        icon: History,
      },
    ],
  },
  {
    id: "owner",
    label: "Owner",
    headline: "YOUR LEAGUE.\nYOUR LEGACY.",
    description: "Make your mark on more than the scoreboard.",
    image: "studio-owner",
    options: [
      {
        id: "rules",
        label: "League Rules",
        description: "The playbook for how we compete.",
        icon: BookOpen,
      },
      {
        id: "meetings",
        label: "Owners Meetings",
        description: "A seat at the table. A voice in the league.",
        icon: Landmark,
      },
      {
        id: "identity",
        label: "Team Identity",
        description: "Your city. Your colors. Your franchise.",
        icon: Palette,
      },
    ],
  },
  {
    id: "league",
    label: "League",
    headline: "THE WHOLE\nLEAGUE. LIVE.",
    description: "Every matchup has a story.",
    image: "league-v4",
    options: [
      {
        id: "standings",
        label: "Standings",
        description: "The division race and playoff picture.",
        icon: Trophy,
      },
      {
        id: "scores",
        label: "Scores",
        description: "This week, next week, every box score.",
        icon: CalendarDays,
      },
      {
        id: "activity",
        label: "League Activity",
        description: "Follow the moves around the league.",
        icon: Activity,
      },
      {
        id: "history",
        label: "League History",
        description: "The champions. The moments. The legacy.",
        icon: History,
      },
    ],
  },
];
export type Group = "Starters" | "Subs" | "IR" | "Practice Squad";
export type Availability =
  "Untouchable" | "Core piece" | "Listening" | "Moveable";
export type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  kickoff: number;
  game: string;
  age: number;
  points: number;
  group: Group;
  slot?: string;
  rank?: number;
  condition?: string;
  bye: number;
  availability: Availability;
  asking: string;
};
const make = (
  id: string,
  name: string,
  position: string,
  team: string,
  points: number,
  group: Group,
  i: number,
): Player => ({
  id,
  name,
  position,
  team,
  points,
  group,
  opponent: ["@ BAL", "vs NYJ", "@ DET", "vs PHI", "@ DAL"][i % 5],
  kickoff: i % 3 === 0 ? 40 : i % 3 === 1 ? 44 : 68,
  game: i % 3 === 0 ? "SUN 1:00" : i % 3 === 1 ? "SUN 4:05" : "MON 8:15",
  age: 22 + (i % 8),
  bye: 6 + (i % 8),
  availability: i === 0 ? "Untouchable" : "Listening",
  asking: "2027 1st-round pick",
});
// All schedule, status, projections and events are illustrative.
const starters = [
  make("allen", "Josh Allen", "QB", "BUF", 24.6, "Starters", 0),
  make("love", "Jordan Love", "QB", "GB", 20.1, "Starters", 1),
  make("bijan", "Bijan Robinson", "RB", "ATL", 18.2, "Starters", 2),
  make("jefferson", "Justin Jefferson", "WR", "MIN", 19.4, "Starters", 3),
  make("olave", "Chris Olave", "WR", "NO", 12.7, "Starters", 4),
  make("hall", "Breece Hall", "RB", "NYJ", 16.1, "Starters", 5),
  make("cook", "James Cook", "RB", "BUF", 14.5, "Starters", 6),
  make("mcbride", "Trey McBride", "TE", "ARI", 13.1, "Starters", 7),
  make("metcalf", "DK Metcalf", "WR", "PIT", 13.8, "Starters", 8),
].map((p, i) => ({ ...p, slot: lineupSlots[i]?.id }));
starters[2] = { ...starters[2], kickoff: 0, game: "THU 8:15" };
starters[5] = { ...starters[5], kickoff: 48, game: "SUN 8:20" };
const bench = [
  make("purdy", "Brock Purdy", "QB", "SF", 19.1, "Subs", 0),
  make("lawrence", "Trevor Lawrence", "QB", "JAX", 17.4, "Subs", 1),
  make("flowers", "Zay Flowers", "WR", "BAL", 12.3, "Subs", 2),
  make("reed", "Jayden Reed", "WR", "GB", 11.7, "Subs", 3),
  make("robinson", "Brian Robinson", "RB", "SF", 10.9, "Subs", 4),
  make("kincaid", "Dalton Kincaid", "TE", "BUF", 9.2, "Subs", 5),
  make("downs", "Josh Downs", "WR", "IND", 9.1, "Subs", 6),
  make("bigsby", "Tank Bigsby", "RB", "PHI", 7.8, "Subs", 7),
  make("johnson", "Juwan Johnson", "TE", "NO", 6.2, "Subs", 8),
]
  .sort((a, b) => b.points - a.points)
  .map((p, i) => ({ ...p, rank: i + 1 }));
export const initialPlayers: Player[] = [
  ...starters,
  ...bench,
  make("judkins", "Quinshon Judkins", "RB", "CLE", 7.1, "Practice Squad", 0),
  make("mcmillan", "Tetairoa McMillan", "WR", "CAR", 9.4, "Practice Squad", 1),
  ...[
    ["aiyuk", "Brandon Aiyuk", "WR", "SF"],
    ["brooks", "Jonathon Brooks", "RB", "CAR"],
    ["watson", "Christian Watson", "WR", "GB"],
    ["dell", "Tank Dell", "WR", "HOU"],
    ["mccarthy", "J.J. McCarthy", "QB", "MIN"],
    ["miller", "Kendre Miller", "RB", "NO"],
    ["musgrave", "Luke Musgrave", "TE", "GB"],
  ].map(([id, name, pos, team], i) => ({
    ...make(id, name, pos, team, 0, "IR", i),
    condition: "IR",
  })),
];
export const freeAgents = [
  {
    id: "mooney",
    name: "Darnell Mooney",
    position: "WR",
    team: "ATL",
    points: 10.4,
    age: 28,
    average: 9.8,
    seasonRank: 42,
    rookie: false,
  },
  {
    id: "geno",
    name: "Geno Smith",
    position: "QB",
    team: "LV",
    points: 16.7,
    age: 35,
    average: 17.1,
    seasonRank: 21,
    rookie: false,
  },
  {
    id: "otton",
    name: "Cade Otton",
    position: "TE",
    team: "TB",
    points: 8.3,
    age: 27,
    average: 7.6,
    seasonRank: 16,
    rookie: false,
  },
  {
    id: "allgeier",
    name: "Tyler Allgeier",
    position: "RB",
    team: "ATL",
    points: 7.8,
    age: 26,
    average: 6.4,
    seasonRank: 48,
    rookie: false,
  },
  {
    id: "rookie-wr",
    name: "Malik Carter",
    position: "WR",
    team: "R",
    points: 6.3,
    age: 21,
    average: 5.2,
    seasonRank: 64,
    rookie: true,
  },
  {
    id: "rookie-rb",
    name: "Evan Brooks",
    position: "RB",
    team: "R",
    points: 5.8,
    age: 22,
    average: 4.9,
    seasonRank: 57,
    rookie: true,
  },
].sort((a, b) => b.points - a.points);
export type TransactionAsset = {
  name: string;
  meta?: string;
  portrait?: string;
};
export type Transaction = {
  id: string;
  title: string;
  detail: string;
  type: "Trade" | "Waiver" | "Add" | "Drop";
  status:
    | "Pending"
    | "Accepted"
    | "Rejected"
    | "Withdrawn"
    | "Successful"
    | "Lost"
    | "Completed";
  date: string;
  note?: string;
  bid?: number;
  partner?: string;
  actor?: string;
  direction?: "sent" | "received";
  received?: TransactionAsset[];
  sent?: TransactionAsset[];
  resolvedAt?: number;
};
export const initialTransactions: Transaction[] = [
  {
    id: "trade-in",
    title: "Offer from the Wingmen",
    detail: "James Cook for 2027 Rd 1 · awaiting your response",
    partner: "Wingmen",
    direction: "received",
    received: [{ name: "2027 Rd 1" }],
    sent: [{ name: "James Cook", meta: "RB · BUF", portrait: "cook" }],
    type: "Trade",
    status: "Pending",
    date: "Today",
  },
  {
    id: "past-waiver",
    title: "Added Josh Downs",
    detail: "Added Josh Downs · Dropped Curtis Samuel",
    bid: 7,
    received: [{ name: "Josh Downs", meta: "WR · IND", portrait: "downs" }],
    sent: [{ name: "Curtis Samuel", meta: "WR · BUF" }],
    resolvedAt: Date.UTC(2026, 8, 23),
    type: "Waiver",
    status: "Successful",
    date: "Sep 23",
  },
  {
    id: "past-trade",
    title: "Trade with the Browns",
    detail: "2027 Rd 2 for 2028 Rd 2 and 2028 Rd 3",
    partner: "Browns",
    received: [{ name: "2027 Rd 2" }],
    sent: [{ name: "2028 Rd 2", meta: "(via Browns)" }, { name: "2028 Rd 3" }],
    resolvedAt: Date.UTC(2026, 8, 18),
    type: "Trade",
    status: "Accepted",
    date: "Sep 18",
  },
  {
    id: "rejected",
    title: "Offer to the Destroyers",
    detail: "2027 Rd 2 for Ladd McConkey",
    partner: "Destroyers",
    actor: "Destroyers",
    received: [{ name: "Ladd McConkey", meta: "WR · LAC" }],
    sent: [{ name: "2027 Rd 2" }],
    resolvedAt: Date.UTC(2026, 8, 16, 15),
    type: "Trade",
    status: "Rejected",
    date: "Sep 16",
  },
  {
    id: "lost",
    title: "Claim for a running back",
    detail: "Claim for Tyler Allgeier · Outbid by another team",
    bid: 5,
    received: [
      { name: "Tyler Allgeier", meta: "RB · ATL", portrait: "allgeier" },
    ],
    sent: [],
    resolvedAt: Date.UTC(2026, 8, 16, 8),
    type: "Waiver",
    status: "Lost",
    date: "Sep 16",
  },
  {
    id: "withdrawn",
    title: "Offer to the Browns",
    detail: "Withdrew a pick swap before acceptance",
    partner: "Browns",
    actor: "you",
    received: [{ name: "2027 Rd 2" }],
    sent: [{ name: "2028 Rd 2", meta: "(via Browns)" }],
    resolvedAt: Date.UTC(2026, 8, 14),
    type: "Trade",
    status: "Withdrawn",
    date: "Sep 14",
  },
  {
    id: "direct-drop",
    title: "Dropped Tank Dell",
    detail: "Released from the roster",
    type: "Drop",
    status: "Completed",
    date: "Sep 12",
    received: [],
    sent: [{ name: "Tank Dell", meta: "WR · HOU", portrait: "dell" }],
    resolvedAt: Date.UTC(2026, 8, 12),
  },
];
export const teams = [
  {
    name: "Founders",
    crest: "founders",
    record: "3–0",
    points: 392.4,
    division: "East",
  },
  {
    name: "Browns",
    crest: "browns",
    record: "2–1",
    points: 376.8,
    division: "West",
  },
  {
    name: "Wingmen",
    crest: "wingmen",
    record: "2–1",
    points: 361.2,
    division: "East",
  },
  {
    name: "Destroyers",
    crest: "destroyers",
    record: "2–1",
    points: 344.7,
    division: "West",
  },
  ...[
    "Outlaws",
    "Wolves",
    "Kings",
    "Renegades",
    "Grizzlies",
    "Thunder",
    "Knights",
    "Titans",
  ].map((name, i) => ({
    name,
    crest: [
      "rawdoggers",
      "freaks",
      "kush",
      "onslaught",
      "crossfitters",
      "buschmasters",
      "birdmen",
      "matzos-balls",
    ][i],
    record: i < 2 ? "2–1" : i < 7 ? "1–2" : "0–3",
    points: 331.4 - i * 11.7,
    division: i % 2 ? "West" : "East",
  })),
];
export const initialRules = [
  {
    id: "rosters",
    title: "Rosters & eligibility",
    description: "The places on your team.",
    text:
      "Start " +
      lineupSlots.map((s) => s.label).join(", ") +
      ". Nine Subs, " +
      demoLeague.practiceSquadLimit +
      " Practice Squad spots and unlimited IR spots. Reserve players must be promoted before they can substitute.",
  },
  {
    id: "scoring",
    title: "Scoring",
    description: "Every yard. Every point.",
    text: "Sample half-PPR: 0.5 per reception, 1 per 10 rushing/receiving yards, 6 per rushing/receiving TD. Passing: 1 per 25 yards, 4 per TD, −2 per interception. Substitution scenarios illustrate proposed game-clock scoring, not live results.",
  },
  {
    id: "deadlines",
    title: "Deadlines & waivers",
    description: "Stay one move ahead.",
    text: "Sample salary cap: $100. Waivers process Wednesday at 8 PM ET. Each player's roster assignment and exact substitution rank lock only at their own kickoff. Pending claims do not spend cap.",
  },
  {
    id: "tiebreakers",
    title: "Playoffs & tiebreakers",
    description: "How the race is decided.",
    text: "Six teams qualify. The top two seeds receive a first-round bye in a three-week playoff. Mock seeding uses record, then points for; live seeding must follow the adopted constitution.",
  },
  {
    id: "trading",
    title: "Trades & draft picks",
    description: "Build across generations.",
    text: "Trade players and future rookie picks. Both rosters must remain legal. Owner-set values and strategy are private. The preview does not execute transactions.",
  },
];
export const featureRole = (id: FeatureId): RoleId =>
  roles.find((r) => r.options.some((o) => o.id === id))!.id;
