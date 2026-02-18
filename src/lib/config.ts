const leagueIdEnv = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim();

const missingLeagueIdError =
  "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID.";

export const getLeagueId = () => {
  if (!leagueIdEnv) {
    throw new Error(missingLeagueIdError);
  }
  return leagueIdEnv;
};

export const LEAGUE_ID = leagueIdEnv || "";
