#!/usr/bin/env python3
# CFC: collapse wr_market/te_market -> pc_market across 18 files. Atomic: verifies all edits first, writes nothing unless every edit matches exactly.
import sys, os
ROOT = os.environ.get("PC_ROOT", ".")
EDITS = [
 ("src/shared/league-data/types.ts", [
   ("  wrMarket: MarketStance;\n  teMarket: MarketStance;\n",
    "  pcMarket: MarketStance;\n", 1),
 ]),
 ("src/shared/league-data/accessors.ts", [
   ("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market, gm_persona",
    "team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona", 1),
   ("      wrMarket: stance(row.wr_market),\n      teMarket: stance(row.te_market),\n",
    "      pcMarket: stance(row.pc_market),\n", 1),
 ]),
 ("src/scouting/intel/types.ts", [
   ("  wrMarket: MarketStance;\n  teMarket: MarketStance;\n",
    "  pcMarket: MarketStance;\n", 1),
 ]),
 ("src/scouting/intel/dataLayer.ts", [
   ('    wrMarket: "unknown",\n    teMarket: "unknown",\n',
    '    pcMarket: "unknown",\n', 1),
   ("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market, gm_persona",
    "team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona", 1),
   ("      wrMarket: stance(row.wr_market),\n      teMarket: stance(row.te_market),\n",
    "      pcMarket: stance(row.pc_market),\n", 1),
 ]),
 ("src/research-strategy/api/types.ts", [
   ("  wr_market: TeamHqMarket;\n  te_market: TeamHqMarket;\n",
    "  pc_market: TeamHqMarket;\n", 1),
   ('  wr_market: "hold",\n  te_market: "hold",\n',
    '  pc_market: "hold",\n', 1),
 ]),
 ("src/research-strategy/api/service.ts", [
   ("  wr_market: normalizeMarket(payload?.wr_market),\n  te_market: normalizeMarket(payload?.te_market),\n",
    "  pc_market: normalizeMarket(payload?.pc_market),\n", 1),
   ("league_id,team_id,wants_more,qb_market,rb_market,wr_market,te_market,picks_market,own_guys_preference,gm_persona",
    "league_id,team_id,wants_more,qb_market,rb_market,pc_market,picks_market,own_guys_preference,gm_persona", 1),
   ("    wr_market: normalizeMarket(data.wr_market),\n    te_market: normalizeMarket(data.te_market),\n",
    "    pc_market: normalizeMarket(data.pc_market),\n", 1),
   ("    wr_market: strategyProfile.wr_market,\n    te_market: strategyProfile.te_market,\n",
    "    pc_market: strategyProfile.pc_market,\n", 2),
 ]),
 ("src/pro-personnel/trade-engine/core/types.ts", [
   ("  wr_market: string;\n  te_market: string;\n",
    "  pc_market: string;\n", 1),
 ]),
 ("src/pro-personnel/trade-engine/core/ranking.ts", [
   ('  "wr_market",\n  "te_market",\n',
    '  "pc_market",\n', 1),
 ]),
 ("src/pro-personnel/trade-engine/advisor/context.ts", [
   ('    ["wr_market", "WR"],\n    ["te_market", "TE"],\n',
    '    ["pc_market", "pass catchers"],\n', 1),
 ]),
 ("src/pro-personnel/trade-engine/advisor/engine.ts", [
   ('  if (profile.wr_market === "buy") out.add("WR");\n  if (profile.te_market === "buy") out.add("TE");\n',
    '  if (profile.pc_market === "buy") { out.add("WR"); out.add("TE"); }\n', 1),
   ('  if (p.wr_market === target) out.push("WR");\n  if (p.te_market === target) out.push("TE");\n',
    '  if (p.pc_market === target) { out.push("WR"); out.push("TE"); }\n', 1),
   ('  if (position === "WR" || position === "TE") return p.wr_market;\n',
    '  if (position === "WR" || position === "TE") return p.pc_market;\n', 1),
 ]),
 ("src/pro-personnel/trade-engine/studio/candidates.ts", [
   ('  if (profile.wr_market === "buy") out.add("WR");\n  if (profile.te_market === "buy") out.add("TE");\n',
    '  if (profile.pc_market === "buy") { out.add("WR"); out.add("TE"); }\n', 1),
 ]),
 ("src/app/api/league/profiles/route.ts", [
   ("? { qb: strat.qbMarket, rb: strat.rbMarket, wr: strat.wrMarket, te: strat.teMarket }",
    "? { qb: strat.qbMarket, rb: strat.rbMarket, pc: strat.pcMarket }", 1),
 ]),
 ("src/app/api/pro-personnel/advisor/route.ts", [
   ("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market, gm_persona",
    "team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona", 1),
 ]),
 ("src/app/api/pro-personnel/trade-studio/generate/route.ts", [
   ("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market, gm_persona",
    "team_id, wants_more, qb_market, rb_market, pc_market, picks_market, gm_persona", 1),
   ('      wr_market: r.wr_market ?? "hold",\n      te_market: r.te_market ?? "hold",\n',
    '      pc_market: r.pc_market ?? "hold",\n', 1),
 ]),
 ("src/app/api/pro-personnel/targets/route.ts", [
   ("wr_market: string; te_market: string;",
    "pc_market: string;", 1),
   ('  if (needLevel(p.wr_market) >= 2) m["WR"] = needLevel(p.wr_market);\n  if (needLevel(p.te_market) >= 2) m["TE"] = needLevel(p.te_market);\n',
    '  const pcN = needLevel(p.pc_market);\n  if (pcN >= 2) { m["WR"] = pcN; m["TE"] = pcN; }\n', 1),
   ('  if (p.wr_market === "sell") s.push("WR"); if (p.te_market === "sell") s.push("TE");\n',
    '  if (p.pc_market === "sell") { s.push("WR"); s.push("TE"); }\n', 1),
   ('  if (p.wr_market === "buy") b.push("WR"); if (p.te_market === "buy") b.push("TE");\n',
    '  if (p.pc_market === "buy") { b.push("WR"); b.push("TE"); }\n', 1),
   ("team_id, wants_more, qb_market, rb_market, wr_market, te_market, picks_market",
    "team_id, wants_more, qb_market, rb_market, pc_market, picks_market", 1),
 ]),
 ("src/app/api/inbox/ai-quip/route.ts", [
   ("  wr_market: string;\n  te_market: string;\n",
    "  pc_market: string;\n", 1),
   ('  if (profile.wr_market === "buy") needs.push("WR");\n  if (profile.te_market === "buy") needs.push("TE");\n',
    '  if (profile.pc_market === "buy") { needs.push("WR"); needs.push("TE"); }\n', 1),
   ('  if (profile.wr_market === "sell") selling.push("WR");\n  if (profile.te_market === "sell") selling.push("TE");\n',
    '  if (profile.pc_market === "sell") { selling.push("WR"); selling.push("TE"); }\n', 1),
   ("team_id, wants_more, qb_market, rb_market, wr_market, te_market",
    "team_id, wants_more, qb_market, rb_market, pc_market", 2),
 ]),
 ("src/onboarding/OnboardingPosture.tsx", [
   ('  key: "QB" | "RB" | "WR" | "TE";',
    '  key: "QB" | "RB" | "PC";', 1),
   ('  { key: "WR", underline: "#F5C230" },\n  { key: "TE", underline: "#1A1A1A" },\n',
    '  { key: "PC", underline: "#B8862E" },\n', 1),
   ('    WR: "med",\n    TE: "med",\n',
    '    PC: "med",\n', 1),
   ("        wr_market: NEED_TO_MARKET[posture.WR],\n        te_market: NEED_TO_MARKET[posture.TE],\n",
    "        pc_market: NEED_TO_MARKET[posture.PC],\n", 1),
 ]),
 ("src/components/owners-box/StrategyTab.tsx", [
   ('const POSITION_BUCKETS = ["QB", "RB", "WR", "TE", "Picks"] as const;',
    'const POSITION_BUCKETS = ["QB", "RB", "PC", "Picks"] as const;', 1),
   ("  wr_market: NeedLevel;\n  te_market: NeedLevel;\n",
    "  pc_market: NeedLevel;\n", 1),
   ("  wr_market: MARKET_TO_NEED[data.wr_market as string] ?? \"medium\",\n  te_market: MARKET_TO_NEED[data.te_market as string] ?? \"medium\",\n",
    "  pc_market: MARKET_TO_NEED[data.pc_market as string] ?? \"medium\",\n", 1),
   ('    if (bucket === "WR") return profile.wr_market;\n    if (bucket === "TE") return profile.te_market;\n',
    '    if (bucket === "PC") return profile.pc_market;\n', 1),
   ('      if (bucket === "WR") return { ...prev, wr_market: level };\n      if (bucket === "TE") return { ...prev, te_market: level };\n',
    '      if (bucket === "PC") return { ...prev, pc_market: level };\n', 1),
   ("            wr_market: NEED_TO_MARKET[profile.wr_market],\n            te_market: NEED_TO_MARKET[profile.te_market],\n",
    "            pc_market: NEED_TO_MARKET[profile.pc_market],\n", 1),
   ('gridTemplateColumns: "repeat(5,1fr)"',
    'gridTemplateColumns: "repeat(4,1fr)"', 1),
 ]),
]


def main():
    # PASS 1 — verify everything, no writes
    problems=[]; loaded={}
    for rel, edits in EDITS:
        path=os.path.join(ROOT, rel)
        if not os.path.exists(path): problems.append(f"MISSING FILE: {rel}"); continue
        t=open(path,encoding="utf-8").read(); loaded[rel]=t
        for old,new,exp in edits:
            c=t.count(old)
            if c!=exp: problems.append(f"{rel}: expected {exp}x, found {c}x of {old[:50]!r}")
    if problems:
        print("ABORTED — nothing written. Mismatches (your file differs from expected):")
        for p in problems: print("  -",p)
        sys.exit(1)
    # PASS 2 — apply
    for rel, edits in EDITS:
        t=loaded[rel]
        for old,new,exp in edits: t=t.replace(old,new)
        open(os.path.join(ROOT,rel),"w",encoding="utf-8").write(t)
    # verify clean
    left=[]
    for rel,_ in EDITS:
        t=open(os.path.join(ROOT,rel),encoding="utf-8").read()
        for tok in ("wr_market","te_market","wrMarket","teMarket"):
            if tok in t: left.append(f"{rel}: still has {tok}")
    if left:
        print("WARNING leftover:"); [print("  -",x) for x in left]; sys.exit(2)
    print(f"OK — {len(EDITS)} files updated, zero wr_market/te_market/wrMarket/teMarket remain.")
main()
