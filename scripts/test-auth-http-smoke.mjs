import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { extractMailpitVerificationUrl, selectMailpitMessage } from "./lib/mailpit.mjs";

const base = process.env.APP_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.LOCAL_DATABASE_URL;
const phase = process.env.SMOKE_PHASE ?? "current";
const inbucketUrl = process.env.INBUCKET_URL;
const stateFile = process.env.SMOKE_STATE_FILE;
for (const [name, value] of Object.entries({ base, supabaseUrl, anonKey, serviceKey, databaseUrl })) {
  if (!value) throw new Error(`Missing disposable smoke configuration: ${name}`);
}
assert.ok(["legacy", "upgrade", "current"].includes(phase), "SMOKE_PHASE must be legacy or current");
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const pool = new pg.Pool({ connectionString: databaseUrl });
const league = "ci-security-league";
const password = "Fixture-Password-123!";
const newPassword = "Fixture-Password-456!";
const emails = {
  member: "member.auth-smoke@example.invalid",
  counterpart: "counterpart.auth-smoke@example.invalid",
  commissioner: "commissioner.auth-smoke@example.invalid",
  outsider: "outsider.auth-smoke@example.invalid",
};

async function app(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
async function post(path, body, headers) {
  return app(path, { method: "POST", body: JSON.stringify(body), headers });
}
async function createConfirmed(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("fixture user not created");
  return data.user;
}
async function login(email, candidate = password) {
  const result = await post("/api/auth/login", { email, password: candidate });
  return result;
}
async function finalize(accessToken) {
  return post("/api/auth/finalize", {}, { authorization: `Bearer ${accessToken}` });
}
function appCookie(response) {
  const value = response.headers.get("set-cookie")?.match(/cfc_session=([^;]+)/)?.[1];
  assert.ok(value, "finalize must issue signed HttpOnly application session");
  return `cfc_session=${value}`;
}
function signSession(userId, leagueId, rosterId, role = "member") {
  const payload = Buffer.from(JSON.stringify({ userId, leagueId, rosterId, role,
    expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SESSION_SECRET).update(payload).digest("base64url");
  return `cfc_session=${payload}.${signature}`;
}
async function confirmationLink(email) {
  assert.ok(inbucketUrl, "disposable Mailpit URL is required");
  for (let attempt = 0; attempt < 30; attempt++) {
    const messagesResponse = await fetch(`${inbucketUrl}/api/v1/messages`);
    if (messagesResponse.ok) {
      const message = selectMailpitMessage(await messagesResponse.json(), email);
      const id = message?.ID ?? message?.id;
      if (id) {
        const detailResponse = await fetch(`${inbucketUrl}/api/v1/message/${encodeURIComponent(id)}`);
        if (detailResponse.ok) {
          const link = extractMailpitVerificationUrl(await detailResponse.json());
          if (link) {
            assert.equal(new URL(link).origin, new URL(supabaseUrl).origin,
              "confirmation verification must stay on the disposable Supabase origin");
            return link;
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Synthetic confirmation email did not reach local Mailpit");
}

async function run() {
try {
  await pool.query("INSERT INTO public.draft_state(league_id) VALUES ($1) ON CONFLICT (league_id) DO NOTHING", [league]);
  await pool.query(`INSERT INTO public.team_email_map(email,roster_id,team_name,profile_complete) VALUES
    ($1,'1','Fixture Member',true),($2,'2','Fixture Counterpart',true),($3,'3','Fixture Commissioner',true)
    ON CONFLICT (email) DO NOTHING`, [emails.member, emails.counterpart, emails.commissioner]);

  if (phase === "legacy") {
    const legacyUser = await createConfirmed(emails.member);
    const unauthenticated = await app("/api/inbox/threads?teamId=1");
    assert.equal(unauthenticated.response.status, 401, "schema-011 protected read rejects no cookie");
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: "cfc_session=forged.payload" } })).response.status,
      401, "schema-011 protected read rejects a forged cookie");
    const legacyLogin = await login(emails.member);
    assert.equal(legacyLogin.response.status, 200, "mapped confirmed schema-011 user can log in");
    const legacyFinalize = await finalize(legacyLogin.body.accessToken);
    assert.equal(legacyFinalize.response.status, 200, "schema-011 exact missing-membership compatibility finalizes");
    const legacyCookie = appCookie(legacyFinalize.response);
    assert.ok(stateFile, "staged rollout state file is required");
    await writeFile(stateFile, JSON.stringify({ cookie: legacyCookie, userId: legacyUser.id }), { mode: 0o600 });
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: legacyCookie } })).response.status,
      200, "schema-011 compatibility session can read its own resource");
    assert.equal((await app("/api/inbox/threads?teamId=2", { headers: { cookie: legacyCookie } })).response.status,
      403, "schema-011 compatibility session cannot read another roster");
    assert.equal((await app("/api/ai/quota", { headers: { cookie: legacyCookie } })).response.status,
      503, "AI fails closed before accounting migration 013 exists");
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: `${legacyCookie}x` } })).response.status,
      401, "schema-011 protected read rejects a tampered signed cookie");
    assert.ok(legacyUser.id);
    console.log("Disposable schema-011 compatibility smoke checks passed.");
    return;
  }

  if (phase === "upgrade") {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
    assert.ifError(listed.error);
    const member = listed.data.users.find((user) => user.email === emails.member);
    assert.ok(member, "schema-011 Auth fixture survives incremental migration");
    const preserved = await pool.query(`SELECT
      (SELECT count(*)::int FROM public.team_email_map WHERE email=$1 AND roster_id='1') AS mapping_count,
      (SELECT count(*)::int FROM public.draft_state WHERE league_id=$2) AS draft_count,
      (SELECT count(*)::int FROM public.league_memberships WHERE user_id=$3 AND league_id=$2 AND roster_id='1' AND role='member') AS membership_count,
      (SELECT count(*)::int FROM public.league_invitations WHERE accepted_by=$3 AND league_id=$2 AND roster_id='1') AS invitation_count`,
      [emails.member, league, member.id]);
    assert.deepEqual(preserved.rows[0], { mapping_count: 1, draft_count: 1, membership_count: 1, invitation_count: 1 },
      "incremental 012-017 migration preserves fixtures and backfills membership/invitation state");
    assert.ok(stateFile, "staged rollout state file is required");
    const legacyState = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(legacyState.userId, member.id);
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: legacyState.cookie } })).response.status,
      200, "schema-011 compatibility cookie remains valid after membership backfill");
    const upgradedLogin = await login(emails.member);
    assert.equal(upgradedLogin.response.status, 200);
    const upgradedFinal = await finalize(upgradedLogin.body.accessToken);
    assert.equal(upgradedFinal.response.status, 200);
    const upgradedCookie = appCookie(upgradedFinal.response);
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: upgradedCookie } })).response.status, 200);
    assert.equal((await app("/api/inbox/threads?teamId=2", { headers: { cookie: upgradedCookie } })).response.status, 403);
    assert.equal((await app("/api/ai/quota", { headers: { cookie: upgradedCookie } })).response.status, 200,
      "AI accounting becomes available after incremental migration 013");
    console.log("Disposable incremental schema-011 to schema-017 smoke checks passed.");
    return;
  }

  const outsiderSignup = await post("/api/auth/signup", { email: emails.outsider, password });
  assert.equal(outsiderSignup.response.status, 403, "non-invited signup must fail at the application boundary");

  const memberSignup = await post("/api/auth/signup", { email: emails.member, password });
  assert.equal(memberSignup.response.status, 200);
  assert.equal(memberSignup.body.confirmationRequired, true, "signup must require mailbox confirmation");
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  assert.ifError(listed.error);
  const member = listed.data.users.find((user) => user.email === emails.member);
  assert.ok(member && !member.email_confirmed_at, "new account starts unconfirmed");
  assert.equal((await login(emails.member)).response.status, 401, "unconfirmed account cannot log in");
  const verifyUrl = await confirmationLink(emails.member);
  const verified = await fetch(verifyUrl, { redirect: "manual" });
  assert.ok([301, 302, 303, 307, 308].includes(verified.status), "confirmation token redirects to the application");
  const callback = new URL(verified.headers.get("location"), base);
  assert.equal(callback.origin, new URL(base).origin, "confirmation token returns only to the fixture application");
  assert.equal((await fetch(callback)).status, 200, "application confirmation redirect is reachable");
  const confirmed = await admin.auth.admin.getUserById(member.id);
  assert.ok(confirmed.data.user?.email_confirmed_at, "real local confirmation token confirms the account");

  const counterpart = await createConfirmed(emails.counterpart);
  const commissioner = await createConfirmed(emails.commissioner);
  await pool.query(`INSERT INTO public.league_memberships(user_id,league_id,roster_id,role) VALUES
    ($1,$3,'2','member'),($2,$3,'3','commissioner')`, [counterpart.id, commissioner.id, league]);
  await pool.query("INSERT INTO public.league_invitations(league_id,email,roster_id) VALUES ($1,$2,'1')", [league, emails.member]);

  const memberLogin = await login(emails.member);
  assert.equal(memberLogin.response.status, 200);
  const memberFinal = await finalize(memberLogin.body.accessToken);
  assert.equal(memberFinal.response.status, 200, "confirmed explicit invite can finalize");
  const memberCookie = appCookie(memberFinal.response);

  assert.equal((await app("/api/ai/quota")).response.status, 401, "protected route rejects an unauthenticated request");
  assert.equal((await app("/api/ai/quota", { headers: { cookie: "cfc_session=forged.payload" } })).response.status,
    401, "protected route rejects a forged cookie");
  assert.equal((await app("/api/ai/quota", { headers: { cookie: `${memberCookie}x` } })).response.status,
    401, "protected route rejects a tampered signed cookie");
  const wrongLeagueCookie = signSession(member.id, "ci-other-league", "1");
  assert.equal((await app("/api/ai/quota", { headers: { cookie: wrongLeagueCookie } })).response.status,
    401, "current membership lookup rejects a validly signed cross-league claim");

  const ownQuota = await app("/api/ai/quota", { headers: { cookie: memberCookie } });
  assert.equal(ownQuota.response.status, 200, "current membership authorizes a protected route");
  const foreignThreads = await app("/api/inbox/threads?teamId=2", { headers: { cookie: memberCookie } });
  assert.equal(foreignThreads.response.status, 403, "member cannot read another roster's threads");
  assert.equal((await app("/api/scouting/mock-draft?teamId=2", { headers: { cookie: memberCookie } })).response.status,
    403, "mock draft rejects a foreign roster before loading league data");
  assert.equal((await post("/api/scouting/mock-draft/trade-up", { teamId: "2" }, { cookie: memberCookie })).response.status,
    403, "trade-up adapter rejects a foreign roster");
  assert.equal((await post("/api/scouting/mock-draft/trade-back", { teamId: "2" }, { cookie: memberCookie })).response.status,
    403, "trade-back adapter rejects a foreign roster");
  assert.equal((await post("/api/pro-personnel/trade-builder/generate", { team_id: "2" }, { cookie: memberCookie })).response.status,
    403, "builder rejects a foreign roster before constructing a slate");
  assert.equal((await app("/api/research-strategy/class-strength?teamId=2", { headers: { cookie: memberCookie } })).response.status,
    403, "strategy reads reject a foreign roster");
  assert.equal((await app("/api/scouting/draft/state")).response.status, 403,
    "draft state rejects an unauthenticated private read");
  const spoofedThread = await post("/api/inbox/threads", { team_a_id: "1", team_b_id: "2", created_by_team_id: "2" }, { cookie: memberCookie });
  assert.equal(spoofedThread.response.status, 403, "member cannot spoof the thread creator");
  const legitimateThread = await post("/api/inbox/threads", { team_a_id: "1", team_b_id: "2", created_by_team_id: "1" }, { cookie: memberCookie });
  assert.equal(legitimateThread.response.status, 200, "real counterpart thread succeeds");
  const unrelated = await pool.query(`INSERT INTO public.trade_threads
    (league_id,team_a_id,team_b_id,created_by_team_id) VALUES ($1,'2','3','2') RETURNING id`, [league]);
  const unrelatedOffer = await pool.query(`INSERT INTO public.trade_offers
    (league_id,from_team_id,to_team_id,assets_from,assets_to,from_value,to_value,grade_label,status,thread_id)
    VALUES ($1,'2','3',$2,$3,1,1,'Private marker','pending',$4) RETURNING id`,
    [league, JSON.stringify([{ key: "player:private-a", label: "PRIVATE-ASSET-A", type: "player" }]),
      JSON.stringify([{ key: "player:private-b", label: "PRIVATE-ASSET-B", type: "player" }]), unrelated.rows[0].id]);
  const invalidTradeTab = await app("/api/inbox/trades/list?teamId=1&tab=everything", { headers: { cookie: memberCookie } });
  assert.equal(invalidTradeTab.response.status, 400, "unknown trade tabs fail before a service-role query");
  assert.doesNotMatch(JSON.stringify(invalidTradeTab.body), /PRIVATE-ASSET/, "invalid tabs disclose no unrelated assets");
  assert.equal((await app("/api/inbox/trades/list?teamId=1&tab=", { headers: { cookie: memberCookie } })).response.status,
    400, "empty trade tabs are rejected");
  assert.equal((await app("/api/inbox/trades/list?teamId=1&tab=%00sent", { headers: { cookie: memberCookie } })).response.status,
    400, "malformed trade tabs are rejected");
  const ownInbox = await app("/api/inbox/trades/list?teamId=1&tab=inbox", { headers: { cookie: memberCookie } });
  assert.equal(ownInbox.response.status, 200);
  assert.doesNotMatch(JSON.stringify(ownInbox.body), /PRIVATE-ASSET/, "owned inbox excludes another pair's offers");
  const foreignOffer = await app(`/api/inbox/trades/list?offerId=${unrelatedOffer.rows[0].id}`, { headers: { cookie: memberCookie } });
  assert.equal(foreignOffer.response.status, 404, "single-offer reads reject nonparticipants without enumeration");
  assert.doesNotMatch(JSON.stringify(foreignOffer.body), /PRIVATE-ASSET/, "foreign offer denial exposes no negotiation payload");
  const unrelatedCounter = await post("/api/inbox/ai-counter", { thread_id: unrelated.rows[0].id, counter_team_id: "1" }, { cookie: memberCookie });
  assert.equal(unrelatedCounter.response.status, 404, "owned roster plus unrelated thread receives non-enumerating denial");
  const crossLeague = await pool.query(`INSERT INTO public.trade_threads
    (league_id,team_a_id,team_b_id,created_by_team_id) VALUES ('ci-other-league','1','2','1') RETURNING id`);
  assert.equal((await post("/api/inbox/ai-counter", { thread_id: crossLeague.rows[0].id, counter_team_id: "1" }, { cookie: memberCookie })).response.status,
    404, "cross-league counter thread receives the same non-enumerating denial");

  const commissionerLogin = await login(emails.commissioner);
  const commissionerFinal = await finalize(commissionerLogin.body.accessToken);
  const commissionerCookie = appCookie(commissionerFinal.response);
  const commissionerSpoof = await post("/api/inbox/threads", { team_a_id: "2", team_b_id: "3", created_by_team_id: "2" }, { cookie: commissionerCookie });
  assert.equal(commissionerSpoof.response.status, 403, "commissioner cannot impersonate another roster");
  const commissionerOwn = await post("/api/inbox/threads", { team_a_id: "2", team_b_id: "3", created_by_team_id: "3" }, { cookie: commissionerCookie });
  assert.equal(commissionerOwn.response.status, 200, "commissioner retains own-roster functionality");

  const resetLink = await admin.auth.admin.generateLink({ type: "recovery", email: emails.member, options: { redirectTo: `${base}/reset` } });
  assert.ifError(resetLink.error);
  const tokenHash = resetLink.data.properties?.hashed_token;
  assert.ok(tokenHash, "local Auth must generate a recovery token");
  const recovery = await auth.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  assert.ifError(recovery.error);
  assert.ifError((await auth.auth.updateUser({ password: newPassword })).error);
  assert.equal((await login(emails.member, password)).response.status, 401, "old password stops working after recovery");
  const recoveredLogin = await login(emails.member, newPassword);
  assert.equal(recoveredLogin.response.status, 200, "recovered password works through the actual login route");

  assert.ifError((await admin.rpc("revoke_league_access", { p_user_id: member.id, p_league_id: league })).error);
  assert.equal((await app("/api/ai/quota", { headers: { cookie: memberCookie } })).response.status, 401,
    "revocation invalidates an already signed application cookie");
  assert.equal((await finalize(recoveredLogin.body.accessToken)).response.status, 403,
    "consumed invitation cannot recreate revoked membership");

  const logout = await post("/api/auth/logout", {});
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get("set-cookie") ?? "", /cfc_session=;/, "logout clears the application session");
  console.log("Disposable HTTP/Auth smoke checks passed.");
} finally {
  await pool.end();
}
}

await run();
