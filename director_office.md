# The Director Office — Chat Room Spec

> North star for every director office page (`/scouting`, `/pro-personnel`, `/strategy`).
> This is the presentation-layer counterpart to `trade_brain.md` (the engine).
> The spec below is written through the Scouting Director; the template is universal
> and each director adapts it to his lane (see "Adapting per director" at the bottom).

---

## The shape of the room

You tap a director's door from the home screen org chart and land in his office —
a full-width chat. At the top: his **one-line greeting**. Below it, **up to three
tappable headline cards**, each just a headline and a teaser line designed to earn
the click ("Pick 2 — stand pat and take Love").

**He never dumps a long speech when you open the door.** The headline is the hook;
the full read only unfolds when you tap it.

## The read (what unfolds on tap)

Every full read follows a set rhythm, delivered as one longer chat message written
like a person talking:

1. **How I expect things to break** — his projection of the situation.
2. **The one realistic pivot** — the single scenario that would change our plan.
   Included ONLY if one genuinely exists. Never a hedge-list.
3. **My call** — his recommendation, delivered with conviction. Never wishy-washy.

The read ends with a row of **action buttons** (see below).

## Headline lifecycle

- A headline **fires once** and stays quiet unless something **material** changes.
- If he disagrees with a setting you've made, he does NOT nag with a separate
  card — he **sharpens the headline he already has**.
- If you tell him "leave it as is," he **drops it for good**.
- On a day when nothing clears the bar: a short **"all quiet" line** that
  references something real and **ends with a question**, so the room never
  feels dead. No manufactured urgency.

## What his buttons can do (and where his job ends)

Every recommendation carries buttons in one of three classes:

1. **Instant commits** — small, safe actions he executes on the spot and
   **confirms back in chat** ("Done, 1.02 is untouchable."). Examples: mark a
   pick untouchable, star a target, set an attachment level.
2. **Workroom handoffs** — send you into a workroom (trade machine, big board,
   mock draft) **pre-loaded with his case**: counterparty seeded, asset seeded,
   his lean attached. **He frames the deal; the engine builds the offers. He
   never pretends offers already exist.**
3. **Cross-director handoffs** — when the question leaves his lane, he routes
   you to the right director rather than answering out of lane.

## Progressive disclosure

Information reveals in stages, never all at once:

- His **read** first.
- Then, if you ask, **up to three real trade partners** (each with why they fit,
  each with its own button).
- Then **per-team exploration** (the workroom handoff).

## Office vs. inbox — the hard line

- The **office** is for **live, act-now opinions**.
- Anything **routine or digest-shaped** (weekly risers/fallers, pre-draft
  reports) is sent as an **inbox memo** instead.
- **Dedupe rule:** he never sends two emails about the same thing, and the
  office and inbox never duplicate each other.

## Voice

- **"We" and "us"** — he works for this franchise.
- **Real names**, never IDs. **No numbers** — no point values, ratios, or
  percentages; natural language only ("noticeably more," "in the same ballpark").
- **Lane discipline:** picks are Scouting's turf; players/trades belong to
  Personnel; posture/market settings belong to Strategy. Directors reference
  each other by title and hand off rather than poach.
- Conviction over hedging. A call is a call.

---

## The canonical journey (Scouting example)

1. You tap the Scouting door. The office opens: greeting + up to three cards.
   One reads: *"I've got Round 1 mapped out, plus a couple ways to play our
   picks — want to see?"*
2. You tap it. It unfolds in-thread: how he expects the round to break, that
   Love should slide to us at 2, and his call — **stand pat**. Below it, two
   buttons: **Mark 1.02 untouchable** and **See who'd fit a trade back →**.
3. You tap the trade-back option. He does NOT dump offers — he replies with a
   second message naming the **three teams that genuinely fit and why**, each
   with its own button.
4. You tap **Explore a trade back with the Birdmen →** and land in the trade
   machine, seeded with our pick, the Birdmen as counterparty, and his lean
   (accumulate picks). The engine takes over and generates the actual offers.

---

## Doors — one room, multiple entry intents

The office is ONE chat surface; what differs is the **door** you came through.
Each door has its own defined opening shape:

- **The office door** (org-chart "ENTER →"): the POV-headline opening above —
  greeting + up to three intel headlines.
- **A workroom door** (e.g. "Build a Trade"): a guided, task-shaped opening
  (see below). Same room, same character, different script.
- **A memo's play button** (future): opens the room mid-conversation, seeded
  with the memo's subject.

## The "Build a Trade" door (Pro Personnel)

Clicking "Build a Trade" lands in the Personnel director's chat — NOT a landing
page. The old Builder landing folds into this room as a drawer.

**Opening, single-storyline team:** the director explains the one storyline and
why he has conviction in it, then presents that storyline's **goals as CTAs**.

**Opening, two-storyline team:** "I think there are genuinely two ways we could
go from here…" — he argues each (preserving the intent-vs-engine flavor:
"here's your plan, and here's what the roster is telling me"), then surfaces
one CTA per storyline. Picking one gets his read on the goals that achieve that
vision, then proceeds like a single-storyline team.

**Rules:**
- A goal CTA only surfaces if **real offers survive behind it** — the director
  never advertises an empty door.
- Tapping a goal opens the **offer drawer**: the OfferCard carousel scoped to
  that goal's offers (Pass / Edit / Make this offer all carry over).
- **PASS is on the deal, not the framing** — an offer passed under one goal is
  hidden everywhere it appears.
- The user can always **pivot or build their own** — a persistent escape hatch
  routes to the manual trade machine (the existing `?seed=fresh` flow).
- **Latency choreography:** the room opens instantly on the narrative bundle
  (storylines/pitches are cheap); the offer slate generates in the background
  while the director "makes calls." Goal CTAs light up when the slate lands;
  clicking early gets a "still working the phones" state.
- **Conviction prose:** storyline framing uses the LLM (builder voice, fed the
  bundle's evidence), not the templated pitch strings.

## Drawers

- **Desktop:** drawer slides in from the RIGHT at ~50% page width; the chat
  collapses to the left ~50% and stays interactive (the room remains present).
- **Mobile:** the drawer is a **bottom sheet** — slides up from the bottom,
  near-full height (~92%), drag handle + overlay-tap to dismiss, a sliver of
  the chat visible behind. Follow the existing `MobileBottomSheet` pattern
  (`src/scouting/draft-room/mobile/MobileBottomSheet.tsx`); chrome per
  DESIGN_SYSTEM.md "Modals / Drawers".

## Adapting per director

The template is identical; the **intel sources** and **lanes** differ.

### Scouting (`/scouting`)
- **Lane:** the draft. Picks, prospects, the board, mocks, draft-day movement.
- **Intel:** draft position read (who's ahead of us leaning what), board value
  drift, pick-trade partners, draft-fit vs. our strategy.
- **Workrooms:** Big Board, Draft Room, Mock Draft; trade machine for pick deals.

### Pro Personnel (`/pro-personnel`)
- **Lane:** the trade market for players. Veterans, inbound interest, other
  owners' availability.
- **Intel (from the trade engine + trade_offers):** our active theses → goals →
  vetted offers (the Builder slate); inbound offers ("two teams just texted
  about your RB"); market temperature by position; partner storylines (who's
  selling what, who's desperate where); fire-sale / liquidation opportunities.
- **Headline examples:** *"Brokepark would pay a 1st for Mahomes — I'd listen,"*
  *"Ridgeville needs RB rotation help; Tuten's our chip,"* *"Owner X looking to
  move a vet we should want."*
- **Workrooms:** Build a Trade (Builder cycler), Shop My Guys (Studio). Handoffs
  seed the counterparty + assets + lean, same as the existing `?seed=` flows.
- **Voice notes:** he's the one who "made calls around the league." The
  OfferCard verdict chip and the builder-mode advisor prose are already his
  voice — the office chat is the same character, upstream of those surfaces.

### Strategy (`/strategy`)
- **Lane:** our posture. Team direction, market settings, availability,
  roster-construction gaps.
- **Intel:** roster gap analysis (WR3/TE thin), standings/trajectory read,
  posture freshness ("your settings predate the injury"), schedule/availability.
- **Workrooms:** Set Strategy, Set Availability.

---

## Mapping to existing code

- **Chat components:** `src/shared/director-chat/index.tsx` already models this —
  `director_opening` (welcome → pitch → POVs → closing) and `director_response`
  (prose + inline actions of kind `navigate | commit | respond | noop`). The POV
  type = the tappable headline card (headline + teaser → `anchor` is the tap).
- **Reference implementation:** `src/scouting/office/ScoutingOffice.tsx` (UI
  works; POVs currently hardcoded samples with first-time vs. returning
  openings keyed off localStorage).
- **Intended API architecture** (stubbed in `src/scouting/api.ts`, all 501):
  per-domain **intel handlers** → `office/opening` composes POVs →
  `office/respond` is the LLM conversation → **memo generators** write
  digest-shaped content to `cfc_director_memos` (the inbox).
- **For Personnel**, the "intel handlers" are largely already built: the trade
  engine's narrative bundles (theses/goals), the Builder slate, `trade_offers`
  (inbound interest), and the partner-angle data — the office is a presentation
  layer over the existing brain.
- **Seeded handoffs:** follow the existing pattern —
  `sessionStorage` seed + `?seed=` param (see `cfc_studio_seed_deal` /
  `cfc_builder_seed_deal` in `src/app/pro-personnel/trade-builder/page.tsx`).
