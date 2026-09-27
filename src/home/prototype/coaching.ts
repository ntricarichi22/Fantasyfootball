import type { Player, Group } from "./model";
import { lineupSlots, subLimit, demoLeague, type Slot } from "./leagueFixture";
export const isLocked = (p: Player, now: number) => p.kickoff <= now;
export const subs = (players: Player[]) =>
  players
    .filter((p) => p.group === "Subs")
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
export const eligible = (p: Player, slot: Slot) =>
  slot.positions.includes(p.position) &&
  p.condition !== "IR" &&
  p.condition !== "Bye";
export function projectionInsert(
  players: Player[],
  id: string,
  now: number,
): Player[] {
  const incoming = players.find((p) => p.id === id)!;
  const fixed = subs(players).filter((p) => p.id !== id && isLocked(p, now));
  const movable = subs(players).filter((p) => p.id !== id && !isLocked(p, now));
  const at = movable.findIndex((p) => p.points < incoming.points);
  movable.splice(at < 0 ? movable.length : at, 0, incoming);
  const open = Array.from({ length: subLimit }, (_, i) => i + 1).filter(
    (n) => !fixed.some((p) => p.rank === n),
  );
  const ranks = new Map(movable.map((p, i) => [p.id, open[i]]));
  return players.map((p) =>
    ranks.has(p.id) ? { ...p, rank: ranks.get(p.id) } : p,
  );
}
export function movePlayer(
  players: Player[],
  id: string,
  destination: string,
  now: number,
): { players: Player[]; error?: string } {
  const p = players.find((x) => x.id === id);
  if (!p) return { players, error: "Player not found." };
  if (isLocked(p, now))
    return {
      players,
      error: "This player's game has started. His assignment is locked.",
    };
  const slot = lineupSlots.find((s) => s.id === destination);
  if (slot) {
    if (!eligible(p, slot))
      return {
        players,
        error: "That player is not eligible for " + slot.label + ".",
      };
    const current = players.find(
      (x) => x.group === "Starters" && x.slot === slot.id,
    );
    if (current?.id === id) return { players };
    if (current && isLocked(current, now))
      return { players, error: "The starter in that spot is locked." };
    const oldSlot = lineupSlots.find((s) => s.id === p.slot);
    if (current && oldSlot && !eligible(current, oldSlot))
      return { players, error: "Those starters cannot legally swap slots." };
    const previous = p.group;
    const oldRank = p.rank;
    let next = players.map((x) =>
      x.id === id
        ? { ...x, group: "Starters" as Group, slot: slot.id, rank: undefined }
        : current && x.id === current.id
          ? {
              ...x,
              group: previous,
              slot: oldSlot?.id,
              rank: previous === "Subs" ? oldRank : undefined,
            }
          : x,
    );
    if (current && previous === "Subs")
      next = projectionInsert(next, current.id, now);
    return { players: next };
  }
  const group = destination as Group;
  if (!["Subs", "IR", "Practice Squad"].includes(group))
    return { players, error: "Choose a valid destination." };
  if (p.group === group) return { players };
  const count = players.filter((x) => x.group === group).length;
  if (group === "Subs" && count >= subLimit)
    return {
      players,
      error: "Subs are full. Swap with a starter or free a reserve spot first.",
    };
  if (group === "Practice Squad" && count >= demoLeague.practiceSquadLimit)
    return { players, error: "Practice Squad is full." };
  if (group === "IR" && !p.condition)
    return { players, error: "A healthy player is not eligible for IR." };
  let next = players.map((x) =>
    x.id === id ? { ...x, group, slot: undefined, rank: undefined } : x,
  );
  if (group === "Subs") next = projectionInsert(next, id, now);
  return { players: next };
}
export function swapRanks(
  players: Player[],
  a: string,
  b: string,
  now: number,
): Player[] {
  const pa = players.find((p) => p.id === a),
    pb = players.find((p) => p.id === b);
  if (
    !pa ||
    !pb ||
    pa.group !== "Subs" ||
    pb.group !== "Subs" ||
    isLocked(pa, now) ||
    isLocked(pb, now)
  )
    return players;
  return players.map((p) =>
    p.id === a
      ? { ...p, rank: pb.rank }
      : p.id === b
        ? { ...p, rank: pa.rank }
        : p,
  );
}
export function rankByProjection(players: Player[], now: number): Player[] {
  const ranked = subs(players).filter((p) => !isLocked(p, now));
  const ranks = ranked.map((p) => p.rank!);
  const sorted = [...ranked].sort((a, b) => b.points - a.points);
  const map = new Map(sorted.map((p, i) => [p.id, ranks[i]]));
  return players.map((p) =>
    map.has(p.id) ? { ...p, rank: map.get(p.id) } : p,
  );
}
export type Injury = {
  playerId: string;
  occurred: number;
  cutoff: number;
  clock: string;
  starterPoints: number;
};
export const sampleInjuries: Injury[] = [
  {
    playerId: "bijan",
    occurred: 2,
    cutoff: 2280,
    clock: "Q3 · 7:00",
    starterPoints: 8,
  },
  {
    playerId: "hall",
    occurred: 50,
    cutoff: 240,
    clock: "Q1 · 11:00",
    starterPoints: 3,
  },
];
// Discrete mock scoring plays (elapsed game seconds); never percentage-prorate a real score.
export const samplePlays = (p: Player) => [
  { at: 180, points: 1.2 },
  { at: 900, points: 2.1 },
  { at: 1500, points: 1.8 },
  { at: 2100, points: 3.4 },
  { at: 2520, points: 2.3 },
  { at: 3120, points: 6 },
  { at: 3500, points: Math.round((p.points % 3) * 10) / 10 },
];
export function replacements(
  players: Player[],
  injuries: Injury[],
  now: number,
) {
  const used = new Set<string>();
  const ordered = subs(players);
  return injuries
    .filter((i) => i.occurred <= now)
    .sort((a, b) => a.occurred - b.occurred)
    .flatMap((injury) => {
      const starter = players.find(
        (p) => p.id === injury.playerId && p.group === "Starters",
      );
      const slot = lineupSlots.find((s) => s.id === starter?.slot);
      if (!starter || !slot) return [];
      const backup = ordered.find((p) => !used.has(p.id) && eligible(p, slot));
      const index = backup ? ordered.indexOf(backup) : -1;
      // Higher editable entries may become eligible after lineup changes: keep lower assignments provisional.
      const provisional =
        !backup ||
        !isLocked(backup, now) ||
        ordered.slice(0, index).some((p) => !isLocked(p, now));
      if (backup) used.add(backup.id);
      const points =
        backup && now >= backup.kickoff + 4
          ? samplePlays(backup)
              .filter((play) => play.at > injury.cutoff)
              .reduce((a, p) => a + p.points, 0)
          : null;
      return [{ injury, starter, slot, backup, provisional, points }];
    });
}
