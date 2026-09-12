import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Disposable Supabase Auth configuration is required");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createFixture(label) {
  const suffix = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${suffix}@example.invalid`,
    password: `Fixture-${randomUUID()}!`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`Failed to create ${label} fixture`);
  return data.user.id;
}

const userId = await createFixture("commissioner");
const actorId = await createFixture("operator");
process.stdout.write(`${userId}\n${actorId}\n`);
