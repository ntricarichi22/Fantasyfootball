# Franchise Mode — third feedback revision

September 27, 2026. Implements notes 1–25 from `Franchise Mode - Feedback (2).json`. Shared components receive shared changes; feature-specific notes remain local. Notes 26–27 about Transaction History are held because the feedback explicitly requests discussion before updating that screen.

## Shared changes

- Removed the redundant franchise eyebrow, league-settings subtitle, HQ label, and CFC feature-header label. The franchise name is vertically centered against its crest.
- Shared tab labels are larger. Shared player badges consistently arrange age/YRS, quality, and the applicable Young/Aging chip.
- Strategy, trade browsing/shopping, and draft capital share one sample pick inventory. Base labels use the existing `formatPickLabel` helper, with `(own pick)` or `(via Team)` ownership text.
- The existing private-price composition and currency formatting helpers drive dollar values from pick quantities. Private values remain confined to the owner's Strategy editor and player dossier.

## Screen-specific changes

- Matchup shows actual points alongside the selected live or pregame projection. The bar always tracks the fixed pregame target, so performance against expectations remains visible. A footer control selects the numerical projection reference. Game/opponent information sits between the name and score on desktop; mobile adapts the same information to its available width. Win probability is attached to the line endpoint. Edit lineup is beside the team name, and League scoreboard provides a direct shortcut.
- Lineup cards include scheduled game time and opponent without changing shared slot eligibility, kickoff locking, substitution assignment, or scoring behavior.
- Strategy uses an internally scrolling player list. Names no longer repeat Starters/Subs designations. Age/quality sit near the name; private price and availability sit toward the edit affordance. Larger needs controls use the right column's height. The dossier prominently displays private dollar value and availability, updating the value as pick counters change.
- The trade builder uses PCs as its local position filter label. The described-deal helper explains both specific assets and general goals. Shopping supports players and picks together, counts only selected asset types in the heading, and has one Edit block action that preserves the selection. Offer recipients align to the right; the shared offer carousel uses Propose trade.
- Big Board follows the existing scouting module's tier rails, colored player posters, rank/name hierarchy, star controls, and search/position filtering. Users can move/reorder prospects and filter My Guys. Mock Draft follows the existing pick strip, green round board, player pool/roster, cream player rows, and scouting-director layout. Its simulation follows the edited Big Board order and stops at each Founders pick.

## Scope and data

This remains a local UI prototype with fictional players, scouting assessments, draft order, projections, offers, and actions. No live connectors, AI offer generation, real transaction submission, or production scoring are enabled. Price anchors come from the existing editor's defaults, not live valuations. The existing production scouting components were used as layout references; they were not replaced or modified.

Transaction History remains unchanged pending the requested discussion. Proposed direction: separate added/received assets and dropped/sent assets into wide columns, use plus/minus roster indicators, and keep status, salary-cap amount, and date in their own columns.

## Verification

- Production build and TypeScript passed; 44 routes generated.
- Prototype ESLint passed with zero warnings.
- Existing 19 coaching and metric tests passed.
- Browser review at 1492×876, 1280×720, and 390×844. Compact desktop Matchup fits the viewport; mobile Strategy has no horizontal overflow. Projection reference labels, final-state scoring, and the scoreboard shortcut work.
- Verified private dollar updates, Strategy scrolling, shared pick ownership labels, retained shopping selections, mixed player/pick shopping headings, single Edit block action, Big Board ranking/stars, and mock simulation to the user's picks.
- Feedback comments on new draft elements survive screen changes and reloads; Show element restores the draft screen. No browser errors or warnings were observed during final checks.
- The standalone review HTML embeds the same source, production CSS, images, and fonts. Its commit-specific document ID keeps QA notes out of the final deliverable.

GitHub publication is not part of this local revision; it remains pending the earlier publication approval.
