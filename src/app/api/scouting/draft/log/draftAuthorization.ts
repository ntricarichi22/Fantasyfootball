import type { AppSession } from "@/infrastructure/auth/session";

type Pick = { season: number; round: number; slot: number | null };
export type DraftSlot = { rosterId: string; round: number; slot: number; pickNumber: string };

export const canViewUnannouncedPicks = (session: AppSession, leagueId: string) =>
  session.leagueId === leagueId && (session.role === "commissioner" || session.role === "admin");

export function authorizedDraftSlot(
  session: AppSession, leagueId: string, rosterId: string, pickIndex: number,
  teamCount: number, season: number, ownership: Map<string, Pick[]>,
  state: { status: string; current_pick_index?: number | null } | null,
): DraftSlot | null {
  if (session.leagueId !== leagueId || !Number.isSafeInteger(pickIndex) || pickIndex < 0 ||
      !Number.isSafeInteger(teamCount) || teamCount < 1 || !state || state.status !== "running" ||
      state.current_pick_index == null || pickIndex > state.current_pick_index) return null;
  if (session.rosterId !== rosterId && !canViewUnannouncedPicks(session, leagueId)) return null;
  const round = Math.floor(pickIndex / teamCount) + 1;
  const slot = pickIndex % teamCount + 1;
  if (!ownership.get(rosterId)?.some((pick) => pick.season === season && pick.round === round && pick.slot === slot)) return null;
  return { rosterId, round, slot, pickNumber: `${round}.${String(slot).padStart(2, "0")}` };
}

type WriteError = { code?: string; message?: string } | null;
export type DraftSelectionStore = {
  replaceSkipped(): Promise<{ replaced: boolean; error: WriteError }>;
  insert(): Promise<{ error: WriteError }>;
};

// Only an empty skip placeholder may be replaced. A real pick is immutable
// here; commissioner corrections use the explicit DELETE operation.
export async function recordDraftSelection(store: DraftSelectionStore) {
  const replacement = await store.replaceSkipped();
  if (replacement.error) return replacement.error;
  if (replacement.replaced) return null;
  return (await store.insert()).error;
}
