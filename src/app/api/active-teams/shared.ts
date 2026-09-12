import { ACTIVE_TEAM_TIMEOUT_MS } from "@/infrastructure/identity/activeTeams";
export { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";

export const SESSION_TIMEOUT_MS = ACTIVE_TEAM_TIMEOUT_MS;

export const activeCutoffIso = () => new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();

export const normalizeRosterId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";
