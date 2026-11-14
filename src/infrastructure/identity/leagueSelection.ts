import { supabase } from "@/infrastructure/supabase/client";

export type LeagueChoice = { leagueId: string; rosterId: string; role: string };
async function providerHeaders() {
  if (!supabase) throw new Error("Sign in again to select a league.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in again to select a league.");
  return { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" };
}
export async function listLeagueChoices(): Promise<LeagueChoice[]> {
  const response = await fetch("/api/auth/leagues", { headers: await providerHeaders(), cache: "no-store" });
  const json = await response.json();
  if (!response.ok || !Array.isArray(json.leagues)) throw new Error("Unable to load your league memberships.");
  return json.leagues;
}
export async function finalizeLeagueSession(leagueId?: string): Promise<{ redirect?: string; leagues?: LeagueChoice[] }> {
  const response = await fetch("/api/auth/finalize", {
    method: "POST", headers: await providerHeaders(), body: JSON.stringify(leagueId ? { leagueId } : {}),
  });
  const json = await response.json();
  if (response.status === 409 && json.error === "league_selection_required" && Array.isArray(json.leagues)) return { leagues: json.leagues };
  if (!response.ok) throw new Error("Unable to select this league. Sign in and try again.");
  return { redirect: typeof json.redirect === "string" && json.redirect.startsWith("/") && !json.redirect.startsWith("//") ? json.redirect : "/" };
}
