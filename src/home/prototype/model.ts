import { Activity, ArrowLeftRight, BookOpen, CalendarDays, ClipboardList, GitBranch, History, Landmark, Palette, Shield, SlidersHorizontal, Trophy, Users, Wallet, type LucideIcon } from "lucide-react";

export type RoleId = "coach" | "gm" | "owner" | "league";
export type FeatureId = "matchup" | "roster" | "depth" | "strategy" | "trades" | "draft" | "waivers" | "transactions" | "rules" | "meetings" | "identity" | "standings" | "scores" | "activity" | "history";
export type Role = { id: RoleId; label: string; short: string; headline: string; description: string; image: string; options: { id: FeatureId; label: string; description: string; icon: LucideIcon }[] };
export const roles: Role[] = [
  { id: "coach", label: "Coach", short: "Coach", headline: "Your lineup.\nYour call.", description: "Make every starting spot count.", image: "sideline-v3", options: [
    { id: "matchup", label: "Matchup", description: "Your opponent. Your path to a win.", icon: Shield },
    { id: "roster", label: "Roster", description: "Starters, bench, practice squad & IR.", icon: Users },
    { id: "depth", label: "Depth Chart", description: "Know who’s next in line.", icon: GitBranch },
  ]},
  { id: "gm", label: "GM", short: "GM", headline: "Build for now.\nAnd what’s next.", description: "Turn your vision into a contender.", image: "studio-gm", options: [
    { id: "strategy", label: "Strategy", description: "Set your direction and player values.", icon: SlidersHorizontal },
    { id: "trades", label: "Trades", description: "Build offers. Find your next deal.", icon: ArrowLeftRight },
    { id: "draft", label: "Draft", description: "Scout prospects and manage your picks.", icon: ClipboardList },
    { id: "waivers", label: "Waivers", description: "Find available players and place claims.", icon: Wallet },
    { id: "transactions", label: "Transactions", description: "Active moves and your team’s history.", icon: Activity },
  ]},
  { id: "owner", label: "Owner", short: "Owner", headline: "Your franchise.\nYour legacy.", description: "Shape the team. Shape the league.", image: "studio-owner", options: [
    { id: "rules", label: "League Rules", description: "The rulebook and proposed changes.", icon: BookOpen },
    { id: "meetings", label: "Owners Meetings", description: "Upcoming agendas and past decisions.", icon: Landmark },
    { id: "identity", label: "Team Identity", description: "Your name, crest and home city.", icon: Palette },
  ]},
  { id: "league", label: "Around the League", short: "League", headline: "Every matchup.\nEvery storyline.", description: "Keep your eyes on the competition.", image: "league-v3", options: [
    { id: "standings", label: "Standings", description: "Track the race to the playoffs.", icon: Trophy },
    { id: "scores", label: "Scores", description: "The schedule, matchups and box scores.", icon: CalendarDays },
    { id: "activity", label: "League Activity", description: "Follow moves across all twelve teams.", icon: Activity },
    { id: "history", label: "League History", description: "Seasons, champions and rivalries.", icon: History },
  ]},
];
export const defaults: Record<RoleId, FeatureId> = { coach: "matchup", gm: "strategy", owner: "rules", league: "scores" };
export const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "SF"];
export type Group = "Starters" | "Bench" | "Practice Squad" | "IR";
export type Availability = "Untouchable" | "Core piece" | "Listening" | "Moveable";
export type Player = { id: string; name: string; position: string; group: Group; slot?: string; points: number; condition?: string; bye: number; availability: Availability; asking: string };
const player = (id: string, name: string, position: string, group: Group, points: number, bye: number, slot?: string, condition?: string): Player => ({ id, name, position, group, points, bye, slot, condition, availability: id === "allen" ? "Untouchable" : ["bijan", "jefferson"].includes(id) ? "Core piece" : "Listening", asking: "2027 1st + 2027 2nd" });
// All identities, statuses, projections, budgets and events below are illustrative, not live football data.
export const initialPlayers: Player[] = [
  player("allen", "Josh Allen", "QB", "Starters", 24.6, 8, "QB"),
  player("bijan", "Bijan Robinson", "RB", "Starters", 18.2, 12, "RB1", "Questionable"),
  player("hall", "Breece Hall", "RB", "Starters", 16.1, 9, "RB2"),
  player("jefferson", "Justin Jefferson", "WR", "Starters", 19.4, 6, "WR1"),
  player("olave", "Chris Olave", "WR", "Starters", 0, 4, "WR2", "Bye"),
  player("mcbride", "Trey McBride", "TE", "Starters", 13.1, 11, "TE"),
  player("love", "Jordan Love", "QB", "Starters", 20.1, 10, "SF"),
  player("cook", "James Cook", "RB", "Bench", 14.5, 8),
  player("metcalf", "DK Metcalf", "WR", "Bench", 13.8, 7),
  player("flowers", "Zay Flowers", "WR", "Bench", 12.3, 14),
  player("reed", "Jayden Reed", "WR", "Bench", 11.7, 10),
  player("robinson", "Brian Robinson", "RB", "Bench", 10.9, 13),
  player("purdy", "Brock Purdy", "QB", "Bench", 19.1, 9),
  player("kincaid", "Dalton Kincaid", "TE", "Bench", 9.2, 8),
  player("bigsby", "Tank Bigsby", "RB", "Bench", 7.8, 8),
  player("downs", "Josh Downs", "WR", "Bench", 9.1, 11),
  player("shaheed", "Rashid Shaheed", "WR", "Bench", 8.9, 4),
  player("charbonnet", "Zach Charbonnet", "RB", "Bench", 8.5, 7),
  player("lawrence", "Trevor Lawrence", "QB", "Bench", 17.4, 8),
  player("doubs", "Romeo Doubs", "WR", "Bench", 8.1, 10),
  player("johnson", "Juwan Johnson", "TE", "Bench", 6.2, 4),
  player("judkins", "Quinshon Judkins", "RB", "Practice Squad", 7.1, 9),
  player("mcmillan", "Tetairoa McMillan", "WR", "Practice Squad", 9.4, 14),
  player("loveland", "Colston Loveland", "TE", "Practice Squad", 5.6, 5),
  player("aiyuk", "Brandon Aiyuk", "WR", "IR", 0, 9, undefined, "IR"),
  player("brooks", "Jonathon Brooks", "RB", "IR", 0, 14, undefined, "IR"),
];
export const freeAgents = [
  { id: "mooney", name: "Darnell Mooney", position: "WR", points: 10.4, trend: "+18%", note: "A FLEX option for this week" },
  { id: "allgeier", name: "Tyler Allgeier", position: "RB", points: 7.8, trend: "+9%", note: "Depth behind your starting back" },
  { id: "otton", name: "Cade Otton", position: "TE", points: 8.3, trend: "+12%", note: "Coverage for a future bye week" },
  { id: "geno", name: "Geno Smith", position: "QB", points: 16.7, trend: "+6%", note: "Superflex insurance" },
];
export type Transaction = { id: string; title: string; detail: string; type: "Trade" | "Waiver" | "Add / drop"; status: "Pending" | "Completed" | "Declined" | "Withdrawn"; date: string; bid?: number };
export const initialTransactions: Transaction[] = [
  { id: "trade-in", title: "Offer from the Wingmen", detail: "James Cook for a 2027 1st · awaiting your response", type: "Trade", status: "Pending", date: "Today" },
  { id: "past-waiver", title: "Added Josh Downs", detail: "$7 salary cap used · dropped a bench WR", type: "Waiver", status: "Completed", date: "Sep 23" },
  { id: "past-trade", title: "Trade with the Browns", detail: "Acquired a 2027 2nd for a 2028 2nd + 3rd", type: "Trade", status: "Completed", date: "Sep 18" },
];
export const teams = [
  { name: "Founders", crest: "founders", record: "3–0", points: "392.4", streak: "W3" },
  { name: "Browns", crest: "browns", record: "2–1", points: "376.8", streak: "W2" },
  { name: "Wingmen", crest: "wingmen", record: "2–1", points: "361.2", streak: "W1" },
  { name: "Destroyers", crest: "destroyers", record: "2–1", points: "344.7", streak: "W1" },
  ...["Outlaws", "Wolves", "Kings", "Renegades", "Grizzlies", "Thunder", "Knights", "Titans"].map((name, i) => ({ name, crest: "", record: i < 2 ? "2–1" : i < 7 ? "1–2" : "0–3", points: (331.4 - i * 11.7).toFixed(1), streak: "L1" })),
];
export const initialRules = [
  { title: "Roster & starting lineup", text: "25-player roster limit. Start 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX and 1 superflex. This sample league supports 3 practice-squad and 2 IR designations within the roster limit." },
  { title: "Scoring", text: "Half PPR: 0.5 points per reception, 1 point per 10 rushing or receiving yards, and 6 per rushing or receiving touchdown. Passing: 1 per 25 yards, 4 per touchdown, −2 per interception." },
  { title: "Salary cap & waivers", text: "$100 annual salary cap for player claims. Waivers process Wednesday at 8 PM ET in this sample calendar. Pending bids do not reduce the displayed remaining cap until a claim completes." },
  { title: "Trading & draft picks", text: "Players and future rookie picks may be traded. Accepted trades must leave both teams with legal rosters. This preview never submits or executes a real trade." },
];
export const featureRole = (feature: FeatureId) => roles.find((r) => r.options.some((o) => o.id === feature))!.id;
