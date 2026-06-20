// Regenerates TRADE_STUDIO_VERIFICATION.md enriched with values.
// - Re-runs each block through the live engine (deterministic) to get the exact
//   offers + per-asset values (send = team-specific perspective, receive = CFC).
// - Pulls CFC neutral values for send-side players from cfc_trade_values_current.
// Run with the dev server up on :3000.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";

// ── env ───────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

// ── CFC neutral values (by sleeper id) ──────────────────────────────────────
const cfcById = {};
{
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("cfc_trade_values_current")
      .select("sleeper_player_id, cfc_value")
      .range(from, from + page - 1);
    if (error) throw error;
    for (const r of data) if (r.sleeper_player_id != null) cfcById[String(r.sleeper_player_id)] = r.cfc_value;
    if (data.length < page) break;
    from += page;
  }
}

// ── team context (name -> key, plus team-specific value) ────────────────────
const teams = {};
for (let t = 1; t <= 12; t++) {
  const ctx = JSON.parse(readFileSync(`.debug/studio-team-${t}.json`, "utf8"));
  const byName = {};
  for (const a of ctx.roster) byName[norm(a.name)] = a;
  teams[String(t)] = { ctx, byName };
}

const TEAM_META = {
  1: ["Fairmount Freaks", "build_future"],
  2: ["Virginia Founders", "build_future + win_now"],
  3: ["Mayfield Matzos Balls", "win_now + build_future"],
  4: ["Kentucky Kush", "win_now"],
  5: ["Buffalo Wingmen", "win_now"],
  6: ["Doylestown Destroyers", "win_now + build_future"],
  7: ["Windy City Crossfitters", "win_now"],
  8: ["Brunswick Buschmasters", "win_now"],
  9: ["Brokepark Browns", "win_now + build_future"],
  10: ["Boston Birdmen", "build_future"],
  11: ["Ridgeville Rawdoggers", "win_now + build_future"],
  12: ["Oregon Onslaught", "build_future + win_now"],
};

// Block definitions: the send lists each team's subagent shopped (final round).
const BLOCKS = {
  1: { A: ["Daniel Jones"], B: ["Kyle Monangai", "Jacory Croskey-Merritt"], C: ["Parker Washington", "Jalen Coker"] },
  2: {
    A: ["Jordan Mason", "Kendre Miller"], B: ["Jauan Jennings", "Rashid Shaheed"],
    C: ["Jordan James", "Rashid Shaheed"], D: ["Jordan Mason", "Jaylin Lane"],
    E: ["Marcus Mariota", "Will Levis"], F: ["Rashid Shaheed", "Jordan Mason", "Jauan Jennings"],
  },
  3: { A: ["De'Von Achane", "Tee Higgins"], B: ["Josh Jacobs", "Mike Evans"], C: ["Travis Etienne"] },
  4: { A: ["Anthony Richardson", "Jameson Williams"] },
  5: { A: ["Emeka Egbuka", "Michael Penix"] },
  6: {
    A: ["Kyler Murray", "Bryce Young"], B: ["Derrick Henry", "Rhamondre Stevenson"],
    C: ["Terry McLaurin", "DK Metcalf"], D: ["Davante Adams", "Derrick Henry"],
    E: ["Lamar Jackson", "Tyler Warren"], F: ["Stefon Diggs", "Rachaad White"],
  },
  7: { A: ["Zach Charbonnet", "Braelon Allen"], B: ["Christian Watson", "Alec Pierce"], C: ["Ricky Pearsall", "Isaac Guerendo"] },
  8: { A: ["Chris Olave", "Rashee Rice"], B: ["Brock Purdy"], C: ["Nico Collins", "Marvin Harrison"] },
  9: { A: ["Zay Flowers", "DeVonta Smith"], B: ["Courtland Sutton", "Tre Tucker"], C: ["James Cook"], D: ["Geno Smith", "Najee Harris"] },
  10: { A: ["Aaron Jones", "Chris Godwin"], B: ["Trevor Lawrence", "Tucker Kraft"], C: ["Tyler Shough", "Mark Andrews"] },
  11: {
    A: ["Ladd McConkey", "Wan'Dale Robinson"], B: ["Ladd McConkey", "Wan'Dale Robinson", "Michael Wilson"],
    C: ["Aaron Rodgers", "Davis Mills"], D: ["C.J. Stroud"], E: ["Trey McBride"], F: ["Javonte Williams"],
  },
  12: { A: ["Dak Prescott"], B: ["Josh Downs", "Jayden Reed"] },
};

const PERSONA = { straight_shooter: "SS", architect: "Arch", hustler: "Hustler", closer: "Closer" };
const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;
const emoji = (ratio) => (ratio >= 0.9 ? "🟢" : ratio >= 0.8 ? "🟡" : "🔴");

const warnings = [];
let out = "";

for (let t = 1; t <= 12; t++) {
  const tid = String(t);
  const [teamName, storylines] = TEAM_META[t];
  out += `\n## Team ${t} · ${teamName} — *${storylines}*\n`;
  const blocks = BLOCKS[t];
  for (const [label, sendNames] of Object.entries(blocks)) {
    // resolve send names -> keys
    const sendEntries = sendNames.map((n) => {
      const e = teams[tid].byName[norm(n)];
      if (!e) warnings.push(`Team ${t} block ${label}: unresolved send name "${n}"`);
      return { name: n, entry: e };
    });
    const keys = sendEntries.map((s) => s.entry?.key).filter(Boolean);

    const res = await fetch(`${BASE}/api/pro-personnel/trade-studio/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: tid, shop_list_keys: keys }),
    });
    const json = await res.json();
    const offers = json.offers || [];

    // send-side values: team-specific from the engine run, CFC from the table
    const sendRows = (offers[0]?.send || sendEntries.map((s) => ({ name: s.name, key: s.entry?.key, value: s.entry?.value })));
    let sendTeamTotal = 0, sendCfcTotal = 0;
    const sendLines = sendRows.map((a) => {
      const id = String(a.key || "").replace(/^player:/, "");
      const teamVal = r0(a.value ?? 0);
      const cfc = cfcById[id] != null ? r0(cfcById[id]) : null;
      sendTeamTotal += a.value ?? 0;
      sendCfcTotal += cfcById[id] ?? 0;
      return `| ${a.name} | ${teamVal} | ${cfc ?? "—"} |`;
    });

    out += `\n**Block ${label} — we send:**\n\n`;
    out += `| Player (we give up) | Team value | CFC value |\n|---|:--:|:--:|\n`;
    out += sendLines.join("\n") + "\n";
    out += `| **Total** | **${r0(sendTeamTotal)}** | **${r0(sendCfcTotal)}** |\n\n`;

    out += `| ID | Partner (persona) | We Get — CFC value each | Recv CFC total | Ratio | 🗒 Your feedback |\n`;
    out += `|----|---|---|:--:|:--:|---|\n`;
    offers.forEach((o, i) => {
      const recv = o.receive || [];
      const recvTotal = recv.reduce((s, a) => s + (a.value ?? 0), 0);
      const recvStr = recv.map((a) => `${a.name} (${r0(a.value ?? 0)})`).join(" + ");
      const ratio = o.valueGap?.ratio ?? 0;
      const persona = PERSONA[o.persona] || o.persona;
      out += `| ${tid === "10" ? "T10" : "T" + tid}-${label}${i + 1} | ${o.partnerTeamName} (${persona}) | ${recvStr} | ${r0(recvTotal)} | ${emoji(ratio)} ${r2(ratio)} | |\n`;
    });
    out += `\n`;
  }
  out += `**Overall notes (Team ${t}):**\n`;
}

// ── assemble full file ──────────────────────────────────────────────────────
const header = `# Trade Studio Verification Report
_12-team Superflex dynasty • every offer generated through the canonical engine via the Trade Studio door._

## How to give feedback (read me)

- Each offer has a **stable ID** (e.g. \`T1-A1\`) and a blank **🗒 Your feedback** cell — type your reaction right in that cell.
- Each team also has an **Overall notes** line.
- **Values:** for every block, the send table shows each player's **Team value** (this team's own perspective, from \`cfc_team_trade_values_current\`) and **CFC value** (neutral league base, from \`cfc_trade_values_current\`), with totals. Each offer lists the **CFC value of every asset we receive** and the **receive CFC total**.
- **Ratio** = receive CFC total ÷ send **team** total (our side's grade). 🟢 ≥0.9 "We should take this deal" · 🟡 0.8–0.9 "I'd push for more here" (partner offering near the low end of their band). The door already removed anything below 0.8.
- Pick CFC values reflect the engine's slotting (future picks valued by the original team's window + a year discount).

> The canonical engine uses **two timelines only — \`win_now\` / \`build_future\`** (there is no "retool"). Storyline labels below come from each team's engine theses. The Studio is a thin door; the only code changed was the door (key normalization + a sub-0.8 "don't entertain" output filter). The engine, values, needs, personas, and storyline layer were **not** modified.

`;

const footer = `
---

## Structural findings (observations, not blockers)

1. **Very-high-value lone shops return 0 offers** (Burrow ~483, Lamar ~491) — no single partner can field a balanced one-asset return; they surface fine inside a package (that's why T3 block B uses Jacobs+Evans and T6 block E uses Lamar+Warren).
2. **QB-insurance goal sources no QB returns** — the generator returns RB/WR/picks for that intent, never a backup QB.
3. **Xavier Worthy value asymmetry (Team 12)** — team-adjusted value far above the CFC value partners price him at; a per-asset data discrepancy, not engine logic. Worthy was avoided in T12 block B.

## Files changed (door only — engine untouched)

- \`src/app/api/pro-personnel/trade-studio/generate/route.ts\` — \`toEngineKey()\` player-key normalization + \`way_off\` (<0.8) slate filter.
- \`scripts/build-studio-team-context.mjs\`, \`scripts/build-studio-report.mjs\` — review/report helpers, not app runtime.

_No changes to the canonical engine (\`src/pro-personnel/engine/**\`), the storyline/narrative layer, or any shared pipeline module._
`;

writeFileSync("TRADE_STUDIO_VERIFICATION.md", header + out + footer);
console.log("Wrote TRADE_STUDIO_VERIFICATION.md");
if (warnings.length) { console.log("\nWARNINGS:"); for (const w of warnings) console.log(" - " + w); }
else console.log("No unresolved names.");
