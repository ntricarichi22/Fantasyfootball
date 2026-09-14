# Franchise Mode: four-role interactive design prototype

## Approved direction

This is an entirely fictional, session-local UI prototype. No live league APIs, AI providers, messaging, transactions, or database writes are invoked. Refreshing resets the sample edits. Both `/` on this branch and the public-path `/login/ui-preview` render the same dummy-data interface. Existing authentication and all existing workspaces remain untouched; this branch has not been merged into production.

The user explicitly selected the existing GitHub repository and Vercel preview workflow. This iteration preserves that hosting and Next.js architecture.

## Navigation

| Role | Radial menu | Initial selection |
| --- | --- | --- |
| Coach | Matchup, Roster, Depth Chart | Matchup in season; Roster in offseason |
| GM | Strategy, Trades, Draft, Waivers, Transactions | Strategy |
| Owner | League Rules, Owners Meetings, Team Identity | League Rules |
| Around the League | Standings, Scores, League Activity, League History | Scores |

Roster contains Starters, Bench, Practice Squad, and IR. Future draft picks live under GM → Draft, with a Roster shortcut. Trades contains Build an offer, Find me offers, and Negotiations. Draft contains Big Board and Draft Picks. League Rules contains the rulebook, proposals, and sample votes. Scores combines the schedule, matchup previews, and past box scores.

Selecting a radial changes the workspace in place. Role selections, forms, filters and drafts remain mounted during navigation; switching features starts their content at the top. Deep links use `#role/feature`, optionally ending in `/expanded`. Legacy `#field` selects Coach. Browser Back restores feature selection. On desktop, expansion reduces the radial menu to an icon rail. On mobile, a feature opens at full width with a back-to-menu control. Header, role navigation and briefing remain visible while feature content scrolls. Compact role navigation labels Around the League as League.

## Visual design

- Electric blue `#3155F5`: workspace headers, primary buttons, selected controls.
- Hot orange `#FF742F`: active radial outlines, brief entry pulse, small highlights.
- Ice white `#F0F3FF`: workspace body; near-white cards.
- Midnight ink `#171B2B`: primary dark foundation and workspace text.
- Reuse existing DM Sans and Syne fonts. Scores and feature titles have stronger sports typography.
- Keep subdued full-screen illustrations. Coach retains the stadium and players with its foreground coach removed. GM retains the draft-board room; Owner retains the boardroom. Around the League gets an illustrated broadcast booth.
- The desktop shell fits the viewport. The sidebar and workspace scroll internally when needed. Each role uses identical workspace boundaries.
- The redundant dot and role label above the left hero are removed. The year and calendar phase are prominent in the shared header. A demo selector offers Week 4, Rookie Draft, and Free Agency.
- Reduced motion removes crossfades, entry movement, and the rail pulse.

## Staff briefing

A compact blue band beneath the role tabs combines a small role icon, one lead message, a relevant action, and persistent metrics. Coach shows lineup gaps, starter bye/injury flags, and lineup lock; GM shows roster capacity, remaining salary cap, waiver processing time and pending moves. Owner shows proposals and meetings; Around the League shows matchups and standings. An exceeded roster limit also remains visible in those latter roles.

Briefing actions open the appropriate roster section or feature. Filling the sample FLEX slot updates projected totals and the Coach briefing. Pending demo transactions update the GM count. Mobile expands metrics on request. Ask your staff opens a named, accessible dialog with a scripted recommendation and sample question/response interaction. No generated or live AI response is implied.

## Privacy model

The user requires team strategy and every owner's assigned player values to remain private, always. Only the sample signed-in owner's own values appear in Strategy and their player cards. Opponent trade options and the league activity feed do not show owner-set valuations, asking prices, private strategy or negotiations. This prototype contains no other owner's valuation records.

When connecting live systems later, privacy must be enforced at the server response boundary as well as in UI and AI outputs. Showing/hiding a field in the browser is not an access-control mechanism. No visibility, permission or backend behavior was changed in this UI prototype.

## Interactive sample behaviors

- Edit private availability and asking price from a shared player profile. Both Roster and Strategy read the same in-memory record.
- Start an eligible bench player at FLEX or move a starter to the bench; projected matchup totals and status counts update.
- Rank depth-chart replacements without changing the lineup.
- Change team direction, filter availability, stage a trade offer, explore scripted example returns, and inspect pending negotiations.
- Star and reorder fictional draft prospects; inspect six future draft picks.
- Search/filter available players, enter a cap-bounded bid and conditional drop, and add a pending sample claim. Pending claims do not spend salary cap.
- Filter active/past transactions, decline an offer, or withdraw a claim. All effects are local to the demo.
- Search rules, vote on a sample proposal, draft another proposal, inspect meeting agendas/notes, and mark a demo RSVP.
- Change the sample team identity and select a sample crest.
- Filter standings, choose a schedule week, open a matchup/box score, filter completed public activity, and browse sample season archives.

## Assets and validation

Two new asset files: `public/ui-refresh/sideline-v3.jpg` and `public/ui-refresh/league-v3.jpg`. Created with the built-in image-generation tool and compressed with sharp. Exact prompts are in `docs/ui-refresh-v3-art-prompts.txt`. Previous assets are preserved.

Validate with TypeScript, targeted ESLint and `npm run build`. Browser checks cover desktop/mobile layouts, expansion, navigation, private player edits across roles, lineup/briefing updates, pending claims, retained trade drafts, sample proposals and basic accessibility. No live roster or transaction integration is part of this design review.
