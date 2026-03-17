import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var historianLlmPool: Pool | undefined;
}

export function getLlmPool(): Pool {
  const connectionString = process.env.LLM_DATABASE_URL;

  if (!connectionString) {
    throw new Error("Missing LLM_DATABASE_URL");
  }

  if (!globalThis.historianLlmPool) {
    globalThis.historianLlmPool = new Pool({
      connectionString,
      max: 1,
    });
  }

  return globalThis.historianLlmPool;
}