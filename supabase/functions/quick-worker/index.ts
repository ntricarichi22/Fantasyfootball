import { createBackfillHandler } from "./handler.mjs";

// Legacy JWT verification at the gateway is authentication, not authorization.
// This administrative importer accepts only the server's service-role credential.
Deno.serve(createBackfillHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
}));
