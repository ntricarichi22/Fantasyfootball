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
        season,
        round,
      };
    }),
  );
}
