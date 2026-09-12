export type CounterThread = { team_a_id: string; team_b_id: string };

export function isCounterThreadParticipant(thread: CounterThread | null, rosterId: string): boolean {
  return !!thread && (String(thread.team_a_id) === rosterId || String(thread.team_b_id) === rosterId);
}

export function offerBelongsToThreadParticipants(
  thread: CounterThread, offer: { from_team_id: string; to_team_id: string },
): boolean {
  const participants = new Set([String(thread.team_a_id), String(thread.team_b_id)]);
  return participants.has(String(offer.from_team_id)) && participants.has(String(offer.to_team_id));
}
