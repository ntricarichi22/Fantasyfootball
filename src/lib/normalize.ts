/**
 * Normalize a player/prospect name for fuzzy matching.
 * - NFKD unicode normalization (handles ligatures AND diacritics)
 * - Strip combining marks
 * - Lowercase
 * - Strip all non-alphanumeric characters (periods, hyphens, apostrophes, spaces)
 *
 * Use this everywhere names need to be compared or matched.
 *
 * Accepts `null`/`undefined` for ergonomics with optional fields like
 * `row?.player_name`; treated as the empty string.
 */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
