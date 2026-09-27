# Franchise Mode — feedback (6), review v10

September 27, 2026. Applies the 14 active notes in `Franchise Mode - Feedback (6).json`, exported against v9 (`4f6864d`), together with the subsequently confirmed button color. One note contains only `th`; it has no actionable instruction. The detailed Transaction History note supplies that screen's direction.

## Shared style

- The confirmed accent is **#655734**, sampled from the user's reference. It replaces #F4C361. Primary, secondary, compact, and icon action controls use solid bronze with light text. Hover retains the same fill; disabled controls retain their disabled treatment.
- Navigation and clickable player/pick rows retain their existing hierarchy and green data surfaces. Bronze is used for selection rails, borders, and indicators. Essential text stays light for contrast against dark scenes. No solid bronze informational panels were introduced.
- Draft-pick provenance is part of the main identity: `2028 Rd 2 (via Browns)`. The shared display helper is used in Strategy rows/settings, shop lists, trade browsers, selected assets, sample offers, negotiations, and history. Canonical names and IDs stay unchanged for trade matching.
- Owner and League feature layouts are unchanged. Shared accent corrections apply throughout the prototype.

## Coach

- Matchup adds the nine opponent headshots at the far right. Assets were retrieved by exact normalized player name from Sleeper's player directory, then downloaded from Sleeper's portrait CDN. They are local WebP assets embedded in the feedback HTML.
- Game time/clock and opponent occupy consistent columns on both halves. Mirrored identities and scores keep the existing alignment, including actual/final projection comparisons and the substitution presentation.
- Removed only Lineup's redundant bottom substitution summary. Matchup scoring explanations and the substitution rules are unchanged.
- Rank by projections remains an actionable bronze button. The comment's ambiguous first sentence is interpreted alongside its explicit rule that only buttons receive solid accent fill.

## GM

- Shop Your Guys pick rows are uniformly sized to the player rows. Their grid uses the configured starting-slot count, not a hard-coded roster count. Pick origins cannot change row height.
- Build an Offer's action reads **Send it**. Counteroffers retain their existing label and behavior.
- Mock Draft uses a **40% board / 60% workspace** split, excluding the gutter. Your Roster shows configured Starters and ranked Subs side by side with the draft class above. It does not add separate IR or Practice Squad columns or change the underlying fixture inventory.
- Pending claims visibly fill the available-player row in exact solid bronze. Their pending-claim ledger keeps its existing green rows. Removed the visible salary-cap caption; the amount retains an accessible label.
- Transaction History uses compact green records separated by four-pixel dark gaps, without interior line rules or a green container. Column labels are small and unboxed rather than a heavy header band. Outcomes remain prominent, with Declined and Outbid red. Historical-only scope, partner/actor labels, bid versus spent semantics, and filters remain unchanged.

## Verification

- Production build and TypeScript pass; 44 static routes generated. Prototype ESLint and git whitespace checks pass.
- All 19 existing coaching/player-metric tests pass from a fresh bundle. Scoring, kickoff locks, substitute priority, configuration-derived eligibility, and roster movement logic are unchanged.
- Browser checks at 1492×876 and 1280×720 confirm loaded opponent portraits, consistent matchup game columns, and nine visible matchup rows without internal scrolling. At 1280×720, all 18 draft-roster players and a selected prospect fit; all six history records fit.
- Shop picks and starter-player rows both measure 28.5px at 1280×720, including the pick with provenance. The selected pick's origin carries into the generated sample offer.
- Verified the Send it action is enabled with a complete sample offer, computes to RGB(101,87,52) with light text, and creates a local sample negotiation. Verified a saved waiver claim computes to the same solid fill.
- Mobile checks at 390×844 show no page-level horizontal overflow for Matchup or the new draft roster; both roster columns contain all 18 active players.
- Two comments on separate views survive navigation and reload. Show element restores the saved waiver view and sample claim. The final HTML receives a new commit-specific review ID without QA comments.

Source and the self-contained feedback HTML remain local, on `ui-refresh`. No live connections or public deployment were added.
