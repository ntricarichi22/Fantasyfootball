# Franchise Mode — Coach and GM feedback revision

September 27, 2026. Implements all 29 notes from the second feedback export plus the subsequent agreement to retain the deal-preview/roster-browser structure, apply task-tile formatting globally, and add age/quality summaries with a detailed player dossier.

## Updated experience

- Shared task tiles use solid dark surfaces, bold condensed type, restrained gold accents, distinct feature icons, and a visible scene behind the gallery. This is the shared component for Trades, Draft, Rules, and Meetings.
- Matchup separates the injured starter and replacement, shows their individually counted points, game state and stat context, and uses scored points plus remaining projections for the illustrative probability. Team records, edit-lineup action, header hierarchy and slot labels are clearer.
- Lineup uses click-to-select plus highlighted legal destinations, alongside drag and drop. All configured starter/Sub/Practice Squad vacancies render. IR begins alongside the first starter; Practice Squad ends alongside the last Sub. Nine starters and nine Subs fit desktop workspaces; phones switch between Starters, Subs and Reserves.
- Strategy uses full room names, name/age/quality rows, and a player detail dialog instead of an inline editor. Young/Aging comes from shared ageBucket; Stud uses the existing stud signal and Impact/Depth/Scrub use the shared positional value-rank thresholds. Numerical age, value ranks and stud flags are review fixtures, not a new live data source.
- Player dossiers include season points, points/game, position rank, stat summary, team tenure/acquisition, franchise starts/points/rank, and career fantasy points/position rank. Private availability and pick-quantity asking prices appear only in the owner's Strategy context. Draft-pick settings use a separate dialog with the same price controls.
- Manual trades keep the proposed deal alongside a multi-select roster/pick browser. Partner selection starts blank in the receiving header. Describe-a-deal and shopping flows present a full offer carousel; editing the shopping block retains selections.
- Transaction History is a compact ledger with roster effect, status, date and bid/spend distinction. Failed claims explicitly show no roster change and zero spend.

## Data and scope

All prototype data, historical ranks, injuries, projections, game clocks, offers and actions are fictional. No live league connector, AI trade generation or production scoring is enabled. The win probability is an illustrative demo formula, not a calibrated predictive model. Scoring still uses the previously agreed kickoff locking, final bench assignments, real occurrence ordering and elapsed-game scoring cutoffs. Existing shared slot configuration/eligibility remains authoritative. This revision does not merge to the production branch.

## Verification

- Production build/TypeScript: passed, 44 static routes generated.
- ESLint for the prototype and test runner: passed.
- 19 coaching/metric tests passed: eligibility, swaps, manual ordering, exact kickoff rank locks, multi-day injury claims, no backup reuse, scoring cutoffs, empty Sub destinations, age/quality boundaries and sample win probability.
- Browser review: 1492x876, 1280x720 and 390x844. Matchup and Lineup desktop workspaces fit without page scrolling. Last Sub and Practice Squad card align. Mobile click-to-move works across section tabs.
- Verified manual multi-asset trades, partner selection, pick browsing, described-deal carousel, shopping selection retention, transaction outcome semantics, player/pick dialogs, and retained private prices.
- Feedback HTML: built from the same source and production CSS, with all images/fonts embedded. Comments survive navigation/reload, restore the correct player dialog, and export source references and view state. Final artifact gets a new commit-specific document ID so QA notes do not carry over.

## Transparent crest assets

The original team crests remain untouched. Prototype-only transparent WebP cutouts live in public/ui-refresh/crests; the already-transparent Founders crest stays in public/teams. Image generation removed baked-in backgrounds, followed by alpha verification, visual contact-sheet review, transparent-margin trimming and resizing to 256px for delivery.

Image edit prompt: "Use case: background-extraction. Edit this team crest ONLY to remove its background. Preserve the original crest silhouette, colors, typography, textures and all internal whites exactly. Output a clean cutout PNG with actual transparent alpha background, no checkerboard baked in, no white surround, no shadow, no new text. Keep the whole emblem uncropped and centered with small transparent margins. This is an existing team identity, not a redesign."

For Destroyers, explicitly preserve the interior white roundel and USS Doylestown lettering. Generated cutouts are visual approximations and the original source crests remain available for comparison.
