import deploymentTargets from "../../config/deployment-targets.json" with { type: "json" };

// Shared with operational scripts; these public identifiers are never credentials.
export const PRODUCTION_SUPABASE_PROJECT_REF = deploymentTargets.production.supabaseProjectRef;
export const PRODUCTION_VERCEL_PROJECT_ID = deploymentTargets.production.vercelProjectId;

export type DeploymentEnvironment = "production" | "staging" | "local";
export type EnvironmentValues = Record<string, string | undefined>;

/** A staging project's production target is still staging for this application. */
export function deploymentEnvironment(env: EnvironmentValues): DeploymentEnvironment {
  if (env.NEXT_PUBLIC_APP_ENV === "staging") return "staging";
  if (env.VERCEL_ENV || env.VERCEL === "1") {
    return env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_ID === PRODUCTION_VERCEL_PROJECT_ID
      ? "production" : "staging";
  }
  // next.config derives this marker from the server's platform identity. Browser
  // builds do not consistently expose every prefixed platform variable.
  if (env.NEXT_PUBLIC_APP_ENV === "production") return "production";
  if (env.NEXT_PUBLIC_VERCEL_ENV) {
    return env.NEXT_PUBLIC_VERCEL_ENV === "production" && env.NEXT_PUBLIC_VERCEL_PROJECT_ID === PRODUCTION_VERCEL_PROJECT_ID
      ? "production" : "staging";
  }
  return "local";
}

/** Explicit references let Next inline the public marker into browser bundles. */
export function currentDeploymentEnvironment(): DeploymentEnvironment {
  return deploymentEnvironment({
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_PROJECT_ID: process.env.NEXT_PUBLIC_VERCEL_PROJECT_ID,
  });
}

export function supabaseProjectRef(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
      !["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
    return /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1] ?? null;
  } catch { return null; }
}

/** Non-secret readiness identity; only verified local URLs receive the local label. */
export function supabaseTargetIdentity(url: string, environment: DeploymentEnvironment): string | null {
  const project = supabaseProjectRef(url);
  if (project || environment !== "local") return project;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
      !parsed.username && !parsed.password && ["", "/"].includes(parsed.pathname) &&
      !parsed.search && !parsed.hash ? "local" : null;
  } catch { return null; }
}

function legacyKeyProjectRef(key: string): string | null {
  if (!key.includes(".")) return null;
  try {
    const payload = JSON.parse(atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch { return null; }
}

/** Endpoint checks are configuration validation, not JWT authentication. */
export function supabaseIsolationError(url: string, key: string, environment: DeploymentEnvironment): string | null {
  if (environment !== "staging") return null;
  const project = supabaseProjectRef(url);
  if (!project || project === PRODUCTION_SUPABASE_PROJECT_REF) return "Staging Supabase configuration is not isolated";
  const keyProject = legacyKeyProjectRef(key);
  if (keyProject && keyProject !== project) return "Staging Supabase key does not match its project";
  return null;
}

export function databaseIsolationError(connectionString: string, environment: DeploymentEnvironment, supabaseUrl: string | undefined): string | null {
  if (environment !== "staging") return null;
  try {
    const url = new URL(connectionString);
    const username = decodeURIComponent(url.username);
    const expectedProject = supabaseUrl ? supabaseProjectRef(supabaseUrl) : null;
    const overridesConnection = [...url.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "user", "password", "dbname", "database", "port", "service"].includes(key.toLowerCase()));
    const directProject = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1];
    const pooledProject = /\.([a-z0-9]{20})$/.exec(username)?.[1];
    const project = directProject ?? (url.hostname.endsWith(".pooler.supabase.com") ? pooledProject : undefined);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !project || !expectedProject ||
      project !== expectedProject || overridesConnection ||
      project === PRODUCTION_SUPABASE_PROJECT_REF ||
      username.includes(PRODUCTION_SUPABASE_PROJECT_REF)) return "Staging historian configuration is not isolated";
    return null;
  } catch { return "Staging historian configuration is not isolated"; }
}
