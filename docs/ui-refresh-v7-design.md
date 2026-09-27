# Franchise Mode — fourth feedback revision

September 27, 2026. Implements the 15 active comments in `Franchise Mode - Feedback (3).json`, plus the subsequent scoring and Transaction History decisions from chat. Shared component feedback applies across the prototype; feature-specific changes stay local.

## Matchup and Lineup

- Injured starters retain their portraits. A shared medical chip sits beside the player's name in Matchup and Lineup.
- Matchup aligns the player name with the actual score at the same size and weight. Position/team aligns with the smaller scoring reference.
- Before and during a game, the reference is projected finish. After the game, it becomes the signed difference from the fixed pregame projection; clicking it reveals the original projection and final score.
- Game context sits with player identity: scheduled time and opponent before kickoff, opponent plus quarter/clock while live, and FINAL plus opponent afterward.
- Completed fantasy weeks replace win probability with a winner/tie banner and remove Edit lineup. The substitution strip retains counted points and backup identity; main totals continue to represent the slot's combined scoring. Existing eligibility, kickoff locking, manual ordering, and substitution allocation are unchanged.

## Trades and shared conventions

- Comparable position filters use plural labels, including QBs, RBs, PCs, and Picks, while underlying position/eligibility codes stay unchanged.
- Shared draft-pick labels omit ownership parentheses for original picks. Acquired picks retain `(via Team)`.
- Offer carousels put team names and crests directly beneath the top divider. Each asset has its own row, with player portrait, position, and NFL team where available. Opponent assets without a supplied image use a generic portrait.
- The existing mock-board green now carries through workspace headers, selected controls, strategy surfaces, trade headers, and history surfaces while preserving white type and gold emphasis.

## Draft and Waivers

- Big Board uses compact ranked rows consistent with the rest of the prototype instead of paper player posters. Ranking, star controls, tiers, and filters remain. The extra Your Draft Picks tab is removed.
- Mock Draft removes the duplicate pick strip. The green board includes the current pick state; tighter prospect rows place school/position beside the name on desktop and preserve more visible pool space. Simulation still follows the edited Big Board and stops at the user's picks.
- Waivers places salary-cap remaining in the header's upper right and its sample processing countdown in the middle. Compact pending claims sit beside the available-player pool on desktop and below it on mobile. Six sample available players remain visible on a typical desktop with two pending claims.

## Transaction History

- History contains resolved records only. Pending offers and waiver claims remain in their respective features.
- Columns are Date, Type / Partner, Add / Receive, Drop / Send, Salary cap, and Outcome. Related assets stay within one row, with stacked assets and plus/minus indicators.
- Waivers show Successful or Outbid. Unsuccessful claims show the submitted bid without a redundant zero-spent amount.
- Trades always identify the partner and show Accepted, Declined by [team/you], or Withdrawn by [team/you]. Unsuccessful rows explicitly identify proposed assets. Direct adds/drops use Completed.
- Rows are ordered by resolution time. Expanding a row reveals its details and whether a roster change occurred. Incoming offers allow acceptance/decline; outgoing proposals allow withdrawal. Resolving a sample offer moves it into history.

## Verification and scope

- Production build and TypeScript passed, with 44 static routes generated. Prototype ESLint passed. All 19 existing prototype rules/metrics tests passed.
- Browser review covered 1492×876, 1280×720, and 390×844. Desktop uses internal content scrolling when necessary on shorter displays; the page itself fits the viewport. Mobile waiver rows and matchup scoring have no horizontal overflow; the wide history table scrolls within its panel.
- Verified live/final score behavior, injury portraits, winner state, claim creation/reordering, completed offer outcomes, stacked trade offers, Big Board stars/reordering, and mock draft progression.
- Feedback comments on new history outcomes and expanded score comparisons survived screen changes and reloads. Show element restored the original feature and state, including the final game scenario and opened pregame comparison. No console errors or warnings were observed.
- The standalone feedback HTML embeds the same React source, production CSS, fonts, and assets. Its commit-specific document ID separates QA notes from the final review.

This remains a local prototype using illustrative data. No live connectors, real claims/trades, production scoring, or private-strategy sharing are enabled. Public GitHub/Vercel publication remains pending the earlier publication approval.
