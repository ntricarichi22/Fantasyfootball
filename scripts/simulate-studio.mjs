// SIMULATION ONLY — touches no src/ code. v5.
// Themes incorporated:
//  1. Future pick value = projected-finish slot (rank all 12 by strength -> worst
//     drafts 1.01) * year discount. Replaces the 4-tier slot table.
//  2-4. Model the partner like a GM: they only acquire our piece if it's a real
//     starter-upgrade / need / startable-stack FOR THEIR WINDOW; rebuild partners
//     won't take aging vets; contenders won't give real value for sub-lineup depth;
//     stud-for-scrubs guard. Received PLAYERS must clear EXP-aware includability
//     (depth-chart). Pick-padding is allowed; scrub-PLAYER padding is not.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";
const BAND = [0.80, 1.05];
const MAX_PLAYERS_PER_SIDE = 3, MAX_PIECES = 4;
const MAX_PER_POS = 2;           // never ship 3+ players of one position
const MAX_PICKS_PER_ROUND = { 1: 9, 2: 2, 3: 2 }; // 1sts unlimited; ≤2 of rounds 2/3
const RB_LEAD_CFC = 120;         // insurance only handcuffs a genuine lead RB
const OFFERS_PER_PARTNER = 2;
const SLOTS = { QB: 2, RB: 2, PASS_CATCHER: 3 };
const NFL_SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1 };
const STARTABLE_FLOOR = 45, CORNERSTONE_CFC = 80, OLD_AGE = 28;
const UPGRADE_MARGIN = 1.10;     // partner needs our piece to beat their weakest starter by 10%+
const STUD_FOR_SCRUBS = 1.5;     // a single given piece can't exceed 1.5x our headline

const env = {}; for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const norm = (s) => (s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z0-9]/g, "");
const bucketOf = (p) => (p === "QB" ? "QB" : p === "RB" ? "RB" : p === "WR" || p === "TE" ? "PASS_CATCHER" : "PICK");
const pad = (n) => String(n).padStart(2, "0");
const r0 = (n) => Math.round(n), r2 = (n) => Math.round(n * 100) / 100;
const now = new Date(); const CFC_YEAR = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
const yearDiscount = (out) => (out <= 0 ? 1 : out === 1 ? 0.95 : 0.9);

// CFC values + pick ladder (slot "R.SS" -> value)
const cfcById = {}, ladder = {};
{ let from = 0; const page = 1000;
  for (;;) { const { data, error } = await supabase.from("cfc_trade_values_current").select("sleeper_player_id, display_name, cfc_value").range(from, from + page - 1);
    if (error) throw error;
    for (const r of data) { if (r.sleeper_player_id != null) cfcById[String(r.sleeper_player_id)] = r.cfc_value; if (r.display_name && /^\d+\.\d+$/.test(r.display_name)) ladder[r.display_name] = r.cfc_value; }
    if (data.length < page) break; from += page; } }
const ladderAt = (round, slot) => ladder[`${round}.${pad(slot)}`] ?? ladder[`${round}.06`] ?? 0;

// Sleeper universe + NFL depth charts
const sleeper = await (await fetch("https://api.sleeper.app/v1/players/nfl")).json();
const info = {}, room = new Map();
for (const id in sleeper) { const p = sleeper[id]; if (!["QB", "RB", "WR", "TE"].includes(p.position) || !p.team) continue;
  const rec = { id, name: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim(), pos: p.position, team: p.team, age: p.age ?? null, exp: p.years_exp ?? null, cfc: cfcById[id] ?? 0 };
  info[id] = rec; const k = `${p.team}|${p.position}`; if (!room.has(k)) room.set(k, []); room.get(k).push(rec); }
for (const a of room.values()) a.sort((x, y) => y.cfc - x.cfc);
const depthRank = (id, team, pos) => { const a = room.get(`${team}|${pos}`) || []; const i = a.findIndex((x) => x.id === id); return i < 0 ? null : i + 1; };
const hasPath = (id, team, pos) => { const a = room.get(`${team}|${pos}`) || []; const me = a.find((x) => x.id === id); const my = me?.cfc ?? 0;
  const ahead = a.filter((x) => x.id !== id && x.cfc > my); const top = ahead[0];
  const aging = !top || (top.age != null && top.age >= OLD_AGE); const rookieComp = a.some((x) => x.id !== id && x.exp === 0); return aging && !rookieComp; };

const tg = await (await fetch(`${BASE}/api/pro-personnel/targets?teamId=1`)).json();
const profiles = tg.profiles || {}, names = {}, rosters = {};
for (const [tid, assets] of Object.entries(tg.rosters || {})) {
  names[tid] = assets[0]?.teamName || `Team ${tid}`;
  rosters[tid] = assets.map((a) => { const id = String(a.key).replace(/^player:/, ""); const inf = info[id];
    return { key: a.key, name: a.name, pos: a.position, bucket: bucketOf(a.position), teamVal: a.value, cfcRaw: a.type === "pick" ? null : (cfcById[id] ?? a.value),
      id, nfl: inf?.team ?? null, age: inf?.age ?? null, exp: inf?.exp ?? null, tier: a.tier, type: a.type, isStud: a.isStud, isYouth: a.isYouth }; });
}
const market = (tid, b) => { const p = profiles[tid]; if (!p) return "hold"; return b === "QB" ? p.qb_market : b === "RB" ? p.rb_market : b === "PASS_CATCHER" ? p.pc_market : p.picks_market; };
const wantsMore = (tid) => new Set(profiles[tid]?.wants_more || []);

// ── Theme 1: projected draft order -> pick values ───────────────────────────
const strength = {};
for (const tid of Object.keys(rosters)) { let s = 0;
  for (const b of ["QB", "RB", "PASS_CATCHER"]) { const pl = rosters[tid].filter((a) => a.type === "player" && a.bucket === b).map((a) => a.cfcRaw || 0).sort((x, y) => y - x).slice(0, SLOTS[b]); s += pl.reduce((q, v) => q + v, 0); }
  strength[tid] = s; }
const order = Object.keys(rosters).sort((a, b) => strength[a] - strength[b]); // weakest first
const draftSlot = {}; order.forEach((tid, i) => (draftSlot[tid] = i + 1));    // weakest = slot 1 (1.01)
const windowOf = (tid) => { const s = draftSlot[tid]; return s <= 4 ? "rebuild" : s >= 9 ? "contender" : "retool"; };

function pickValue(key) {
  const segs = key.slice(5).split("-"); const season = +segs[0], round = +segs[1];
  let slot, future; if (segs.length === 4 && /^\d+$/.test(segs[2])) { slot = +segs[2]; future = false; var orig = segs[3]; }
  else { future = true; orig = segs[segs.length - 1]; slot = draftSlot[orig] ?? 6; }
  const base = ladderAt(round, slot); return future ? Math.round(base * yearDiscount(season - CFC_YEAR)) : base;
}
// attach cfc to every asset (players from table, picks from new slotting)
for (const tid of Object.keys(rosters)) for (const a of rosters[tid]) a.cfc = a.type === "pick" ? pickValue(a.key) : a.cfcRaw;

const startersOf = (tid) => { const set = new Set(), weak = {}, open = {};
  for (const b of ["QB", "RB", "PASS_CATCHER"]) { const pl = rosters[tid].filter((a) => a.type === "player" && a.bucket === b).sort((x, y) => y.cfc - x.cfc); const n = SLOTS[b], top = pl.slice(0, n); for (const a of top) set.add(a.key); weak[b] = pl.length >= n ? top[top.length - 1].cfc : -Infinity; open[b] = pl.length < n; } return { set, weak, open }; };
const sC = {}; const starters = (tid) => (sC[tid] ??= startersOf(tid));
const nflSets = (tid, drop) => { const qb = new Set(), wr = new Set(), rbLead = new Set(), rbCount = {}; for (const a of rosters[tid]) { if (a.type !== "player" || drop?.has(a.key) || !a.nfl) continue; if (a.pos === "QB") qb.add(a.nfl); else if (a.pos === "WR") wr.add(a.nfl); else if (a.pos === "RB") { rbCount[a.nfl] = (rbCount[a.nfl] || 0) + 1; if (a.cfc >= RB_LEAD_CFC) rbLead.add(a.nfl); } } return { qb, wr, rbLead, rbCount }; };
// QB-stack: our WR/TE joins our kept QB's NFL team. RB-insurance: a handcuff to a
// genuine LEAD RB we keep (and we're not already 2-deep there). WR-concentration: bad.
const stackEval = (a, sets) => { let good = null, bad = null;
  if (a.bucket === "PASS_CATCHER" && a.nfl && sets.qb.has(a.nfl)) good = "QB-stack";
  if (a.pos === "RB" && a.nfl && sets.rbLead.has(a.nfl) && (sets.rbCount[a.nfl] || 0) < 2) good = good || "RB-insurance";
  if (a.pos === "WR" && a.nfl && sets.wr.has(a.nfl)) bad = "WR-concentration"; return { good, bad }; };
const isPickRound1 = (a) => a.type === "pick" && /(\bRd 1\b|\b1\.\d)/.test(a.name);
const pickRound = (a) => { if (a.type !== "pick") return null; const m = a.name.match(/Rd (\d)/) || a.name.match(/\b(\d)\.\d\d\b/); return m ? +m[1] : null; };
// Youth/aging keyed off Sleeper age/exp (authoritative) — the targets isYouth flag is unreliable.
const isYoungAsset = (a) => a.type === "player" && (a.exp != null ? a.exp <= 2 : (a.age != null && a.age <= 24));
const AGING_VET = (a) => a.type === "player" && a.age != null && a.age >= OLD_AGE;
const isImpact = (a) => a.cfc >= CORNERSTONE_CFC || ((depthRank(a.id, a.nfl, a.pos) ?? 99) <= (NFL_SLOTS[a.pos] ?? 99) && a.cfc >= STARTABLE_FLOOR);
function includable(a) { // a real RECEIVED player (stack/insurance do NOT rescue a dead guy)
  if (a.type === "pick") return { ok: true, why: isPickRound1(a) ? "1st-rd pick" : "pick" };
  if (isImpact(a)) return { ok: true, why: "starter/impact" };
  if (a.exp === 0) return { ok: true, why: "rookie upside" };
  if (a.exp != null && a.exp <= 2) return hasPath(a.id, a.nfl, a.pos) ? { ok: true, why: "upside path" } : { ok: false };
  return { ok: false };
}

// Theme 2-4: would partner P acquire our shopped headline, given THEIR window?
function partnerWantsShop(P, h) {
  if (h.bucket === "PICK") return market(P, "PICK") === "buy" || wantsMore(P).has("draft_picks");
  const win = windowOf(P), st = starters(P);
  if (stackEval(h, nflSets(P, null)).bad) return false; // they wouldn't add WR concentration
  if (win === "rebuild") { // craves young/ascending/picks; not aging vets
    if (AGING_VET(h)) return false;
    return isYoungAsset(h) || isImpact(h);
  }
  const open = st.open[h.bucket], upgrade = h.cfc > st.weak[h.bucket] * UPGRADE_MARGIN, need = market(P, h.bucket) === "buy";
  // only a QB-stack drives a "want" (RB-insurance is too weak a reason to acquire);
  const ev = stackEval(h, nflSets(P, null)); const qbStack = ev.good === "QB-stack" && (isImpact(h) || h.cfc >= STARTABLE_FLOOR);
  return open || upgrade || need || qbStack;
}
const contenderLean = (tid) => windowOf(tid) === "contender";
const combos = (arr, k) => { const res = []; const rec = (s, acc) => { if (acc.length === k) { res.push(acc.slice()); return; } for (let i = s; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); } }; rec(0, []); return res; };

const BLOCKS = {
  1: { A: ["Daniel Jones"], B: ["Kyle Monangai", "Jacory Croskey-Merritt"], C: ["Parker Washington", "Jalen Coker"] },
  2: { A: ["Jordan Mason", "Kendre Miller"], B: ["Jauan Jennings", "Rashid Shaheed"], C: ["Jordan James", "Rashid Shaheed"], D: ["Jordan Mason", "Jaylin Lane"], E: ["Marcus Mariota", "Will Levis"], F: ["Rashid Shaheed", "Jordan Mason", "Jauan Jennings"] },
  3: { A: ["De'Von Achane", "Tee Higgins"], B: ["Josh Jacobs", "Mike Evans"], C: ["Travis Etienne"] },
  4: { A: ["Anthony Richardson", "Jameson Williams"] },
  5: { A: ["Emeka Egbuka", "Michael Penix"] },
  6: { A: ["Kyler Murray", "Bryce Young"], B: ["Derrick Henry", "Rhamondre Stevenson"], C: ["Terry McLaurin", "DK Metcalf"], D: ["Davante Adams", "Derrick Henry"], E: ["Lamar Jackson", "Tyler Warren"], F: ["Stefon Diggs", "Rachaad White"] },
  7: { A: ["Zach Charbonnet", "Braelon Allen"], B: ["Christian Watson", "Alec Pierce"], C: ["Ricky Pearsall", "Isaac Guerendo"] },
  8: { A: ["Chris Olave", "Rashee Rice"], B: ["Brock Purdy"], C: ["Nico Collins", "Marvin Harrison"] },
  9: { A: ["Zay Flowers", "DeVonta Smith"], B: ["Courtland Sutton", "Tre Tucker"], C: ["James Cook"], D: ["Geno Smith", "Najee Harris"] },
  10: { A: ["Aaron Jones", "Chris Godwin"], B: ["Trevor Lawrence", "Tucker Kraft"], C: ["Tyler Shough", "Mark Andrews"] },
  11: { A: ["Ladd McConkey", "Wan'Dale Robinson"], B: ["Ladd McConkey", "Wan'Dale Robinson", "Michael Wilson"], C: ["Aaron Rodgers", "Davis Mills"], D: ["C.J. Stroud"], E: ["Trey McBride"], F: ["Javonte Williams"] },
  12: { A: ["Dak Prescott"], B: ["Josh Downs", "Jayden Reed"] },
};
const TEAM_STORY = { 1: "build_future", 2: "build_future + win_now", 3: "win_now + build_future", 4: "win_now", 5: "win_now", 6: "win_now + build_future", 7: "win_now", 8: "win_now", 9: "win_now + build_future", 10: "build_future", 11: "win_now + build_future", 12: "build_future + win_now" };
const byName = (tid) => { const m = {}; for (const a of rosters[tid]) m[norm(a.name)] = a; return m; };

let out = "", warn = [];
for (let t = 1; t <= 12; t++) {
  const tid = String(t), nm = byName(tid), win = windowOf(tid);
  out += `\n## Team ${t} · ${names[tid]} — *${TEAM_STORY[t]}* (window: ${win}, draft slot ${draftSlot[tid]})\n`;
  for (const [label, sendNames] of Object.entries(BLOCKS[t])) {
    const send = sendNames.map((n) => { const a = nm[norm(n)]; if (!a) warn.push(`T${t} ${label}: ${n}`); return a; }).filter(Boolean);
    const sendTeam = send.reduce((s, a) => s + a.teamVal, 0), sendCfc = send.reduce((s, a) => s + a.cfc, 0);
    const sendKeys = new Set(send.map((a) => a.key)); const shopPlayers = send.filter((a) => a.type === "player");
    const headline = (shopPlayers.length ? shopPlayers : send).slice().sort((x, y) => y.cfc - x.cfc)[0];
    const ourSets = nflSets(tid, sendKeys), ourStart = starters(tid);
    out += `\n**Block ${label} — we send:** ${send.map((a) => `${a.name} (team ${r0(a.teamVal)} / cfc ${r0(a.cfc)})`).join(", ")} — **send team ${r0(sendTeam)}, cfc ${r0(sendCfc)}**\n\n`;
    const offers = [];
    for (let p = 1; p <= 12; p++) { if (p === t) continue; const pid = String(p);
      if (!partnerWantsShop(pid, headline)) continue;
      const pStart = starters(pid).set; const pNeedy = (b) => market(pid, b) === "buy" || starters(pid).open[b] || starters(pid).weak[b] < ({ QB: 150, RB: 70, PASS_CATCHER: 85 }[b] ?? 0);
      const pickGiveOk = market(pid, "PICK") !== "buy"; const partnerIsContender = contenderLean(pid); const aheadTol = partnerIsContender ? 0.10 : 0.0;
      let pool = rosters[pid].filter((a) => { if (a.type === "pick") return pickGiveOk; if (pStart.has(a.key)) return false; if (pNeedy(a.bucket)) return false; if (market(pid, a.bucket) === "buy") return false; return true; })
        .filter((a) => { if (a.type === "pick") return market(tid, "PICK") !== "sell";
          if (!includable(a).ok) return false;
          if (market(tid, a.bucket) === "sell" && !(a.cfc > ourStart.weak[a.bucket])) return false;
          if (win === "rebuild" && AGING_VET(a)) return false;             // rebuild shopper won't take vets
          if (stackEval(a, ourSets).bad) return false;
          if (a.cfc > STUD_FOR_SCRUBS * headline.cfc) return false;        // no stud-for-scrubs
          return true; });
      if (!pool.length) continue; pool.sort((a, b) => b.cfc - a.cfc); const topPool = pool.slice(0, 16);
      const cands = [];
      for (let k = 1; k <= MAX_PIECES; k++) for (const combo of combos(topPool, k)) {
        // shape caps: ≤3 players, ≤2 of any one position, ≤2 picks per round 2/3 (1sts unlimited)
        const posCount = {}, roundCount = {}; let players = 0;
        for (const a of combo) { if (a.type === "player") { players++; posCount[a.pos] = (posCount[a.pos] || 0) + 1; } else { const rd = pickRound(a); if (rd) roundCount[rd] = (roundCount[rd] || 0) + 1; } }
        if (players > MAX_PLAYERS_PER_SIDE) continue;
        if (Object.values(posCount).some((c) => c > MAX_PER_POS)) continue;
        if (Object.entries(roundCount).some(([rd, c]) => c > (MAX_PICKS_PER_ROUND[rd] ?? 2))) continue;
        const recv = combo.reduce((s, a) => s + a.cfc, 0), ratio = recv / sendTeam; if (ratio < BAND[0] || ratio > BAND[1]) continue;
        const theirGive = combo.reduce((s, a) => s + a.teamVal, 0); if (theirGive > sendCfc * (1 + aheadTol)) continue;
        const reasons = combo.map((a) => includable(a).why).filter(Boolean); const stacks = combo.map((a) => stackEval(a, ourSets).good).filter(Boolean);
        const margin = sendCfc - theirGive; const wm = wantsMore(tid); let fit = 0;
        for (const a of combo) { if (a.type === "pick" && (wm.has("draft_picks") || win === "rebuild")) fit += 12; if (isYoungAsset(a) && win === "rebuild") fit += 10; if (market(tid, a.bucket) === "buy") fit += 10; }
        const hasPick = combo.some((a) => a.type === "pick"); const pickPref = hasPick ? (partnerIsContender ? 8 : -4) : 0;
        const score = stacks.length * 30 + fit + pickPref + margin * 0.2 - combo.length * 8; // prefer cleaner/fewer pieces
        const leadAsset = combo.slice().sort((x, y) => y.cfc - x.cfc)[0];
        cands.push({ combo, recv, ratio, theirGive, margin, stacks, reasons, score, lead: leadAsset?.key, leadType: leadAsset?.type });
      }
      cands.sort((a, b) => b.score - a.score);
      // keep up to 2 per partner: the best, plus a meaningfully DIFFERENT alternative
      // (prefer the other shape — a pick-led vs player-led version).
      const kept = [];
      if (cands.length) { kept.push(cands[0]);
        if (OFFERS_PER_PARTNER > 1) { const ft = cands[0].leadType;
          const alt = cands.find((c) => c !== cands[0] && c.leadType !== ft) || cands.find((c) => c !== cands[0] && c.lead !== cands[0].lead);
          if (alt) kept.push(alt); } }
      for (const c of kept) offers.push({ pid, partner: names[pid], ...c });
    }
    offers.sort((a, b) => (b.stacks.length - a.stacks.length) || (b.margin - a.margin));
    const show = offers.slice(0, 14);
    out += `| ID | Partner | We Get — cfc each | Recv cfc | Ratio | Partner margin | Flags | 🗒 Your feedback |\n|----|---|---|:--:|:--:|:--:|---|---|\n`;
    if (!show.length) out += `| — | _no partner-fit offers in band_ | — | — | — | — | filtered | |\n`;
    else show.forEach((o, i) => { const gets = o.combo.map((a) => `${a.name} (${r0(a.cfc)})`).join(" + ");
      const flags = [...new Set([...o.stacks, ...o.reasons])].slice(0, 3).join(", "); const mg = `${o.margin >= 0 ? "+" : ""}${r0(o.margin)}`;
      out += `| T${tid}-${label}${i + 1} | ${o.partner} | ${gets} | ${r0(o.recv)} | ${r2(o.ratio)} | ${mg} | ${flags} | |\n`; });
    out += `\n`;
  }
  out += `**Overall notes (Team ${t}):**\n`;
}

// projected draft order table
let draftTbl = `| Draft slot | Team | Window | Their 2027 1st | Their 2027 2nd |\n|:--:|---|:--:|:--:|:--:|\n`;
for (const tid of order) draftTbl += `| ${draftSlot[tid]}.01 | ${names[tid]} | ${windowOf(tid)} | ${r0(ladderAt(1, draftSlot[tid]) * yearDiscount(2027 - CFC_YEAR))} | ${r0(ladderAt(2, draftSlot[tid]) * yearDiscount(2027 - CFC_YEAR))} |\n`;

const header = `# Trade Studio — SIMULATION v6
_No code changed. Prototype over live data, for review before porting._

## How to give feedback
Type in the **🗒 Your feedback** cell on any row, or the **Overall notes** line per team. Reference by ID.

## What changed (v6, per your notes)
- **Ratio band floor → 0.80** (was 0.75).
- **Up to 2 offers per partner** (e.g. a clean pick version + a player version).
- **Shape caps:** ≤2 players of any one position (no 3-RB packages); ≤2 picks each in rounds 2 & 3; **1st-rounders uncapped**.
- **RB-insurance demoted** — it no longer makes a partner *want* a player, and only flags a *genuine* handcuff (you keep a real lead RB, cfc ≥ ${RB_LEAD_CFC}, and aren't already 2-deep there). So a Kush with 3 RBs gets no "insurance" offers.
- **Cleaner trades preferred** (stronger fewer-pieces bias).
- _Carried over:_ Theme 1 projected-finish pick values (draft order below), GM-style partner-fit, rebuilds won't take vets, stud-for-scrubs guard, EXP-aware includability. Pick-padding allowed; scrub-*player* padding not.

> ⚠️ **Known data bug (not fixed in sim):** current-year (2026) pick *ownership/slot* from the \`/targets\` route is wrong in places (e.g. the Kush shown a 2026 2.04 they don't own; Rawdoggers a 2.09). The sim inherits that source. The real port will read picks from the canonical \`getLeagueData().pickOwnership\` instead — flagging so you can ignore wrong 2026 pick labels for now.

### Projected 2027 draft order & pick values (Theme 1 check)
${draftTbl}
**Columns below:** Ratio = recv ÷ send team (partner-ahead < ~1.0). Partner margin = our shop CFC − their give (their values); + = partner ahead. Flags = stack/insurance + why each piece is real.

`;
writeFileSync("TRADE_STUDIO_SIM.md", header + out + "\n");
console.log(`Wrote TRADE_STUDIO_SIM.md (CFC_YEAR=${CFC_YEAR})`);
console.log("\nProjected draft order (worst→best):");
for (const tid of order) console.log(`  ${draftSlot[tid]}. ${names[tid]} (${windowOf(tid)}) strength=${r0(strength[tid])} | 2027 1st=${r0(ladderAt(1, draftSlot[tid]) * 0.95)} 2nd=${r0(ladderAt(2, draftSlot[tid]) * 0.95)}`);
if (warn.length) { console.log("WARN:", warn); }
