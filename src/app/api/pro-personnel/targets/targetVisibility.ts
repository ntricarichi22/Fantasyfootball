export function visibleAttachment(
  ownerTeamId: string,
  viewerTeamId: string,
  assetId: string,
  ownAttachments: Record<string, string>,
): string {
  return ownerTeamId === viewerTeamId
    ? (ownAttachments[`${ownerTeamId}:${assetId}`] ?? "core")
    : "listening";
}

export function targetResponse<T extends Record<string, unknown>>(payload: T): Omit<T, "profiles"> {
  const { profiles: _privateProfiles, ...safe } = payload;
  void _privateProfiles;
  return safe;
}
