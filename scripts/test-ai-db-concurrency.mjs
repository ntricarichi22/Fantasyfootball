import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const url = process.env.LOCAL_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new pg.Pool({ connectionString: url, max: 16 });
const userId = crypto.randomUUID();
const otherUserId = crypto.randomUUID();
const reserve = async (uid, amount, userLimit = 5_000_000, pilotLimit = 60_000_000) => {
  const client = await pool.connect();
  try {
    return await client.query(
      "select * from public.ai_reserve_usage($1,$2,$3,$4,$5,$6,$7,$8)",
      [uid, "concurrency-test", "test-model", amount, userLimit, pilotLimit, 100, 100],
    );
  } finally { client.release(); }
};

try {
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => reserve(userId, 1_000_000)));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 5,
    "atomic user reservations must stop exactly at $5");
  const [{ rows: userRows }] = await Promise.all([
    pool.query("select coalesce(sum(coalesce(actual_micros,reserved_micros)),0)::bigint total from public.ai_usage_reservations where user_id=$1", [userId]),
  ]);
  assert.equal(Number(userRows[0].total), 5_000_000);
  await pool.query("delete from public.ai_usage_reservations where user_id=$1", [userId]);

  await pool.query("insert into public.ai_usage_reservations(user_id,month_start,feature,model,reserved_micros) values ($1,date_trunc('month',timezone('UTC',now()))::date,'pilot-fixture','test-model',59000000)", [otherUserId]);
  const pilotAttempts = await Promise.allSettled([
    reserve(crypto.randomUUID(), 1_000_000, 5_000_000, 60_000_000),
    reserve(crypto.randomUUID(), 1_000_000, 5_000_000, 60_000_000),
  ]);
  assert.equal(pilotAttempts.filter((result) => result.status === "fulfilled").length, 1,
    "parallel users must not overrun the fixed $60 pilot ceiling");

  const denied = await pool.query("select has_function_privilege('authenticated','public.ai_reserve_usage(uuid,text,text,bigint,bigint,bigint,integer,integer)','EXECUTE') allowed");
  assert.equal(denied.rows[0].allowed, false, "authenticated clients cannot bypass the server accounting caller");
  console.log("AI database concurrency and bypass checks passed");
} finally {
  await pool.query("delete from public.ai_usage_reservations where feature in ('concurrency-test','pilot-fixture')").catch(() => undefined);
  await pool.end();
}
