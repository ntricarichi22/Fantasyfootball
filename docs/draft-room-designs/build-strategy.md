# CFC Draft War Room — PR & Build Strategy

> **Companion doc to** [`draft-war-room-spec.md`](./draft-war-room-spec.md).
> The spec answers _what_ to build. This doc answers _how_ and _in what order_.

---

## Original Prompt

The verbatim kickoff prompt is preserved at
[`./original-prompt.md`](./original-prompt.md). It defines the build order
(Clock Bar → Board → Scouting Card → Roster → Assistant GM → Ticker → Global
Mode → Mobile → Trade Integration), the exact letter-grade rubrics, the
component file layout, the Anthropic API call shape, and an explicit "Do NOT"
list (no rounded corners, no gradients, no graying-out drafted players, no API
calls on card click, etc.).

The follow-up question that produced **this** strategy doc was effectively:
**"Stack one giant PR, or slice it up? If we slice it, how thin?"**

The answer: slice it thin, merge serially, never let a stack go more than two
deep without merging the bottom.

---

## Guiding Principles

1. **Each PR is independently shippable.** It either lands a complete vertical
   slice of value, or it is a pure no-op refactor that can be reverted on its
   own without breaking anything else.
2. **Behavior changes and structure changes never share a PR.** Refactors are
   allowed to move code; they are not allowed to change rendered output. New
   features are allowed to change rendered output; they are not allowed to
   reshape unrelated code.
3. **Foundation before consumers.** Hooks, providers, and shared components
   land before the UI that depends on them. This is what enables thin slices.
4. **Merge serially. Stack at most two deep.** Stacking 4–5 PRs blocks all of
   them on the bottom one and turns review-feedback rebases into a cascade.
   Get the bottom merged into `main` before starting the third.
5. **No drive-by changes.** If a PR is "extract helpers," it does not also
   restyle a button. Keep diffs scoped so reviewers (and `git bisect`) have a
   chance.
6. **Every PR is verified the same way before opening:** `npm run lint`,
   `npm run build`, manual smoke test of the draft room page, manual smoke
   test of one non-draft page.

---

## Why Not One Big PR

The temptation is real — the spec is finished, the design is locked. But the
risks compound:

| Risk | Why it matters here |
|---|---|
| **Debugging surface** | If "the draft page is broken," is it the new clock bar, the refactor of `page.tsx`, the new board table, or the new Assistant GM data hook? With one PR, all four are suspect. With ten, `git bisect` is trivial. |
| **Review quality** | A 5,000-line diff gets rubber-stamped. A 200-line diff gets read. |
| **Rebase cost** | Any change to `AppShell.tsx`, `page.tsx`, or the design tokens conflicts with everything else still in flight. Smaller PRs that land quickly minimize the window. |
| **Partial value** | A global clock bar is useful on its own, before the board redesign exists. Bundling means nothing ships until everything ships. |
| **Agent context drift** | Each fresh agent session re-derives the codebase. If the agent's `main` is missing PR 1's hook, it may duplicate it. Merging serially keeps `main` honest. |

---

## Why Not Six PRs (the original count)

The first cut was six PRs. Two of them were doing too much:

- **Old "Refactor `page.tsx`"** was one PR. That file is 2,362 lines and is
  the spine of every draft feature. A single refactor PR is the highest-risk
  change in the entire program — it touches realtime sync, the clock,
  submissions, and the board all at once. Split into **three pure-refactor
  PRs** (helpers, presentational components, data hooks) so each is
  mechanical and revertable.
- **Old "Roster + Assistant GM panel"** combined a mostly-static reference
  panel with an AI surface that has its own briefing query, recommendation
  query, and chat plumbing. Split into **two PRs** so the Assistant GM's
  data and AI dependencies don't block the simpler Roster panel.

Net: **10 PRs instead of 6.** More PRs, smaller blast radius per PR, faster
review per PR, faster recovery if any one of them needs a revert.

---

## The Build Plan

### Sequencing at a glance

```
PR 1 ──► PR 2a ──► PR 2b ──┐
                            ├──► PR 4 ──┐
PR 3a ──► PR 3b ──► PR 3c ──┤           │
                            ├──► PR 5 ──┤
                            │           ├──► PR 7
                            └──► PR 6 ──┘
```

- The **2 series** (clock bar, ticker) is a vertical slice. It can run in
  parallel with the **3 series** (refactor) once PR 1 is on `main`.
- The **3 series** is strictly serial — each refactor builds on the last.
- PR 4, 5, 6 are siblings; once 2 and 3 are on `main` they can run in
  parallel but each should still be its own PR.
- PR 7 (mobile) lands last because it depends on the final shape of the
  board, roster panel, and Assistant GM panel.

### Two-deep stacking rule

You may open the next PR while the previous one is in review (one level of
stacking). You may **not** open a third PR on top of an unmerged stack. If
the bottom PR needs changes, the cascade rebase is the cost of greed.

---

### PR 1 — `useDraftStatus` hook + `DraftStatusProvider` ✅ _(this branch)_

**Goal:** One shared subscription to `/api/draft-state` for the whole app.

**Changes**
- `src/lib/hooks/useDraftStatus.ts` — polling hook (default 10s, floor 2s)
  returning `{ status, isActive, secondsRemaining, state, isLoading }`.
- `src/components/DraftStatusProvider.tsx` — context provider +
  `useDraftStatusContext()` so the hook mounts once instead of per consumer.
- `src/components/AppShell.tsx` — wraps children in `<DraftStatusProvider>`.

**No visible change.** Consumers land in PR 2a / 2b.

**Definition of done:** lint + build clean, no UI regression on any page.

---

### PR 2a — Global Clock Bar

**Depends on:** PR 1 merged.

**Goal:** The persistent clock bar from the spec (§Clock Bar, §Global Draft
Mode) becomes part of `AppShell` and is rendered on every page when
`isActive` is true.

**Changes**
- `src/components/ClockBar.tsx` — three states from `clock-bar-states.PNG`
  (on the clock / paused / not started). Uses `useDraftStatusContext()`.
- `src/components/AppShell.tsx` — render `<ClockBar />` directly under the
  top nav, gated on `isActive`.
- "Back to draft" action button when not on the draft room route; "Shop My
  Pick" deep link when the user is on the clock.

**Out of scope:** the ticker (PR 2b), board redesign (PR 4).

**Definition of done:** clock bar renders correctly in all three states on
the draft page _and_ on a non-draft page (e.g. team HQ); disappears when
`isActive` is false.

---

### PR 2b — Global Draft Ticker

**Depends on:** PR 2a merged.

**Goal:** While `isActive`, the existing site-wide blue ticker is replaced
by the draft ticker (spec §Draft Ticker, `ticker-format.PNG`). When inactive,
the normal ticker returns.

**Changes**
- `src/components/DraftTicker.tsx` — entry format, scroll behavior (newest
  on the right scrolling left).
- `src/components/AppShell.tsx` — conditional swap of the bottom ticker.

**Definition of done:** correct ticker is shown depending on draft state on
both draft and non-draft pages; no layout shift when swapping.

---

### PR 3a — Extract pure helpers and types from `page.tsx`

**Depends on:** none (parallelizable with the 2 series).

**Goal:** Pure-refactor PR #1 of 3. Move pure functions, type definitions,
and constants out of `src/app/page.tsx` into co-located modules.

**Rules**
- **No rendered output may change.** Snapshot the draft page before/after.
- No new dependencies. No restyling. No prop renames in components.

**Likely targets:** ranking helpers, sort comparators, formatting utilities,
shared types.

**Definition of done:** `page.tsx` shrinks; everything still renders byte-for-byte.

---

### PR 3b — Extract presentational sub-components from `page.tsx`

**Depends on:** PR 3a merged.

**Goal:** Pure-refactor PR #2 of 3. Lift inline JSX blocks into named
components in `src/components/` (e.g. board row, position badge, progress
bar) — but only the components, not their data sources.

**Rules**
- Components receive their props from the existing call sites; no new state,
  no new fetches.
- Name and file structure should match the spec's section names so PR 4 has
  obvious slots to fill.

**Definition of done:** `page.tsx` shrinks again; rendered output unchanged.

---

### PR 3c — Extract data hooks from `page.tsx`

**Depends on:** PR 3b merged.

**Goal:** Pure-refactor PR #3 of 3. Move Supabase queries and derived-state
calculations into dedicated hooks under `src/lib/hooks/`.

**Rules**
- Hooks return the same shapes the inline code currently produces. No
  caching changes, no new realtime channels.

**Definition of done:** `page.tsx` is now a thin composition file. Realtime
sync, clock, and submission still work identically.

---

### PR 4 — Draft Board redesign

**Depends on:** 3c merged. (2-series can be in flight in parallel.)

**Goal:** Replace the existing player table with the spec'd board: filter
chips, the three-column responsive table, the position badge, the
rookie/vet chip, the value/fit progress bars, and the row → scouting card
flip modal.

**Changes**
- `src/components/draft/FilterChips.tsx`
- `src/components/draft/DraftBoardTable.tsx`
- `src/components/draft/ScoutingCardModal.tsx` (front + back, animation)
- Wire fit score from `buildLeagueProfiles` / `computeCoreTeamStrength`.
- Pre-compute letter grades for top 20 rookies on page load (per spec
  §Letter Grades).

**Out of scope:** roster panel, Assistant GM, mobile.

**Definition of done:** board renders per `desktop-full-war-room.PNG`;
modal matches `player-card-flip.PNG`; sort/filter behavior preserved.

---

### PR 5 — Roster panel

**Depends on:** 3c merged.

**Goal:** The left-side roster panel (spec §Roster Panel): toggle behavior,
team needs card on top, lineup card below with independent scroll.

**Changes**
- `src/components/draft/RosterPanel.tsx`
- `src/components/draft/TeamNeedsCard.tsx`
- `src/components/draft/LineupCard.tsx`
- Reads team needs from existing `buildLeagueProfiles`.

**Definition of done:** matches spec; toggling collapses/expands without
layout jank; lineup scrolls independently of team needs.

---

### PR 6 — Assistant GM panel

**Depends on:** 3c merged.

**Goal:** The right-side Assistant GM (spec §Assistant GM Panel): left-edge
accent, briefing card, recommendation card, chat interface, chat input.

**Changes**
- `src/components/draft/AssistantGmPanel.tsx`
- `src/components/draft/BriefingCard.tsx` ("Since you left", "Trends")
- `src/components/draft/RecommendationCard.tsx`
- `src/components/draft/ChatInterface.tsx` + input
- Briefing query: recent picks from Supabase.
- Recommendation logic: combine fit + value + needs (uses outputs from 3c
  hooks and PR 5's needs data — no duplicated logic).
- Wire LLM endpoint per `src/lib/llm/`.

**Definition of done:** matches `assistant-gm-panel.PNG`; chat round-trips
through the LLM endpoint; briefing populates on mount; recommendation
updates when state changes.

---

### PR 7 — Mobile layout

**Depends on:** PRs 4, 5, 6 all merged.

**Goal:** Spec §Mobile Layout. Compressed clock bar, three-tab bar
(Board / Roster / Asst GM), full-screen tab content, smaller bottom ticker.

**Changes**
- Responsive variants of `ClockBar`, `DraftTicker`.
- `src/components/draft/MobileTabBar.tsx`.
- Mobile board variant (three columns: Pos, Player, Val/Fit).
- Mobile roster + Assistant GM tab views.

**Definition of done:** matches the three mobile reference screenshots; no
desktop regression; tab switches don't lose scroll position within a tab.

---

## Verification Checklist (per PR)

Before opening any PR in this series:

- [ ] `npm run lint` clean.
- [ ] `npm run build` clean.
- [ ] Manual smoke: load the draft room with an active draft, confirm clock
      ticks, confirm a pick can be submitted (only re-test submission for
      PRs that touch the data path).
- [ ] Manual smoke: load one non-draft page (e.g. Team HQ), confirm no
      regression and — for the 2 series — that global chrome appears /
      disappears with draft state.
- [ ] PR description states **what changed**, **what didn't**, and **what's
      explicitly out of scope** (so reviewers know what _not_ to ask for).

---

## What to Do If a PR Goes Sideways

- **PR is broken on `main`:** revert it. Each PR is small enough that
  reverting a single one is safe and doesn't unwind the rest.
- **Review feedback requires significant changes:** finish the changes on
  the same branch. Do not start the next PR until this one is merged — the
  rebase cost is not worth it.
- **A refactor PR (3a/3b/3c) accidentally changes behavior:** that is the
  bug. Revert and re-do. Refactor PRs have a zero-tolerance behavior-change
  rule precisely so this is detectable.

---

## Status

| PR | Title | Status |
|----|-------|--------|
| 1 | `useDraftStatus` + `DraftStatusProvider` | ✅ on this branch |
| 2a | Global Clock Bar | ⏳ |
| 2b | Global Draft Ticker | ⏳ |
| 3a | Extract helpers/types from `page.tsx` | ⏳ |
| 3b | Extract presentational components from `page.tsx` | ⏳ |
| 3c | Extract data hooks from `page.tsx` | ⏳ |
| 4 | Draft Board redesign | ⏳ |
| 5 | Roster panel | ⏳ |
| 6 | Assistant GM panel | ⏳ |
| 7 | Mobile layout | ⏳ |
