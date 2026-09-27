# Franchise Mode — sixth feedback revision

September 27, 2026. Applies `Franchise Mode - Feedback (5).json` against v8 (`43b68fa`). The file contains 15 active comments, including one question about prototype-only controls. Changes stay within those comments.

## Shared visual treatment

- Green belongs to compact data rows, not the surrounding container, header, padding, or empty space. Removed the broad green fills from Coach, Strategy, trade browsers/shop lists/negotiations, Big Board, Waivers, standings, and expanded score tables. Existing scenes and task tiles are unchanged.
- The row fill uses the existing lighter mock-board green. Workspace and green background opacity are reduced by 25%; text retains full opacity. Bronze headers are replaced with the same translucent black workspace surface.
- The existing offer-button gold is the action-button fill across primary, secondary, text actions, draft actions, and compact action controls. Navigation retains its hierarchy; clickable data rows retain green with gold selection emphasis.
- Pending waiver claim rows preserve their specifically requested darker green. Their surrounding panel is transparent black.
- Transaction History and the mock player pool are the explicit black-background exceptions to green data rows.

## Coach and shared roster layouts

- Matchup's green begins at each player's identity and ends at the score. Team totals, win probability/final winner, the middle position column, and surrounding space use the translucent black surface.
- Removed the surrounding border. Corrected row sizing that caused an unnecessary scrollbar next to opponent names, rather than concealing scrollable content.
- Lineup headings align with portrait left edges. Starting-slot labels and substitute ranks sit outside green cards, on the black background. The same convention applies to the mirrored Shop Your Guys layout.
- The shared display label for `REC_FLEX` is now `PC`. Slot codes, configured counts, and eligibility remain unchanged.
- The sample game-state selector remains available for reviewing the fictional scenarios. It is a prototype-only control and is not intended for the real app.

## Draft, waivers, and history

- Mock Draft uses a full-height, one-third-width board on the left, showing twelve picks for the selected round. The right two-thirds contains Player Pool, Your Roster, and Scouting Director tabs. Round selection, simulation, and drafting behavior are unchanged.
- Only the draft board rows are green; the player pool, roster, and director use the translucent black surface.
- Waiver countdown uses two-digit days, hours, and minutes separated by colons, with the unit underneath each number. Its existing sample timer remains.
- Transaction History uses the black surface, centered headings and cells, subtle interior row separators, and no bottom frame. Declined and Outbid outcomes are red. Other statuses and filters retain their meaning.

## Verification

- Production build and TypeScript passed, generating 44 static routes. Prototype ESLint and git whitespace checks passed.
- All 19 existing coaching and player-metrics tests passed using a fresh bundled test build. No changes to scoring or substitution rules.
- Browser checks covered 1492×876, 1280×720, and 390×844. At both desktop sizes all nine matchup rows fit without an internal scrollbar. The smaller desktop shows all twelve mock picks, eleven available prospects, and all 27 shop players.
- Verified a pregame starter/substitute swap through the mobile interface, draft simulation and selection through the Scouting Director tab, and the selected prospect in Your Roster.
- Available-player and pending-claim rows remain aligned at the same height. Checked the two-digit countdown, transparent panel background, and darker claim row after saving a sample claim.
- Confirmed red declined/outbid outcomes, centered history content, and the absence of its green frame. Checked the shared green-row treatment on Strategy and roster/shop layouts.
- A comment on the relocated Scouting Director survived screen changes and reload; Show element restored the correct tab. No browser console errors or warnings were observed. The final HTML uses a new commit-specific review ID and starts without QA notes.

This remains a local prototype with fictional data. No live connectors, production scoring, real transaction submission, or public publication were added.
