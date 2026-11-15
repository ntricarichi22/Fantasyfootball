import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { extractMailpitVerificationUrl, selectMailpitMessage } from "./lib/mailpit.mjs";
import { fixtureIdentityHeaders, appCookie } from "./lib/auth-fixture.mjs";
import { runAuthBrowserSmoke } from "./lib/auth-browser-smoke.mjs";

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
assert.ok(["legacy", "upgrade", "current"].includes(phase), "SMOKE_PHASE must be legacy, upgrade, or current");
for (const endpoint of [databaseUrl, base, supabaseUrl]) {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname),
    "Auth smoke mutations require only disposable loopback services");
}
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const pool = new pg.Pool({ connectionString: databaseUrl });
const league = "1328902558617473024";
const otherLeague = "ci-other-league";
const password = "Fixture-Password-123!";
const newPassword = "Fixture-Password-456!";
const emails = {
  member: "member.auth-smoke@example.invalid",
  counterpart: "counterpart.auth-smoke@example.invalid",
  commissioner: "commissioner.auth-smoke@example.invalid",
  outsider: "outsider.auth-smoke@example.invalid",
};

async function app(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...fixtureIdentityHeaders(init.headers?.cookie), ...(init.headers?.cookie ? { "x-cfc-league-id": league } : {}), ...(init.headers ?? {}) } });
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
async function finalize(accessToken, leagueId = league) {
  return post("/api/auth/finalize", leagueId ? { leagueId } : {}, { authorization: `Bearer ${accessToken}` });
}
function signSession(userId, leagueId, rosterId, role = "member", sessionId = "11111111-1111-4111-8111-111111111111") {
  const payload = Buffer.from(JSON.stringify({ userId, sessionId, leagueId, rosterId, role,
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
  // Legacy fixtures predate the tenant column; final-schema fixtures must name it explicitly.
  if (phase === "legacy") {
    await pool.query(`INSERT INTO public.team_email_map(email,roster_id,team_name,profile_complete) VALUES
      ($1,'1','Fixture Member',true),($2,'2','Fixture Counterpart',true),($3,'3','Fixture Commissioner',true)
      ON CONFLICT (email) DO NOTHING`, [emails.member, emails.counterpart, emails.commissioner]);
  } else if (phase === "current") {
    await pool.query(`INSERT INTO public.team_email_map(league_id,email,roster_id,team_name,profile_complete) VALUES
      ($4,$1,'1','Fixture Member',true),($4,$2,'2','Fixture Counterpart',true),($4,$3,'3','Fixture Commissioner',true)`,
      [emails.member, emails.counterpart, emails.commissioner, league]);
  }

  if (phase === "legacy") {
    const legacyUser = await createConfirmed(emails.member);
    const unauthenticated = await app("/api/inbox/threads?teamId=1");
    assert.equal(unauthenticated.response.status, 401, "schema-011 protected read rejects no cookie");
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: "cfc_session=forged.payload" } })).response.status,
      401, "schema-011 protected read rejects a forged cookie");
    const legacyLogin = await login(emails.member);
    assert.equal(legacyLogin.response.status, 503, "login fails closed without durable rate-limit infrastructure");
    const providerLogin = await auth.auth.signInWithPassword({ email: emails.member, password });
    assert.ifError(providerLogin.error);
    const legacyFinalize = await finalize(providerLogin.data.session.access_token);
    assert.equal(legacyFinalize.response.status, 503, "missing membership schema cannot mint an application session");
    const legacyCookie = signSession(legacyUser.id, league, "1");
    assert.ok(stateFile, "staged rollout state file is required");
    await writeFile(stateFile, JSON.stringify({ userId: legacyUser.id }), { mode: 0o600 });
    const protectedRead = await app("/api/inbox/threads?teamId=1", { headers: { cookie: legacyCookie } });
    assert.ok([401, 503].includes(protectedRead.response.status), "signed cookie cannot bypass missing authorization state");
    console.log("Disposable schema-011 fail-closed smoke checks passed.");
    return;
  }

  let member;
  if (phase === "upgrade") {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
    assert.ifError(listed.error);
    member = listed.data.users.find((user) => user.email === emails.member);
    assert.ok(member, "schema-011 Auth fixture survives incremental migration");
    const preserved = await pool.query(`SELECT
      (SELECT count(*)::int FROM public.team_email_map WHERE email=$1 AND roster_id='1') AS mapping_count,
      (SELECT count(*)::int FROM public.draft_state WHERE league_id=$2) AS draft_count,
      (SELECT count(*)::int FROM public.league_memberships WHERE user_id=$3 AND league_id=$2 AND roster_id='1' AND role='member') AS membership_count,
      (SELECT count(*)::int FROM public.league_invitations WHERE accepted_by=$3 AND league_id=$2 AND roster_id='1') AS invitation_count`,
      [emails.member, league, member.id]);
    assert.deepEqual(preserved.rows[0], { mapping_count: 1, draft_count: 1, membership_count: 1, invitation_count: 1 },
      "incremental migrations preserve fixtures and backfill membership/invitation state");
    assert.ok(stateFile, "staged rollout state file is required");
    const legacyState = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(legacyState.userId, member.id);
    const upgradedLogin = await login(emails.member);
    assert.equal(upgradedLogin.response.status, 200);
    const upgradedFinal = await finalize(upgradedLogin.body.accessToken);
    assert.equal(upgradedFinal.response.status, 200);
    const upgradedCookie = appCookie(upgradedFinal.response);
    assert.equal((await app("/api/inbox/threads?teamId=1", { headers: { cookie: upgradedCookie } })).response.status, 200);
    assert.equal((await app("/api/inbox/threads?teamId=2", { headers: { cookie: upgradedCookie } })).response.status, 403);
    assert.equal((await app("/api/ai/quota", { headers: { cookie: upgradedCookie } })).response.status, 200,
      "AI accounting becomes available after incremental migration 013");
    console.log("Incremental Auth preservation checks passed; continuing through the same tenant/atomic HTTP checks as clean bootstrap.");
  }

  if (phase === "current") {
  const outsiderSignup = await post("/api/auth/signup", { email: emails.outsider, password });
  assert.equal(outsiderSignup.response.status, 200, "signup must not reveal whether an address is invited");

  const memberSignup = await post("/api/auth/signup", { email: emails.member, password });
  assert.equal(memberSignup.response.status, 200);
  assert.equal(memberSignup.body.confirmationRequired, true, "signup must require mailbox confirmation");
  assert.deepEqual(outsiderSignup.body, memberSignup.body, "signup responses cannot enumerate invited addresses");
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  assert.ifError(listed.error);
  assert.equal(listed.data.users.some((user) => user.email === emails.outsider), false, "non-invited signup must not create an account");
  member = listed.data.users.find((user) => user.email === emails.member);
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

  }
  assert.ok(member, "confirmed preserved or newly registered member is required");

  const counterpart = await createConfirmed(emails.counterpart);
  const commissioner = await createConfirmed(emails.commissioner);
  await pool.query(`INSERT INTO public.league_memberships(user_id,league_id,roster_id,role) VALUES
    ($1,$3,'2','member'),($2,$3,'3','commissioner')`, [counterpart.id, commissioner.id, league]);
  if (phase === "current") await pool.query("INSERT INTO public.league_invitations(league_id,email,roster_id) VALUES ($1,$2,'1')", [league, emails.member]);

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
  // Decode only the freshly issued disposable fixture token; application auth verifies tokens server-side.
  const { session_id: memberSessionId } = JSON.parse(Buffer.from(memberLogin.body.accessToken.split(".")[1], "base64url").toString("utf8"));
  assert.match(memberSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const wrongLeagueCookie = signSession(member.id, otherLeague, "1", "member", memberSessionId);
  assert.equal((await app("/api/ai/quota", { headers: { cookie: wrongLeagueCookie, "x-cfc-league-id": otherLeague } })).response.status,
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
  const unauthenticatedDraft = await app("/api/scouting/draft/state");
  assert.ok([401, 403].includes(unauthenticatedDraft.response.status),
    "middleware or route authorization rejects an unauthenticated draft-state read");
  assert.equal(Object.hasOwn(unauthenticatedDraft.body, "data"), false,
    "unauthenticated draft-state response must not expose private data");
  assert.equal((await post("/api/inbox/threads", {}, { cookie: memberCookie })).response.status, 405,
    "standalone thread creation is removed; threads are created only by an atomic offer command");
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
  const staleAccount = await post("/api/team-identity", { teamName: "Wrong Account Rename" }, {
    cookie: commissionerCookie, "x-cfc-user-id": member.id, "x-cfc-roster-id": "1",
  });
  assert.ok([401, 403, 409].includes(staleAccount.response.status), "same-league stale account context cannot rename the current browser account");
  assert.equal((await pool.query("SELECT team_name FROM public.team_email_map WHERE league_id=$1 AND roster_id='3'", [league])).rows[0].team_name, "Fixture Commissioner");
  await pool.query("UPDATE public.league_memberships SET roster_id='4' WHERE user_id=$1 AND league_id=$2", [member.id, league]);
  const staleRoster = await post("/api/onboarding/complete", {}, { cookie: memberCookie });
  assert.ok([401, 403, 409].includes(staleRoster.response.status), "live membership roster changes reject the old signed/display roster before an actor-less write");
  await pool.query("UPDATE public.league_memberships SET roster_id='1' WHERE user_id=$1 AND league_id=$2", [member.id, league]);

  // Run the actual guarded cutover in both clean and incremental fixtures.
  // Bootstrap only the narrowly known synthetic legacy leagues; unexpected data fails the test.
  const pendingLeagues = await pool.query(`SELECT old.league_id FROM
    (SELECT league_id FROM public.draft_state UNION SELECT league_id FROM public.trade_offers) old
    LEFT JOIN public.cfc_league_runtime r USING(league_id) WHERE r.initialized_at IS NULL`);
  const fixtureCommissionerSession = JSON.parse(Buffer.from(commissionerLogin.body.accessToken.split(".")[1], "base64url").toString("utf8")).session_id;
  for (const { league_id: fixtureLeague } of pendingLeagues.rows) {
    assert.ok([league, "ci-security-league"].includes(fixtureLeague), "unexpected legacy league requires its own reviewed fixture snapshot");
    assert.equal((await pool.query("SELECT count(*)::int n FROM public.draft_log WHERE league_id=$1 AND player_id IS NOT NULL", [fixtureLeague])).rows[0].n, 0,
      "legacy actual selections require explicit fixture history, not fabricated source results");
    const fixtureAssets = new Map(["1", "2", "3"].map((roster) => [`pick:2026-1-${roster}`,
      { asset_key: `pick:2026-1-${roster}`, asset_kind: "pick", owner_roster_id: roster, consumed: false }]));
    const offers = await pool.query("SELECT from_team_id,to_team_id,assets_from,assets_to FROM public.trade_offers WHERE league_id=$1", [fixtureLeague]);
    for (const offer of offers.rows) for (const [assets, owner] of [[offer.assets_from, offer.from_team_id], [offer.assets_to, offer.to_team_id]]) {
      for (const asset of assets) {
        assert.match(asset.key, /^(?:player:|pick:)/, "migration must normalize fixture asset keys before cutover");
        const prior = fixtureAssets.get(asset.key);
        if (prior) assert.equal(prior.owner_roster_id, owner, "fixture source ownership must be unambiguous");
        fixtureAssets.set(asset.key, { asset_key: asset.key, asset_kind: asset.key.startsWith("pick:") ? "pick" : "player", owner_roster_id: owner, consumed: false });
      }
    }
    await pool.query("INSERT INTO public.league_memberships(user_id,league_id,roster_id,role) VALUES($1,$2,'3','commissioner') ON CONFLICT(user_id,league_id) DO NOTHING", [commissioner.id, fixtureLeague]);
    const seeded = await admin.rpc("cfc_refresh_runtime_snapshot", {
      p_league_id: fixtureLeague, p_actor_user_id: commissioner.id, p_session_id: fixtureCommissionerSession,
      p_request_id: randomUUID(), p_expected_revision: 0, p_snapshot: {
        observed_at: new Date().toISOString(), roster_ids: ["1", "2", "3"], draft_season: 2026,
        team_count: 3, round_count: 1, pick_seconds: 1800, assets: [...fixtureAssets.values()],
        slots: ["1", "2", "3"].map((roster, index) => ({ pick_index: index, asset_key: `pick:2026-1-${roster}`, round: 1, slot: index + 1 })),
      },
    });
    assert.ifError(seeded.error);
  }
  const cutoverConnection = await pool.connect();
  try {
    await cutoverConnection.query("SET cfc.runtime_cutover='approved'");
    await cutoverConnection.query(await readFile(new URL("../supabase/operations/league_runtime_cutover.sql", import.meta.url), "utf8"));
  } finally { cutoverConnection.release(); }
  assert.equal((await pool.query("SELECT has_column_privilege('service_role','public.trade_offers','status','UPDATE') allowed")).rows[0].allowed, false,
    "HTTP tests run against actual post-cutover domain privileges");

  // Same user and roster identifiers in two leagues catch missing tenant filters.
  await pool.query(`INSERT INTO public.team_email_map(league_id,email,roster_id,team_name,profile_complete) VALUES
    ($4,$1,'1','Other Member',true),($4,$2,'2','Other Counterpart',true),($4,$3,'3','Other Commissioner',true)`,
    [emails.member, emails.counterpart, emails.commissioner, otherLeague]);
  await pool.query(`INSERT INTO public.league_memberships(user_id,league_id,roster_id,role) VALUES
    ($1,$4,'1','member'),($2,$4,'2','member'),($3,$4,'3','commissioner')`,
    [member.id, counterpart.id, commissioner.id, otherLeague]);
  const chooseLeague = await finalize(memberLogin.body.accessToken, null);
  assert.equal(chooseLeague.response.status, 409, "multiple verified memberships require an explicit choice");
  assert.deepEqual(chooseLeague.body.leagues.map((choice) => choice.leagueId).sort(), [league, otherLeague].sort());
  assert.equal((await finalize(memberLogin.body.accessToken, "not-a-member")).response.status, 403);
  const otherFinal = await finalize(memberLogin.body.accessToken, otherLeague);
  assert.equal(otherFinal.response.status, 200);
  const otherCookie = appCookie(otherFinal.response);
  const otherHeaders = { cookie: otherCookie, "x-cfc-league-id": otherLeague };
  assert.equal((await app("/api/ai/quota", { headers: otherHeaders })).response.status, 200,
    "read-only user quota is available independently of league paid-AI capability");
  assert.equal((await app("/api/player-values", { headers: otherHeaders })).response.status, 403,
    "CFC intelligence cannot silently price a different league");
  const staleTab = await post("/api/team-identity", { teamName: "Stale Tab Name" }, { cookie: otherCookie });
  assert.ok([401, 403, 409].includes(staleTab.response.status), "a stale CFC tab cannot mutate the newly selected league");
  assert.equal((await post("/api/team-identity", { teamName: "Other Renamed" }, otherHeaders)).response.status, 200);
  const names = await pool.query("SELECT league_id,team_name FROM public.team_email_map WHERE email=$1 ORDER BY league_id", [emails.member]);
  assert.deepEqual(Object.fromEntries(names.rows.map((row) => [row.league_id, row.team_name])),
    { [league]: "Fixture Member", [otherLeague]: "Other Renamed" }, "rename changes only the selected league's same-numbered roster");
  const foreignMemo = await pool.query(`INSERT INTO public.cfc_director_memos
    (league_id,director_role,team_id,subject,read_body,play_intro,play_mode) VALUES
    ($1,'personnel','1','PRIVATE-OTHER-MEMO','private body','private intro','single_cta') RETURNING id`, [otherLeague]);
  assert.equal((await app(`/api/inbox/memos?id=${foreignMemo.rows[0].id}`, { headers: { cookie: memberCookie } })).response.status, 404);
  const deniedMemoMutation = await post("/api/inbox/memos", { id: foreignMemo.rows[0].id, status: "trashed" }, { cookie: memberCookie });
  assert.equal(deniedMemoMutation.response.status, 200);
  assert.equal(deniedMemoMutation.body.updated, 0, "same roster ID in another league cannot be bulk-mutated");
  assert.equal((await app(`/api/inbox/memos?id=${foreignMemo.rows[0].id}`, { headers: otherHeaders })).response.status, 200);
  assert.ok([403, 409].includes((await app(`/api/team-crest/test?leagueId=${otherLeague}`, { headers: { cookie: memberCookie } })).response.status));

  const foreignTier = await pool.query("INSERT INTO public.cfc_big_board_tiers(league_id,roster_id,tier_order,label) VALUES($1,'1',1,'PRIVATE-OTHER-TIER') RETURNING id", [otherLeague]);
  const tierEdit = await app("/api/scouting/big-board/rankings", { method: "PUT", headers: { cookie: memberCookie },
    body: JSON.stringify({ roster_id: "1", action: "set_tier_label", tier_id: foreignTier.rows[0].id, label: "Tampered" }) });
  assert.equal(tierEdit.response.status, 200);
  assert.equal((await pool.query("SELECT label FROM public.cfc_big_board_tiers WHERE id=$1", [foreignTier.rows[0].id])).rows[0].label,
    "PRIVATE-OTHER-TIER", "same roster ID cannot mutate a foreign-league board tier by UUID");

  const otherCommissioner = await finalize(commissionerLogin.body.accessToken, otherLeague);
  const otherCommissionerHeaders = { cookie: appCookie(otherCommissioner.response), "x-cfc-league-id": otherLeague };
  const counterpartLogin = await login(emails.counterpart);
  const otherCounterpart = await finalize(counterpartLogin.body.accessToken, otherLeague);
  const otherCounterpartHeaders = { cookie: appCookie(otherCounterpart.response), "x-cfc-league-id": otherLeague };
  const commissionerSessionId = JSON.parse(Buffer.from(commissionerLogin.body.accessToken.split(".")[1], "base64url").toString("utf8")).session_id;
  const snapshot = {
    observed_at: new Date().toISOString(), roster_ids: ["1", "2", "3"], draft_season: 2026,
    team_count: 3, round_count: 1, pick_seconds: 1800,
    assets: ["1", "2", "3"].map((roster) => ({ asset_key: `pick:2026-1-${roster}`, asset_kind: "pick", owner_roster_id: roster, consumed: false })),
    slots: ["1", "2", "3"].map((roster, index) => ({ pick_index: index, asset_key: `pick:2026-1-${roster}`, round: 1, slot: index + 1 })),
  };
  const bootstrap = await admin.rpc("cfc_refresh_runtime_snapshot", {
    p_league_id: otherLeague, p_actor_user_id: commissioner.id, p_session_id: commissionerSessionId,
    p_request_id: randomUUID(), p_expected_revision: 0, p_snapshot: snapshot,
  });
  assert.ifError(bootstrap.error);
  // Only the disposable postgres fixture controls cutover. No HTTP enable-writes shortcut exists.
  await pool.query("UPDATE public.cfc_league_runtime SET writes_enabled=true WHERE league_id=$1", [otherLeague]);
  const runtime = async (headers = otherHeaders) => {
    const result = await app("/api/league/runtime", { headers });
    assert.equal(result.response.status, 200);
    return result.body;
  };
  const tradeCommand = { request_id: randomUUID(), expected_revision: (await runtime()).revision,
    from_team_id: "1", to_team_id: "2", assets_from: [{ key: "pick:2026-1-1", label: "Spoofed", value: 999999 }],
    assets_to: [{ key: "pick:2026-1-2" }] };
  assert.equal((await post("/api/pro-personnel/trades/create", { ...tradeCommand, from_team_id: "2", to_team_id: "1" }, otherHeaders)).response.status, 403,
    "a member cannot spoof the atomic offer actor");
  const created = await post("/api/pro-personnel/trades/create", tradeCommand, otherHeaders);
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  const replay = await post("/api/pro-personnel/trades/create", tradeCommand, otherHeaders);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.id, created.body.id);
  assert.equal(replay.body.revision, created.body.revision, "identical retries do not create a second offer/thread or revision");
  const changed = await post("/api/pro-personnel/trades/create", { ...tradeCommand, to_team_id: "3" }, otherHeaders);
  assert.equal(changed.response.status, 409, "same request ID cannot be reused with changed intent");
  const storedOffer = await pool.query("SELECT from_value,to_value,grade_label,assets_from FROM public.trade_offers WHERE id=$1", [created.body.id]);
  assert.equal(storedOffer.rows[0].from_value, null);
  assert.equal(storedOffer.rows[0].to_value, null);
  assert.equal(storedOffer.rows[0].grade_label, "Not rated");
  assert.notEqual(storedOffer.rows[0].assets_from[0].label, "Spoofed", "client display/value claims do not enter canonical offers");
  const accepted = await post("/api/inbox/threads/status", { request_id: randomUUID(), expected_revision: created.body.revision,
    offer_id: created.body.id, team_id: "2", status: "accepted" }, otherCounterpartHeaders);
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  const owners = await pool.query("SELECT asset_key,owner_roster_id FROM public.cfc_asset_ownership WHERE league_id=$1 ORDER BY asset_key", [otherLeague]);
  assert.deepEqual(owners.rows.map((row) => row.owner_roster_id), ["2", "1", "3"], "acceptance atomically transfers both pick owners");
  const afterAcceptedReplay = await post("/api/pro-personnel/trades/create", tradeCommand, otherHeaders);
  assert.equal(afterAcceptedReplay.response.status, 200, "offer replay succeeds even after ownership has changed");
  assert.equal(afterAcceptedReplay.body.id, created.body.id);
  const start = await post("/api/scouting/draft/state", { request_id: randomUUID(), expected_revision: accepted.body.revision, action: "start" }, otherCommissionerHeaders);
  assert.equal(start.response.status, 200, JSON.stringify(start.body));
  const noOp = await post("/api/scouting/draft/state", { request_id: randomUUID(), expected_revision: start.body.revision, action: "tick" }, otherHeaders);
  assert.equal(noOp.response.status, 200);
  assert.equal(noOp.body.revision, start.body.revision, "early polling does not write a command or churn the runtime revision");
  await pool.query("INSERT INTO public.rookie_prospects(player_id,player_name,position) VALUES ('ci-rookie','Fixture Rookie','WR')");
  const pickCommand = { request_id: randomUUID(), expected_revision: start.body.revision, draft_season: 2026,
    pickIndex: 0, rosterId: "2", playerId: "ci-rookie" };
  const pick = await post("/api/scouting/draft/log", pickCommand, otherCounterpartHeaders);
  assert.equal(pick.response.status, 200, JSON.stringify(pick.body));
  const pickReplay = await post("/api/scouting/draft/log", pickCommand, otherCounterpartHeaders);
  assert.equal(pickReplay.response.status, 200);
  assert.equal(pickReplay.body.revision, pick.body.revision);
  const privateRuntime = JSON.stringify(await runtime());
  assert.doesNotMatch(privateRuntime, /ci-rookie/, "unannounced opposing draft selections are hidden from runtime reads");
  const pickRows = await pool.query("SELECT count(*)::int AS count FROM public.draft_log WHERE league_id=$1 AND draft_season=2026 AND player_id='ci-rookie'", [otherLeague]);
  assert.equal(pickRows.rows[0].count, 1, "draft retry creates exactly one selection");

  await runAuthBrowserSmoke({ base, pool, league, otherLeague, member, counterpart, password });

  const resetLink = await admin.auth.admin.generateLink({ type: "recovery", email: emails.member, options: { redirectTo: `${base}/reset` } });
  assert.ifError(resetLink.error);
  const tokenHash = resetLink.data.properties?.hashed_token;
  assert.ok(tokenHash, "local Auth must generate a recovery token");
  const recovery = await auth.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  assert.ifError(recovery.error);
  assert.ifError((await auth.auth.updateUser({ password: newPassword })).error);
  assert.ifError((await auth.auth.signOut({ scope: "others" })).error);
  assert.equal((await app("/api/ai/quota", { headers: { cookie: memberCookie } })).response.status, 401,
    "password recovery revokes prior provider sessions and their copied application cookies");
  assert.equal((await login(emails.member, password)).response.status, 401, "old password stops working after recovery");
  const recoveredLogin = await login(emails.member, newPassword);
  assert.equal(recoveredLogin.response.status, 200, "recovered password works through the actual login route");
  const recoveredFinal = await finalize(recoveredLogin.body.accessToken);
  assert.equal(recoveredFinal.response.status, 200, "recovered provider session can establish application access");
  const recoveredCookie = appCookie(recoveredFinal.response);
  assert.equal((await app("/api/ai/quota", { headers: { cookie: recoveredCookie } })).response.status, 200,
    "fresh recovered session remains authorized before membership revocation");

  assert.ifError((await admin.rpc("revoke_league_access", { p_user_id: member.id, p_league_id: league })).error);
  assert.equal((await app("/api/ai/quota", { headers: { cookie: recoveredCookie } })).response.status, 401,
    "membership revocation invalidates an otherwise active provider session application cookie");
  assert.equal((await finalize(recoveredLogin.body.accessToken)).response.status, 403,
    "consumed invitation cannot recreate revoked membership");

  assert.equal((await app("/api/ai/quota", { headers: { cookie: commissionerCookie } })).response.status, 200,
    "commissioner session remains active before explicit logout");
  const logout = await post("/api/auth/logout", {}, { cookie: commissionerCookie, authorization: `Bearer ${commissionerLogin.body.accessToken}` });
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get("set-cookie") ?? "", /cfc_session=;/, "logout clears the application session");
  assert.equal((await app("/api/ai/quota", { headers: { cookie: commissionerCookie } })).response.status, 401,
    "a copied application cookie cannot be replayed after provider logout");
  console.log("Disposable HTTP/Auth smoke checks passed.");
} finally {
  await pool.end();
}
}

await run();
