export function isVisibleNegotiationThread(
  thread: { team_a_id: string; team_b_id: string }, rosterId: string,
): boolean {
  return String(thread.team_a_id) === rosterId || String(thread.team_b_id) === rosterId;
}
