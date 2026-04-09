import type { QueryResultRow } from "pg";
import { ALLOWED_LLM_VIEW_SET } from "./agentSchema";
import { getLlmPool } from "./llmDb";

const MAX_RETURNED_ROWS = 200;
const MAX_SQL_LENGTH = 12000;

const FORBIDDEN_SQL_PATTERNS: RegExp[] = [
  /--/,
  /\/\*/,
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|refresh|merge|call)\b/i,
  /\b(pg_catalog|information_schema)\b/i,
  /\bpg_[a-z0-9_]*\b/i,
  /\bpublic\./i,
];

type ReadOnlyQueryResult = {
  ok: boolean;
  sql: string;
  rowCount: number;
  columns: string[];
  rows: QueryResultRow[];
  error?: string;
};

function normalizeIdentifier(value: string): string {
  return value.replace(/"/g, "").trim().toLowerCase();
}

function extractCteNames(sql: string): Set<string> {
  const cteNames = new Set<string>();
  const cteRegex = /(?:\bwith\b|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi;

  for (const match of sql.matchAll(cteRegex)) {
    const name = match[1]?.trim().toLowerCase();

    if (name) {
      cteNames.add(name);
    }
  }

  return cteNames;
}

function extractReferencedRelations(sql: string): string[] {
  const refs: string[] = [];
  const relationRegex = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_\.\"]*)/gi;

  for (const match of sql.matchAll(relationRegex)) {
    const ref = match[1]?.trim();

    if (ref) {
      refs.push(ref);
    }
  }

  return refs;
}

function normalizeSingleStatementSql(sql: string): string {
  const parts = sql
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error("Agent SQL cannot be empty");
  }

  if (parts.length > 1) {
    throw new Error("Agent SQL must contain exactly one statement");
  }

  return parts[0];
}

function isAllowedRelationRef(
  normalizedRef: string,
  cteNames: Set<string>
): boolean {
  if (normalizedRef.includes(".")) {
    if (ALLOWED_LLM_VIEW_SET.has(normalizedRef)) {
      return true;
    }

    const [prefix] = normalizedRef.split(".");

    if (prefix && cteNames.has(prefix)) {
      return true;
    }

    return false;
  }

  return cteNames.has(normalizedRef);
}

export function validateReadOnlyLlmSql(sql: string): string {
  const singleStatementSql = normalizeSingleStatementSql(sql.trim());

  if (singleStatementSql.length > MAX_SQL_LENGTH) {
    throw new Error("Agent SQL is too long");
  }

  if (!/^\s*(select|with)\b/i.test(singleStatementSql)) {
    throw new Error("Agent SQL must start with SELECT or WITH");
  }

  for (const pattern of FORBIDDEN_SQL_PATTERNS) {
    if (pattern.test(singleStatementSql)) {
      throw new Error("Agent SQL contains a forbidden token or pattern");
    }
  }

  const cteNames = extractCteNames(singleStatementSql);
  const relationRefs = extractReferencedRelations(singleStatementSql);

  if (relationRefs.length === 0) {
    throw new Error("Agent SQL must reference at least one relation");
  }

  for (const relationRef of relationRefs) {
    const normalizedRef = normalizeIdentifier(relationRef);

    if (!isAllowedRelationRef(normalizedRef, cteNames)) {
      throw new Error(`Agent SQL referenced a non-llm relation: ${normalizedRef}`);
    }
  }

  return singleStatementSql;
}

export async function runReadOnlyLlmQuery(sql: string): Promise<ReadOnlyQueryResult> {
  const validatedSql = validateReadOnlyLlmSql(sql);
  const pool = getLlmPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 5000");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = 5000");
    await client.query("SET LOCAL search_path = llm, public");

    const result = await client.query(validatedSql);

    return {
      ok: true,
      sql: validatedSql,
      rowCount: result.rowCount ?? result.rows.length,
      columns: result.fields.map((field) => field.name),
      rows: result.rows.slice(0, MAX_RETURNED_ROWS),
    };
  } catch (error) {
    return {
      ok: false,
      sql: validatedSql,
      rowCount: 0,
      columns: [],
      rows: [],
      error: error instanceof Error ? error.message : "Unknown SQL execution error",
    };
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback cleanup errors
    }

    client.release();
  }
}

export type { ReadOnlyQueryResult };
