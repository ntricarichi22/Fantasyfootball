type QueryParams = Record<string, string | number | boolean | undefined>;

export type SourceFetchResult = {
  ok: boolean;
  status: number;
  requestUrl: string;
  requestParams: Record<string, string | number | boolean>;
  bodyText: string;
  bodyJson: unknown;
};

async function fetchSource(baseUrl: string, params: QueryParams): Promise<SourceFetchResult> {
  const requestUrl = new URL(baseUrl);
  const requestParams: SourceFetchResult["requestParams"] = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    requestUrl.searchParams.set(key, String(value));
    requestParams[key] = value;
  }
  const response = await fetch(requestUrl.toString(), {
    headers: { accept: "application/json,text/plain,*/*" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const bodyText = await response.text();
  let bodyJson: unknown = null;
  try { bodyJson = JSON.parse(bodyText); } catch { /* Preserve non-JSON raw source responses. */ }
  return { ok: response.ok, status: response.status, requestUrl: requestUrl.toString(), requestParams, bodyText, bodyJson };
}

export function fetchMfl(seasonYear: number, params: QueryParams): Promise<SourceFetchResult> {
  return fetchSource(`https://api.myfantasyleague.com/${seasonYear}/export`, { ...params, JSON: 1 });
}

export function fetchFleaflicker(path: string, params: QueryParams): Promise<SourceFetchResult> {
  return fetchSource(`https://www.fleaflicker.com/api${path}`, {
    sport: process.env.FLEAFLICKER_SPORT ?? "NFL", ...params,
  });
}
