"use client";

const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const MUTED = "#8C7E6A";
const MUTEDB = "#D8CFBC";
const mono = "'JetBrains Mono', ui-monospace, monospace";
const impact = "Impact, 'Anton', system-ui, sans-serif";

export type StrategyOption = { value: string; label: string; desc: string };

type Props = {
  heading: string;
  question: string;
  accent: string;
  options: StrategyOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClose: () => void;
};

const ANIM = `
@keyframes ss-flip-in {
  from { opacity: 0; transform: perspective(900px) rotateX(-14deg) scale(0.94); }
  to   { opacity: 1; transform: perspective(900px) rotateX(0deg) scale(1); }
}`;

export default function StrategyEditorOverlay({
  heading,
  question,
  accent,
  options,
  selected,
  onToggle,
  onClose,
}: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <style>{ANIM}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PAPER,
          border: `3px solid ${INK}`,
          borderRadius: 12,
          boxShadow: `4px 4px 0 ${INK}`,
          boxSizing: "border-box",
          width: 360,
          maxWidth: "100%",
          overflow: "hidden",
          animation: "ss-flip-in 160ms ease-out",
          transformOrigin: "center top",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "14px 16px 10px",
            borderBottom: "1.5px dashed #8C7E6A",
          }}
        >
          <div>
            <p style={{ fontFamily: impact, fontSize: 22, fontWeight: 900, color: INK, margin: 0, lineHeight: 1 }}>
              {heading}
            </p>
            <p
              style={{
                fontFamily: mono,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.16em",
                color: MUTED,
                margin: "6px 0 0",
              }}
            >
              {question}
            </p>
          </div>
          <span
            onClick={onClose}
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: INK,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            {"\u00D7"}
          </span>
        </div>

        <div style={{ height: 2.5, background: accent }} />

        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {options.map((o) => {
            const active = selected.includes(o.value);
            return (
              <div
                key={o.value}
                onClick={() => onToggle(o.value)}
                style={{
                  border: `2px solid ${INK}`,
                  borderRadius: 8,
                  padding: "11px 13px",
                  background: active ? INK : PAPER,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 12.5,
                      fontWeight: 800,
                      letterSpacing: "0.02em",
                      color: active ? PAPER : INK,
                    }}
                  >
                    {o.label}
                  </span>
                  {active && (
                    <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 14, fontWeight: 700, color: PAPER }}>
                      {"\u2713"}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 11,
                    fontWeight: 500,
                    color: active ? MUTEDB : MUTED,
                    marginTop: 4,
                    lineHeight: 1.3,
                  }}
                >
                  {o.desc}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%",
              background: INK,
              color: PAPER,
              border: `2px solid ${INK}`,
              borderRadius: 8,
              padding: "12px 0",
              fontFamily: mono,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.14em",
              cursor: "pointer",
            }}
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}