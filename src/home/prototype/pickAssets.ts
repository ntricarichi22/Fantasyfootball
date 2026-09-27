import { formatPickLabel } from "@/shared/league-data/picks";
// One sample capital inventory for Strategy, trade building/shopping, and Draft.
export function previewPicks(owner = "own") {
  return [2027, 2028, 2029].flatMap((season) =>
    [1, 2, 3].map((round) => {
      const via =
        owner === "own" && season === 2028 && round === 2 ? "Browns" : null;
      return {
        id: `${owner}-${season}-${round}`,
        name: formatPickLabel({ season, round }),
        meta: via ? `(via ${via})` : "",
        position: "Picks",
        originTeam: via ?? owner,
        season,
        round,
      };
    }),
  );
}

// Keep IDs and canonical names stable for trade matching. Provenance is part
// of the visible pick identity everywhere, never secondary metadata.
export function assetDisplayName(asset: { name: string; meta?: string }) {
  return asset.meta?.startsWith("(via ")
    ? `${asset.name} ${asset.meta}`
    : asset.name;
}
export function assetDetail(asset: { meta?: string }) {
  return asset.meta?.startsWith("(via ") ? "" : asset.meta;
}
