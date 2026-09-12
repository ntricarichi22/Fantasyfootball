import { getSupabaseClient } from "@/infrastructure/supabase/client";

export async function authenticatedAiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const client = getSupabaseClient();
  const session = client ? await client.auth.getSession() : null;
  const token = session?.data.session?.access_token;
  if (!token) throw new Error("Sign in to use AI features.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
