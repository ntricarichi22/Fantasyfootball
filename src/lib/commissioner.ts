const COMMISSIONER_TEAM_NAME_NORMALIZED = "virginia founders";

export const COMMISSIONER_TEAM_NAME = "Virginia Founders";

// NOTE: deliberately uses a weaker normalization (trim + lowercase only) than
// `@/lib/normalize`'s `normalizeName`. The canonical helper strips spaces and
// other non-alphanumeric characters, but here the result is compared against
// the literal constant "virginia founders" which contains a space, and the
// input may be a `null`/`undefined` value (display name or team_name from
// Sleeper). Switching to the stronger normalization would also require
// changing the constant and would alter matching semantics, so this local
// helper is intentionally preserved.
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
