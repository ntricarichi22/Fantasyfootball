# Franchise Mode — fifth feedback revision

September 27, 2026. Implements the 20 active notes in `Franchise Mode - Feedback (4).json`, based on v7 (`0905936`), plus the requested screen-by-screen decision about the existing mock-draft green. No new design direction is introduced.

## Feedback mapping

1. Matchup restores the mirrored opponent layout: scores face the center and opponent identity aligns right.
2. League scoreboard sits beside the Matchup title with a thin white outline.
3. Matchup uses the mock-board green for its body and bronze/black for its header.
4. An injured starter and replacement appear beside each other. Starter identity includes the injury chip and counted points; replacement identity includes its game clock.
5. The scoring reference label is `Proj.`. Existing actual, projected finish, and final-versus-pregame calculations remain unchanged.
6. Trade send/receive headers retain black/bronze.
7. The trade roster browser uses green compact rows.
8. The described-deal helper paragraph is removed.
9. Offer assets have more separation from both team headings.
10. Shop Your Guys replaces pagination with Players/Picks tabs. Players follow configured Starters, ranked Subs, and stacked IR/Practice Squad columns. Picks use first-, second-, and third-round columns ordered by year.
11. Active negotiation rows open a full workspace with the offer's assets and Accept/Decline/Counter actions. Counter reuses the existing trade builder. Outgoing offers retain Withdraw.
12. The Mock Draft pool is taller, with its existing round board beside it and tighter player rows, showing at least ten prospects on the checked desktop sizes.
13. Pending waiver claims match available-player row heights and starting positions. Their heading aligns with the position filters.
14. The claim editor opens at the bottom of the pending-claims panel, independent of the number of existing claims.
15. Transaction History has static rows without dropdown expansion.
16. Table headings use the same text size as its filter tabs.
17. Asset names and row spacing are more compact.
18. Outcomes have larger, brighter, heavier text.
19. The redundant proposed-assets subtext is removed. Type retains partner subtext for trades.
20. History filters are All, Trades, and Adds / Drops. The last includes waivers, direct adds, and drops.

## Green placement by screen

| Screen | Green compact data surface | Retained treatment |
| --- | --- | --- |
| Coach — Matchup | Matchup body and player rows | Bronze/black workspace header |
| Coach — Lineup | Starters, Subs, IR, Practice Squad | Scene, navigation, profile overlays |
| GM — Strategy | Player and pick lists | Needs controls, private strategy editor |
| GM — Build an Offer | Roster and pick browser | Send/receive headers and deal panels |
| GM — Shop Your Guys | Player and pick selection rows | Offer result panels and team headings |
| GM — Active Negotiations | Compact negotiation ledger | Expanded offer and counter workspace panels |
| GM — Draft | Big Board rows, Mock Draft pool/roster and round board | Existing draft actions and task tiles |
| GM — Waivers | Available players and pending claims | Dark claim editor and bronze/black header |
| GM — Transaction History | Table and compact records | Existing scene and navigation |
| Owner — Rules, Meetings, Identity | No new green data surface | Existing tiles, forms, and content; shared header bronze/black |
| League — Standings | Division tables | Playoff content and navigation |
| League — Scores | Expanded box-score rows | Game cards and schedule controls |
| League — Activity | Compact transaction entries | Existing filters and scene |
| League — History | No new green surface | Existing champion/history treatment |

## Verification

- Production build and TypeScript passed; 44 static routes generated. Prototype ESLint passed. All 19 existing coaching/metrics tests passed.
- Browser checks covered 1492×876, 1280×720, and 390×844. No browser errors or warnings were observed.
- All 27 sample players fit the desktop shopping view at both desktop sizes. The nine picks appear in three round columns in ascending year order, and player/pick selections persist between tabs and offer results.
- Mock Draft shows 11 fully visible prospects at both desktop sizes without scrolling.
- At 1280×720, available-player and pending-claim rows both start at y=333.5 and are 49 px tall. The editor stays at the panel bottom with one or two claims; all six available players remain visible.
- Checked mirrored matchup scoring, side-by-side injury substitution identities, mobile horizontal fit, static history filters, and green placement across Coach, GM, Owner, and League surfaces.
- Opened an incoming negotiation, countered through the existing builder, and verified the resulting outgoing offer. Declining an incoming offer removes it from active negotiations and shows `Declined by you` in history.
- A comment on a new ShopSelection row survived tab navigation and reload. Show element restored the correct GM/Shop Your Guys view and player. Final commit-specific HTML starts with a clean review-note set.

This is a local prototype with fictional data. Lineup configuration, eligibility, kickoff locking, substitution scoring, and private-strategy access are unchanged. No live connectors or real transaction submission are enabled. Public GitHub/Vercel publication remains pending the earlier publication approval.
