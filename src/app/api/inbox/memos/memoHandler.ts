import { NextResponse } from "next/server.js";
import type { AppSession } from "../../../../infrastructure/auth/session.ts";

type Memo = { id: string; status: string; [key: string]: unknown };
export type MemoStore = {
  getOwned(id: string, rosterId: string): Promise<Memo | null>;
  markOwned(id: string, rosterId: string, status: string): Promise<boolean>;
  listOwned(rosterId: string, includeTrashed: boolean, includeArchived: boolean): Promise<Memo[]>;
  bulkMarkOwned(ids: string[], rosterId: string, status: string): Promise<number>;
};
export type MemoHandlerDependencies = {
  leagueId: string;
  session(request: Request): Promise<AppSession | null>;
  store: MemoStore;
};
const VALID_STATUSES = ["unread", "read", "archived", "trashed"];

export function createMemoHandlers(deps: MemoHandlerDependencies) {
  async function authorized(request: Request) {
    const session = await deps.session(request);
    return session && deps.leagueId && session.leagueId === deps.leagueId ? session : null;
  }
  return {
    GET: async (request: Request) => {
      const session = await authorized(request);
      if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
      const url = new URL(request.url);
      const claimedTeam = url.searchParams.get("teamId");
      if (claimedTeam && claimedTeam !== session.rosterId)
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      const id = url.searchParams.get("id");
      if (id) {
        const memo = await deps.store.getOwned(id, session.rosterId);
        if (!memo) return NextResponse.json({ error: "Memo not found" }, { status: 404 });
        if (memo.status === "unread") {
          if (!await deps.store.markOwned(id, session.rosterId, "read"))
            return NextResponse.json({ error: "Memo not found" }, { status: 404 });
          memo.status = "read";
        }
        return NextResponse.json({ memo });
      }
      const memos = await deps.store.listOwned(session.rosterId,
        url.searchParams.get("includeTrashed") === "1", url.searchParams.get("includeArchived") === "1");
      return NextResponse.json({ memos });
    },
    POST: async (request: Request) => {
      const session = await authorized(request);
      if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
      const body = await request.json().catch(() => ({})) as { id?: unknown; ids?: unknown; status?: unknown };
      if (typeof body.status !== "string" || !VALID_STATUSES.includes(body.status))
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string")
        : typeof body.id === "string" ? [body.id] : [];
      if (!ids.length || ids.length > 100) return NextResponse.json({ error: "id or ids required" }, { status: 400 });
      const updated = await deps.store.bulkMarkOwned(ids, session.rosterId, body.status);
      return NextResponse.json({ ok: true, updated });
    },
  };
}
