#!/usr/bin/env python3
# Set Availability — mobile pass: kill ring holes, bottom tab bar, single-column cards. Atomic: verifies all edits first, writes nothing unless every one matches.
import sys, os
ROOT = os.environ.get("SA_ROOT", ".")
REL  = "src/components/research-strategy/SetAvailabilityPage.tsx"

SA_CSS = '''const SA_CSS = `
.sa-binder{margin:0 46px 0 40px;box-shadow:4px 4px 0 #1A1A1A;}
.sa-content{padding:16px;}
.sa-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.sa-tabs{position:absolute;right:-34px;top:40px;display:flex;flex-direction:column;gap:8px;}
.sa-tab{writing-mode:vertical-rl;text-orientation:mixed;height:140px;border:3px solid #1A1A1A;border-left:none;box-shadow:3px 3px 0 #1A1A1A;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:800;letter-spacing:0.1em;padding:14px 9px;cursor:pointer;}
.sa-tab-short{display:none;}
@media (max-width:700px){
  .sa-binder{margin:0;box-shadow:none;}
  .sa-hole{display:none;}
  .sa-content{padding:14px 14px 92px;}
  .sa-grid{grid-template-columns:1fr;}
  .sa-tabs{position:fixed;left:0;right:0;bottom:0;top:auto;flex-direction:row;gap:0;z-index:50;background:#FEFCF9;border-top:3px solid #1A1A1A;}
  .sa-tab{writing-mode:horizontal-tb;height:auto;flex:1;border:none;border-right:2px solid #1A1A1A;box-shadow:none;padding:14px 4px;text-align:center;letter-spacing:0.06em;font-size:12px;}
  .sa-tab:last-child{border-right:none;}
  .sa-tab-full{display:none;}
  .sa-tab-short{display:inline;}
}`;

export default function SetAvailabilityPage() {'''

EDITS = [
 # 1) CSS const before component
 ("export default function SetAvailabilityPage() {", SA_CSS, 1),
 # 2) inject <style>
 ('''    <div style={{ minHeight: "100vh", background: "#F5F0E6", color: "#1A1A1A" }}>
      <InnerTopbar breadcrumb="SET AVAILABILITY" />''',
  '''    <div style={{ minHeight: "100vh", background: "#F5F0E6", color: "#1A1A1A" }}>
      <style>{SA_CSS}</style>
      <InnerTopbar breadcrumb="SET AVAILABILITY" />''', 1),
 # 3) binder wrapper -> class, drop margin+shadow inline
 ('''      <div
        style={{
          position: "relative",
          display: "flex",
          margin: "0 46px 0 40px",
          border: "3px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          background: "#F5F0E6",
        }}
      >''',
  '''      <div
        className="sa-binder"
        style={{
          position: "relative",
          display: "flex",
          border: "3px solid #1A1A1A",
          background: "#F5F0E6",
        }}
      >''', 1),
 # 4) holes -> class
 ('''          <span
            key={topPct}
            aria-hidden
            style={{''',
  '''          <span
            key={topPct}
            aria-hidden
            className="sa-hole"
            style={{''', 1),
 # 5) content area -> class, drop inline padding
 ('        <div style={{ flex: 1, padding: 16, minHeight: 440 }}>',
  '        <div className="sa-content" style={{ flex: 1, minHeight: 440 }}>', 1),
 # 6) both grids -> class
 ('<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>',
  '<div className="sa-grid">', 2),
 # 7) tab container -> class
 ('''        <div
          style={{
            position: "absolute",
            right: -34,
            top: 40,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {TABS.map((tab) => {''',
  '''        <div className="sa-tabs">
          {TABS.map((tab) => {''', 1),
 # 8) tab button -> class + dual labels
 ('''              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                  height: 140,
                  background: isActive ? "#1A1A1A" : "#FEFCF9",
                  color: isActive ? "#FEFCF9" : "#1A1A1A",
                  border: "3px solid #1A1A1A",
                  borderLeft: "none",
                  boxShadow: "3px 3px 0 #1A1A1A",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  padding: "14px 9px",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>''',
  '''              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="sa-tab"
                style={{
                  background: isActive ? "#1A1A1A" : "#FEFCF9",
                  color: isActive ? "#FEFCF9" : "#1A1A1A",
                }}
              >
                <span className="sa-tab-full">{tab.label}</span>
                <span className="sa-tab-short">{tab.key}</span>
              </button>''', 1),
]

def main():
    path=os.path.join(ROOT, REL)
    if not os.path.exists(path):
        print(f"ABORTED — file not found: {REL}"); sys.exit(1)
    t=open(path,encoding="utf-8").read()
    problems=[]
    for old,new,exp in EDITS:
        c=t.count(old)
        if c!=exp: problems.append(f"expected {exp}x, found {c}x of: {old[:60]!r}")
    if problems:
        print("ABORTED — nothing written (your file differs from expected):")
        for p in problems: print("  -",p)
        sys.exit(1)
    for old,new,exp in EDITS: t=t.replace(old,new)
    open(path,"w",encoding="utf-8").write(t)
    print(f"OK — Set Availability mobile pass applied ({len(EDITS)} edits).")

main()
