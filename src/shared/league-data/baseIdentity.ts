const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function configuredBaseSlugs(raw: string | undefined): Map<string, string> {
  if (!raw) return new Map();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return new Map(Object.entries(value).flatMap(([rosterId, slug]) =>
      typeof slug === "string" && SAFE_SLUG.test(slug) ? [[rosterId, slug] as const] : []));
  } catch {
    return new Map();
  }
}

export function resolveBaseSlug(
  rosterId: string,
  configured: Map<string, string>,
  remembered: Map<string, string>,
  sleeperSlug: string | null,
  displaySlug: string,
): string {
  return configured.get(rosterId) ?? remembered.get(rosterId) ?? sleeperSlug ?? displaySlug;
}
