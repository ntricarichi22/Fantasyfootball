import { parse, toSql } from "pgsql-ast-parser";

export const HISTORY_TABLES = new Set([
  "llm_franchises", "llm_players", "llm_seasons", "llm_season_weeks",
  "llm_season_records", "llm_team_games", "llm_player_games", "llm_draft_picks", "llm_transactions",
]);
const FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max", "round", "abs", "ceil", "ceiling", "floor",
  "coalesce", "nullif", "greatest", "least", "lower", "upper", "length", "concat", "concat_ws",
  "date_part", "date_trunc", "row_number", "rank", "dense_rank", "lag", "lead",
]);
const TYPES = new Set(["int", "integer", "int4", "int8", "bigint", "smallint", "numeric", "decimal", "float", "float4", "float8", "real", "double precision", "text", "varchar", "boolean", "bool", "date", "timestamp", "timestamptz"]);
const STATEMENTS = new Set(["select", "with", "union", "union all"]);

// Parse and re-serialize the accepted AST. Neither a prompt nor a keyword denylist
// is a security boundary; the database role and read-only transaction also enforce it.
export function validateHistoryQuery(sql: string): string {
  if (typeof sql !== "string" || sql.length > 12_000) throw new Error("Query is too large");
  const statements = parse(sql);
  if (statements.length !== 1 || !STATEMENTS.has(statements[0].type)) throw new Error("One read-only query is required");
  const ctes = new Set<string>();
  function walk(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const node = value as Record<string, unknown>;
    if (node.type === "with") {
      for (const bind of (node.bind as { alias: { name: string }; statement: { type: string } }[])) {
        if (!STATEMENTS.has(bind.statement.type)) throw new Error("Only read-only CTEs are allowed");
        ctes.add(bind.alias.name);
      }
      if (!STATEMENTS.has((node.in as { type: string }).type)) throw new Error("Only read-only queries are allowed");
    }
    if (node.type === "select" && (node.into || node.for)) throw new Error("SELECT side effects are forbidden");
    if (node.type === "table") {
      const name = node.name as { name: string; schema?: string };
      if ((name.schema && name.schema !== "public") ||
          (!HISTORY_TABLES.has(name.name) && (name.schema || !ctes.has(name.name)))) {
        throw new Error("Only approved history tables are available");
      }
    }
    if (node.type === "call") {
      const fn = node.function as { name: string; schema?: string };
      if (fn.schema || !FUNCTIONS.has(fn.name)) throw new Error("Function is not approved");
    }
    if (node.type === "cast") {
      const type = node.to as { name: string; schema?: string; kind?: string };
      if (type.schema || type.kind === "array" || !TYPES.has(type.name)) throw new Error("Type is not approved");
    }
    // No custom operators, functions-as-tables, recursive queries, or DML.
    if (["insert", "update", "delete", "values", "with recursive", "call statement"].includes(String(node.type))) {
      throw new Error("Query operation is not approved");
    }
    Object.values(node).forEach(walk);
  }
  walk(statements[0]);
  return toSql.statement(statements[0]);
}
