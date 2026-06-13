"use client"

/**
 * Short connector from the bottom of the GM card down into the three
 * director tabs: a center drop, a horizontal rail, and three stubs at
 * the 1/6, 1/2, 5/6 column centers (the tab centers).
 */
export function MobileOrgLines() {
  const ink = "#1A1A1A"
  return (
    <div style={{ position: "relative", width: "100%", height: 22, flexShrink: 0 }} aria-hidden="true">
      <div style={{ position: "absolute", left: "calc(50% - 1px)", top: 0, width: 2, height: 10, background: ink }} />
      <div style={{ position: "absolute", left: "16.6%", right: "16.6%", top: 10, height: 2, background: ink }} />
      <div style={{ position: "absolute", left: "16.6%", top: 10, width: 2, bottom: 0, background: ink }} />
      <div style={{ position: "absolute", left: "calc(50% - 1px)", top: 10, width: 2, bottom: 0, background: ink }} />
      <div style={{ position: "absolute", right: "16.6%", top: 10, width: 2, bottom: 0, background: ink }} />
    </div>
  )
}
