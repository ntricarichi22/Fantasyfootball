const COMMISSIONER_TEAM_NAME_NORMALIZED = "virginia founders";

export const COMMISSIONER_TEAM_NAME = "Virginia Founders";

const normalizeName = (value?: string | null) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isCommissionerTeamName = (value?: string | null) =>
  normalizeName(value) === COMMISSIONER_TEAM_NAME_NORMALIZED;

type CommissionerUser = {
  display_name?: string | null;
  metadata?: { team_name?: string | null } | null;
  user_id?: string | null;
};

type CommissionerRoster = {
  roster_id?: number | null;
  owner_id?: string | null;
};

export const findCommissionerRosterId = (
  users: CommissionerUser[] = [],
  rosters: CommissionerRoster[] = []
) => {
  // Prefer team_name metadata, then display_name
  for (const roster of rosters) {
    const user = roster?.owner_id
      ? users.find((candidate) => candidate.user_id === roster.owner_id)
      : undefined;

    const matches = [user?.metadata?.team_name, user?.display_name].some((name) =>
      isCommissionerTeamName(name)
    );

    if (matches && roster?.roster_id != null) {
      return String(roster.roster_id);
    }
  }

  return "";
};
