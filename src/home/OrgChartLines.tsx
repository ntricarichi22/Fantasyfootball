"use client"

export type OrgChartLinesProps = {
  gap?: number
}

/**
 * Renders the vertical drop from the GM card, the horizontal bar across
 * the three director columns, and three vertical stubs into each director box.
 * Lives in its own row between the GM card and the director row.
 */
export function OrgChartLines({ gap = 16 }: OrgChartLinesProps) {
  const gapTotal = gap * 2
  const colCenter = `calc((100% - ${gapTotal}px) / 6)`
  const colCenterStub = `calc((100% - ${gapTotal}px) / 6 - 1.5px)`
  const lineColor = "#1A1A1A"

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 50,
      }}
      aria-hidden="true"
    >
      {/* Vertical drop from GM card (centered) */}
      <div
        style={{
          position: "absolute",
          left: "calc(50% - 1.5px)",
          top: 0,
          width: 3,
          height: 25,
          background: lineColor,
        }}
      />

      {/* Horizontal bar from col1 center to col3 center */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: colCenter,
          right: colCenter,
          height: 3,
          background: lineColor,
        }}
      />

      {/* Stub down to col1 (Scouting) */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: colCenterStub,
          width: 3,
          height: 26,
          background: lineColor,
        }}
      />

      {/* Stub down to col2 (Pro Personnel) */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: "calc(50% - 1.5px)",
          width: 3,
          height: 26,
          background: lineColor,
        }}
      />

      {/* Stub down to col3 (Strategy) */}
      <div
        style={{
          position: "absolute",
          top: 24,
          right: colCenterStub,
          width: 3,
          height: 26,
          background: lineColor,
        }}
      />
    </div>
  )
}