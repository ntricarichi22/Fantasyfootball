# Franchise Mode — feedback (7), review v11

September 27, 2026. Applies all ten active notes in `Franchise Mode - Feedback (7).json`, exported against v10 (`d3a7096`). This pass retains the approved bronze accent, green compact rows, scenes, typography, and existing Coach/GM workflows.

## Player valuation

- Condensed the season and franchise dashboards into two desktop columns, with a compact career strip below. Mobile stacks these sections.
- Moved the asking-price summary into the private valuation section. Enlarged availability choices, asking-price labels, quantities, and increment/decrement controls so editing valuation is the popup's main emphasis.
- Added comma grouping to numeric dashboard values, including franchise and career points, while preserving displayed decimal precision. Existing currency formatting remains grouped; transaction amounts use the same grouping convention.
- Editing remains private and saves to the prototype session. No live connector or scoring changes.

## Shared roster and pick presentation

- Lineup and Shop Your Guys use matching row heights for Starters, Subs, IR, and Practice Squad. IR begins at the same height as the first Starter/Sub.
- Reduced the sample IR list to four players. Its container can scroll internally when additional players are present; no IR roster cap was introduced.
- Practice Squad's two spots align with the last two Sub rows. Its heading occupies the third-from-last row with breathing room. Grid sizing uses configured starting-slot and Practice Squad counts.
- Replaced redundant round tokens with the originating team's crest in shared pick views: Strategy, shopping, trade browsers, selected assets, sample offers, and negotiations. The acquired 2028 second-round pick shows the Browns crest; own picks use the current franchise identity. Pick provenance is retained on generated trade assets.
- Shortened the trade task title to **Negotiations**; its route and workflow are unchanged.

## Transaction History

- Column headers are centered; record values are left aligned.
- The second header is **Transaction**, with a single description such as **Trade with Browns**. Removed the duplicate partner subline.
- Added equal-sized circular icons: plus for waiver/free-agent additions, minus for drops, and opposing arrows for trades.
- Player position/team sits inline after the player name. This implements the later compact-row comment while preserving the earlier requested left alignment. Multiple assets still occupy separate lines within a transaction.
- Retained historical-only filtering, accepted/declined/withdrawn actors, bid/spent semantics, and the existing green-row treatment.

## Verification

- Production build and TypeScript pass; 44 routes generated. Prototype ESLint and git whitespace checks pass.
- All 19 existing coaching/player-metric tests pass from a freshly built test bundle. Only fixture count expectations changed in the tests.
- Browser checks at 1492×876 confirm matching 46.5px Lineup cards and matching approximately 36.17px Shop cards, with IR aligned to the first row and Practice Squad aligned to the bottom two Sub rows.
- At 1280×720, both roster screens fit their content areas without grid overflow. Negotiations occupies one text line. All six history records fit; headers are centered and all transaction circles are 26×26px.
- Visually checked the revised valuation popup and transaction history on desktop. Availability and price edits update the private asking-price summary and survive navigating away and reopening the player.
- At 390×844, the player dialog has no horizontal overflow and its price controls remain reachable through internal scrolling.
- A comment anchored to a valuation quantity survives screen navigation and reload. The final HTML receives a new commit-specific review ID, separate from the QA comment.

Owner and League feature layouts are unchanged. Source and the self-contained feedback HTML remain local on `ui-refresh`; nothing was published.
