# CFC Front Office — Phase 0 Recap

**Status:** Complete
**Merged to main:** May 18, 2026
**Deployed:** Live in production

This doc captures the state of the repo after Phase 0. Future phase chats should attach this alongside the relevant phase spec and `CFC-APP-STATUS.md` to understand the current foundation.

---

## What Phase 0 Did

**1. Mechanical reorg.** Files moved out of `src/components/` and `src/lib/` into surface-based folders that match the v3.0 mental model. Old paths are gone.

**2. Closer persona band fixed.** 0.85–1.00 (was 0.90–1.15). Lives in both `src/pro-personnel/trade-engine/core/gap.ts` and `src/pro-personnel/trade-engine/studio/persona.ts`.

**3. God file killed.** `src/app/page.tsx` is now slim (~330 lines, home-only). All draft logic extracted to `src/scouting/draft-room/DraftRoom.tsx`. The `/scouting/draft-room` URL is independent from the home URL.

**4. `(app)/` route group deleted.** No more grouped layouts. Each surface has its own URL folder.

**5. AppShell stripped.** `src/shared/chrome/AppShell.tsx` deleted entirely. No persistent global nav. Home screen IS the nav (per v3.0 spec). Inner pages get their own `InnerTopbar` (built per-phase).

**6. DraftStatusProvider + ClockBar scoped.** Used to wrap all pages; now scoped to the draft route only via `src/app/scouting/draft-room/page.tsx`.

---

## Current Folder Structure

```
src/
├── app/                          # Next.js URL routes (thin wrappers only)
│   ├── page.tsx                  # Home — renders HomeScreen
│   ├── layout.tsx                # Root layout (fonts, html, body)
│   ├── globals.css
│   ├── api/                      # API routes
│   │   ├── inbox/                # Trade threads + status + insider feed
│   │   ├── pro-personnel/        # Trade advisor, create, targets, trade-studio
│   │   ├── research-strategy/    # Team-hq endpoints
│   │   ├── scouting/draft/       # Draft state, clock, log, order, tick
│   │   └── (other routes)
│   ├── historian/                # Historian URL
│   ├── inbox/                    # Inbox URL (was /trades)
│   ├── pro-personnel/
│   │   ├── trade-builder/
│   │   └── trade-studio/
│   └── scouting/draft-room/      # Draft Room URL (was /draft)
│
├── components/                   # Legacy — only HomeScreen and gated files left
│   ├── HomeScreen.tsx            # Stays here until Phase 1 rewrite
│   ├── gm-office/                # InboxPage, FilterBar, TradeCard (gated, Phase 2)
│   ├── owners-box/               # OwnersBoxView, StrategyTab, etc. (gated, Phase 6)
│   └── trade/                    # LandingPage, CartSidebar, ConfirmModal, RosterModal (gated, Phase 5)
│
├── scouting/draft-room/          # Draft surface
│   ├── DraftRoom.tsx             # Main component (extracted from god file)
│   ├── chrome/                   # ClockBar, DraftTicker, DraftStatusProvider, DraftCompleteModal
│   ├── hooks/                    # useDraftBoard, useDraftClock, useDraftStatus, etc.
│   ├── mobile/                   # MobileDraftRoom, MobileClockBar, MobileTicker
│   └── (helpers, types, constants, grades, etc.)
│
├── pro-personnel/                # Pro Personnel surface
│   ├── trade-builder/            # TradeBuilder, DealCard, AIAdvisor, PlayerRow, etc.
│   ├── trade-studio/             # TradeStudioView, OfferCard, RosterPanel, etc.
│   └── trade-engine/             # core/, advisor/, studio/, profile, starterLevel, value
│
├── inbox/                        # Inbox surface
│   ├── thread/                   # ThreadPage, ChatBubble, AcceptModal, RejectModal, CounterDrawer
│   ├── insider/                  # InsiderPanel
│   └── persona/                  # PersonaCard, PersonaPicker
│
├── research-strategy/api/        # R&S backend (was lib/team-hq)
│
├── historian/                    # Historian surface (components + leagueHistorySync)
│
├── onboarding/                   # Onboarding components
│
├── shared/                       # Cross-surface
│   └── ui/                       # Card, TradeBalanceChip
│
└── infrastructure/               # Cross-cutting infrastructure
    ├── supabase/                 # client.ts, admin.ts
    ├── sleeper/                  # api.ts, useSleeperData.ts
    ├── identity/                 # storedTeam, activeTeams, useIdentity, useMyRoster, rosterBackfill
    ├── picks/                    # picks/index.ts
    ├── llm/                      # LLM utilities
    ├── values/                   # Value pipeline (FantasyCalc, KTC, DynastyProcess)
    ├── league/                   # leagueRankings
    ├── strings/                  # normalize
    ├── hooks/                    # useIsMobile
    ├── commissioner.ts
    └── config.ts
```

---

## Killed in Phase 0

- `src/components/AppShell.tsx`
- `src/app/(app)/` (entire route group)
- `src/app/(app)/layout.tsx`
- `src/app/(app)/team-hq/` (deleted — Phase 6 rebuild)
- `src/app/(app)/team-snapshot/`
- `src/_disabled_league-history/`
- Persistent global nav with Draft Room / Historian / Team HQ / Trade Center links
- Active Team display + Switch button in topbar
- Unread trade count badge in topbar
- The `import DraftRoom from "../../page"` god-file pattern

---

## Known Gaps / What's Still Pending

**`/team-hq` URL 404s.** Intentional — Phase 6 rebuilds Owner's Box and splits `StrategyTab.tsx` into Set Strategy + Set Availability + Settings. Until then, clicking Owner's Box on the home screen 404s.

**Home screen still v2.x.** `src/components/HomeScreen.tsx` is the old version with DoorCard components and v2 nav. Phase 1 rewrites this around the v3.0 org-chart spec.

**Inbox still v2.x.** `src/components/gm-office/InboxPage.tsx`, `FilterBar.tsx`, `TradeCard.tsx` are the v2 versions. Phase 2 rebuilds around Gmail-style row layout + filter chips.

**Director offices don't exist yet.** Phases 3–5 build them.

**DraftRoom.tsx is 1097 lines** but no longer a god file — it's one file doing one thing (the draft room). Internal refactor optional, not blocking.

---

## Conventions Going Forward

**Surface-based component folders.** New components for a phase go inside that phase's surface folder. Home → `src/home/`. Phase 1 introduces this folder when rewriting HomeScreen.

**Thin URL wrappers in `src/app/`.** Each `page.tsx` in `src/app/` should be small — auth/identity check + mount the real component from outside `app/`. The work happens in the surface folder.

**No persistent chrome.** AppShell is gone. Each route handles its own chrome (e.g., the draft route adds DraftStatusProvider + ClockBar in its page wrapper). Inner pages will get an `InnerTopbar` component as phases need it.

**API URL conventions:**
- `/api/inbox/...` for trade correspondence + insider feed (NOT `/api/trades/...`)
- `/api/pro-personnel/...` for trade advisor + create + targets + trade-studio
- `/api/research-strategy/...` for R&S endpoints (NOT `/api/team-hq/...`)
- `/api/scouting/draft/...` for draft endpoints (NOT `/api/draft/...` or `/api/draft-*`)

---

## Starting a Phase 1+ Chat

Attach:
1. This file (`CFC-PHASE-0-RECAP.md`)
2. `CFC-APP-STATUS.md` (non-negotiables)
3. The relevant phase spec (e.g., `CFC-HOME-SCREEN-SPEC.md`)
4. Any current files the phase will rewrite (paste in chat if small, attach if large)

Open with something like:

> Starting Phase N: [phase name].
> Phase 0 is complete and deployed.
> Read the attached spec + recap. Walk me through the approach before writing code. Process: ideate → mockup → iterate → code, never jump ahead.

---

## End of Recap
