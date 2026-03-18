import { getLlmPool } from "./llmDb";
import { normalizeSearchText } from "./questionUtils";

export type ResolvedFranchise = {
  franchise_id: string;
  franchise_name: string;
  normalized_name: string;
};

export type ResolvedPlayer = {
  player_id: string;
  player_name: string;
  primary_position: string | null;
  normalized_name: string;
};

declare global {
  // eslint-disable-next-line no-var
  var llmFranchiseCache: ResolvedFranchise[] | undefined;
  // eslint-disable-next-line no-var
  var llmPlayerCache: ResolvedPlayer[] | undefined;
}

async function getFranchiseCache(): Promise<ResolvedFranchise[]> {
  if (globalThis.llmFranchiseCache) {
    return globalThis.llmFranchiseCache;
  }

  const pool = getLlmPool();
  const result = await pool.query<{
    franchise_id: string;
    franchise_name: string;
  }>(`
    select
      franchise_id,
      franchise_name
    from llm.franchises
    order by franchise_name asc;
  `);

  globalThis.llmFranchiseCache = result.rows.map((row) => ({
    franchise_id: row.franchise_id,
    franchise_name: row.franchise_name,
    normalized_name: normalizeSearchText(row.franchise_name),
  }));

  return globalThis.llmFranchiseCache;
}

async function getPlayerCache(): Promise<ResolvedPlayer[]> {
  if (globalThis.llmPlayerCache) {
    return globalThis.llmPlayerCache;
  }

  const pool = getLlmPool();
  const result = await pool.query<{
    player_id: string;
    player_name: string;
    primary_position: string | null;
  }>(`
    select
      player_id,
      player_name,
      primary_position
    from llm.players
    where player_name is not null
    order by player_name asc;
  `);

  globalThis.llmPlayerCache = result.rows.map((row) => ({
    player_id: row.player_id,
    player_name: row.player_name,
    primary_position: row.primary_position,
    normalized_name: normalizeSearchText(row.player_name),
  }));

  return globalThis.llmPlayerCache;
}

function sortByBestMatch<T extends { normalized_name: string }>(
  matches: T[]
): T[] {
  return [...matches].sort((a, b) => {
    if (b.normalized_name.length !== a.normalized_name.length) {
      return b.normalized_name.length - a.normalized_name.length;
    }

    return a.normalized_name.localeCompare(b.normalized_name);
  });
}

export async function resolveFranchisesInQuestion(
  question: string
): Promise<ResolvedFranchise[]> {
  const normalizedQuestion = normalizeSearchText(question);
  const allFranchises = await getFranchiseCache();

  const matches = sortByBestMatch(
    allFranchises.filter(
      (franchise) =>
        franchise.normalized_name.length > 0 &&
        normalizedQuestion.includes(franchise.normalized_name)
    )
  );

  const seen = new Set<string>();
  const deduped: ResolvedFranchise[] = [];

  for (const match of matches) {
    if (seen.has(match.franchise_id)) {
      continue;
    }

    seen.add(match.franchise_id);
    deduped.push(match);
  }

  return deduped;
}

export async function resolveFranchiseInQuestion(
  question: string
): Promise<ResolvedFranchise | null> {
  const matches = await resolveFranchisesInQuestion(question);

  return matches[0] ?? null;
}

export async function resolvePlayersInQuestion(
  question: string
): Promise<ResolvedPlayer[]> {
  const normalizedQuestion = normalizeSearchText(question);
  const allPlayers = await getPlayerCache();

  const matches = sortByBestMatch(
    allPlayers.filter(
      (player) =>
        player.normalized_name.length > 0 &&
        normalizedQuestion.includes(player.normalized_name)
    )
  );

  const seen = new Set<string>();
  const deduped: ResolvedPlayer[] = [];

  for (const match of matches) {
    if (seen.has(match.player_id)) {
      continue;
    }

    seen.add(match.player_id);
    deduped.push(match);
  }

  return deduped;
}

export async function resolvePlayerInQuestion(
  question: string
): Promise<ResolvedPlayer | null> {
  const matches = await resolvePlayersInQuestion(question);

  return matches[0] ?? null;
}