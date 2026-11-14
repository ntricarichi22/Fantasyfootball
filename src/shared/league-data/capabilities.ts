/** Explicit capability registration for the existing CFC warehouse and pricing model. */
export function isCfcLeague(leagueId: string): boolean {
  const configured = process.env.CFC_LEAGUE_ID?.trim() || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim();
  return Boolean(configured && leagueId === configured);
}

export function requireCfcValuation(leagueId: string): void {
  if (!isCfcLeague(leagueId)) throw new Error("Valuation is not configured for this league");
}
