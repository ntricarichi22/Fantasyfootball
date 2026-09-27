# Franchise Mode — approved review build

Source of truth: user feedback export dated 2026-09-26 plus subsequent Coach decisions. This supersedes v3. Work stays on ui-refresh; no production merge. All actions, injuries, scores, drafts, votes and trades are fictional and local. No live connectors or AI calls.

## Checkpoints

- [x] Shared shell: scene-first role entry; expanded radial navigation for task choice; collapsed icon rail in focused workspaces; overlay reveal; keyboard/touch/back navigation; responsive layouts.
- [x] Premium art direction: bold condensed white type, gold/amber accents, cinematic illustrations, image-led compact task tiles, translucent dark workspaces; no blue/white dashboard panels or staff briefing.
- [x] Coach: Matchup and Lineup only. Nine starters, nine Subs, two Practice Squad, unlimited IR (seven visible test case). Three columns; reserves stacked. Shared league eligibility and configuration-driven slot list. No duplicate eligibility logic.
- [x] Subs: projected initial order; projected insertion preserves manual order and exact locked ranks; only own kickoff locks role/rank. Drag and keyboard/tap controls, legal swaps. Final bench determines replacements. Injury order uses real event chronology; scoring uses each game's elapsed-clock cutoff. No double-use. No injury-triggered locks or starter-kickoff snapshots. Demonstrate with fictional events.
- [x] Strategy: one screen; QB/RB/Pass Catchers/Draft Picks rooms, assets and private trade settings left, Thin/Set/Deep and needs right. No rebuilding/retooling selector. Never expose other-owner values.
- [x] Trades: Build an Offer / Shop Your Guys / Active Negotiations tiles; focused forms, clear return.
- [x] Draft: Build Your Board / Enter Draft Room / Do a Mock tiles; inactive draft disabled; owned picks accessible.
- [x] Waivers: cap, processing countdown, player ranks/details, slot eligibility filters + Rookie; editable/reorderable/cancellable pending ledger, bid chips; no competing-bid disclosure.
- [x] History: completed/declined/withdrawn trades and won/lost waivers; All/Trades/Waivers tabs; active work stays in Trades/Waivers.
- [x] Owner: rules-category tiles with proposals; meeting tiles with upcoming/past details; compact identity editor.
- [x] League: broadcast art; division standings; six-team three-round bracket with top two byes; week chips/current dot; records and projected game line; complete box scores; coherent activity/history.
- [x] Verification: TypeScript, lint, production build, meaningful coaching-rule tests, browser desktop/mobile and retained state; exact standalone feedback HTML with embedded assets and persistent contextual comments.

## Configuration and pending integration decisions

The demo supplies the same rosterPositions configuration shape as the shared league layer. Presentation derives slots dynamically and imports the existing slotEligibility helper; it does not call a live league API. User-specified configuration: QB, SUPER_FLEX, RB, WR, WR, FLEX, FLEX, REC_FLEX, REC_FLEX. Actual injury qualification, timestamp confidence, stat-correction/OT/tie handling and data-provider choice require validation before live scoring. Demonstration fixtures are not production league rules.

## Review delivery

Build the site first, verify, then bundle the exact same source/styles into the feedback HTML. Preserve original feedback JSON. Temporary builders and QA files live outside the project. Retain a subtle overall sample-data notice rather than repeated DEMO labels. Keep team identity/calendar prominent. Nine-player Lineup and Matchup may use taller focused workspaces than the compact task selection view; do not force everything into a short card.

## Verification record — September 26, 2026

- `npm run build`: production build and TypeScript passed; 44 static routes generated.
- `npx eslint src/home/prototype scripts/test-ui-preview.mjs --max-warnings 0`: passed.
- `node --test scripts/test-ui-preview.mjs`: 15 rule tests passed. Includes configurable slots, legal swaps, preserving manual order, exact kickoff locks, Thursday-before-Sunday injury claims, no backup reuse, and discrete scoring-play cutoffs.
- Browser checks: 1440×900, 1440×768, 1280×720 and 390×844. Desktop focuses on fitting the nine starting slots; small phones scroll within the feature. Larger asset lists use pagination. Expanded scoring explanations can scroll.
- Verified drag from a Sub card into an eligible starting slot, touch Move controls, initial projected order and legal promotion, player profile, final substitution scenarios, retained strategy edits, trade notes/negotiations, editable waiver bids and eligibility filters, meeting tiles, division standings and playoff bracket.
- Feedback workflow verified: comments on Standings and Scores survive reload, remain separate, restore the original view/element, and export the corresponding source reference. Final deliverable starts with no test comments.
- No live data, AI generation, league transactions, votes or production scoring integrations are enabled. Projected offers, historical records, injury timestamps, scores and player metadata are illustrative.

## Visual assets

The existing sideline, draft office and boardroom scenes remain the role artwork. New `public/ui-refresh/league-v4.jpg` is generated for this revision. Prompt: create a premium illustrated sports-game broadcast studio overlooking a packed nighttime football stadium; wide 16:9 composition, angular desk, silver football trophy, microphones, curved LED screens with abstract route diagrams and a bracket; open dark space on the left; amber/gold light, navy and restrained cyan; painterly edges with cinematic contrast; no people, brands or readable text. The prior league scene supplied visual style reference only.

Barlow Condensed supplies the condensed sports typography (500/600/700/800). Local fonts include the SIL Open Font License in `public/ui-refresh/fonts/OFL.txt`. Player portraits were downloaded once from the existing Sleeper CDN convention and are local assets, matched to NFL fantasy positions to avoid duplicate player names. These image downloads do not connect the prototype to live roster or scoring data.

## Delivery boundaries

Changes are limited to the `ui-refresh` prototype, its assets, design record and coaching tests. The generated Next.js agent guidance is retained as produced by the local framework. No merge to production. The standalone HTML bundles the committed source and compiled CSS, records the source commit, and embeds all required images and fonts. Existing exported user feedback remains untouched.
