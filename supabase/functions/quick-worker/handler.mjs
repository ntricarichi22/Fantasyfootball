const MAX_BODY_BYTES = 4096;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 100;

async function readJson(stream, limit) {
  if (!stream) return {};
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError("Payload too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes) || "{}");
}

async function sameSecret(left, right) {
  const encode = value => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([left, right].map(value =>
    crypto.subtle.digest("SHA-256", encode(value)).then(hash => new Uint8Array(hash))));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export function createBackfillHandler({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  return async request => {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    if (!supabaseUrl || !serviceKey) return json({ error: "Importer unavailable" }, 503);
    const authorization = request.headers.get("authorization") || "";
    if (authorization.length > 8192 || !authorization.startsWith("Bearer ") ||
        !await sameSecret(authorization.slice(7), serviceKey)) {
      return json({ error: "Unauthorized" }, 401);
    }

    let input;
    try {
      input = await readJson(request.body, MAX_BODY_BYTES);
    } catch (error) {
      return json({ error: "Invalid request body" }, error instanceof RangeError ? 413 : 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json({ error: "Invalid request body" }, 400);
    }
    const leagueId = Number(input.league_id ?? 301954);
    const sport = input.sport ?? "NFL";
    const requestFilter = input.request_filter ?? "TRADES_COMPLETED";
    if (!Number.isSafeInteger(leagueId) || leagueId <= 0 || sport !== "NFL" ||
        requestFilter !== "TRADES_COMPLETED") {
      return json({ error: "Expected a positive league_id and NFL completed trades" }, 400);
    }

    let resultOffset = 0;
    let pagesLoaded = 0;
    let tradesSeen = 0;
    let resultTotal = null;
    // Bound the entire job as well as individual requests. Upserts make retries safe.
    const deadline = AbortSignal.timeout(110_000);
    try {
      while (pagesLoaded < MAX_PAGES) {
        const upstream = new URL("https://www.fleaflicker.com/api/FetchTrades");
        upstream.search = new URLSearchParams({
          sport, league_id: String(leagueId), filter: requestFilter,
          result_offset: String(resultOffset),
        }).toString();
        const response = await fetchImpl(upstream, {
          headers: { Accept: "application/json", "User-Agent": "CFC history importer" },
          redirect: "error",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok) throw new Error("Upstream unavailable");
        const data = await readJson(response.body, MAX_RESPONSE_BYTES);
        if (!data || !Array.isArray(data.trades)) throw new Error("Invalid upstream data");
        const nextOffset = data.result_offset_next;
        if (nextOffset != null && (!Number.isSafeInteger(nextOffset) || nextOffset <= resultOffset)) {
          throw new Error("Invalid pagination");
        }
        const write = await fetchImpl(new URL("/rest/v1/flea_raw_fetchtrades?on_conflict=league_id,sport,request_filter,result_offset", supabaseUrl), {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify({
            league_id: leagueId, sport, request_filter: requestFilter, result_offset: resultOffset,
            result_offset_next: nextOffset ?? null, result_total: data.result_total ?? null,
            response_json: data,
          }),
          redirect: "error",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000)]),
        });
        if (!write.ok) throw new Error("Storage unavailable");
        await write.body?.cancel();
        pagesLoaded++;
        tradesSeen += data.trades.length;
        resultTotal = data.result_total ?? null;
        if (nextOffset == null) {
          return json({ ok: true, league_id: leagueId, sport, request_filter: requestFilter,
            pages_loaded: pagesLoaded, trades_seen_total: tradesSeen, result_total: resultTotal });
        }
        resultOffset = nextOffset;
      }
      throw new Error("Page limit reached");
    } catch {
      // Do not return upstream bodies, SQL details, or credentials to the caller.
      return json({ ok: false, error: "Backfill failed; safely retry or inspect server logs", pages_loaded: pagesLoaded }, 502);
    }
  };
}
