import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { LEAGUE_ID } from "@/infrastructure/config";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { createMemoHandlers } from "./memoHandler";

const handlers = createMemoHandlers({
  leagueId: LEAGUE_ID,
  session: async (request) => (await currentAppSessionFromRequest(request)).session,
  store: {
    async getOwned(id, rosterId) {
      const { client } = getSupabaseAdminClient();
      if (!client) return null;
      const { data } = await client.from("cfc_director_memos").select("*")
        .eq("id", id).eq("team_id", rosterId).maybeSingle();
      return data;
    },
    async markOwned(id, rosterId, status) {
      const { client } = getSupabaseAdminClient();
      if (!client) return false;
      const { data, error } = await client.from("cfc_director_memos")
        .update({ status, updated_at: new Date().toISOString() }).eq("id", id)
        .eq("team_id", rosterId).select("id").maybeSingle();
      return !error && Boolean(data);
    },
    async listOwned(rosterId, includeTrashed, includeArchived) {
      const { client } = getSupabaseAdminClient();
      if (!client) return [];
      let query = client.from("cfc_director_memos").select("*").eq("team_id", rosterId)
        .order("created_at", { ascending: false });
      if (!includeTrashed) query = query.neq("status", "trashed");
      if (!includeArchived) query = query.neq("status", "archived");
      const { data } = await query;
      return data ?? [];
    },
    async bulkMarkOwned(ids, rosterId, status) {
      const { client } = getSupabaseAdminClient();
      if (!client) return 0;
      const { data, error } = await client.from("cfc_director_memos")
        .update({ status, updated_at: new Date().toISOString() }).in("id", ids)
        .eq("team_id", rosterId).select("id");
      if (error) return 0;
      return data?.length ?? 0;
    },
  },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
