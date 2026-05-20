"use client";

// src/pro-personnel/components/OfferCard.tsx
//
// Universal trade offer card. Same component renders in three contexts:
//   1. Builder cycler — Pass | Edit | Make this offer
//   2. Studio cycler  — Pass | Edit | Make this offer
//   3. Inbox thread   — Pass | Counter | Accept  (future, via label props)
//   4. Chat proposed_trade — same as cycler treatment (future)
//
// LOCKED design:
//   - Max width 560px, centered. Caller is responsible for placing it
//     in the layout (full-width centered in Builder, centered within
//     the 60% column in Studio).
//   - 2.5px black border, 4px offset shadow, no rounded corners.
//   - Team name (left) + persona chip (right) — partner persona always.
//   - 2-column ledger (SEND | RECEIVE) with cream-tiled asset cells.
//   - Inline director treatment: 36px avatar + verdict (bold caps with
//     colored 4px underline) + prose body.
//   - Pass | Edit row split by 2px vertical black border.
//   - Full-width primary commit button in blue with 3px offset shadow.
//
// Verdict underline colors (driven by verdictColor prop):
//   #019942 green   — "We should take this deal"
//   #F5C230 yellow  — "I'd push for more here"
//   #E8503A red     — "Don't even entertain this"

import type { PersonaKey } from "@/pro-personnel/trade-engine/studio/persona";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

export type CardAsset = {
  key: string;
  name: string;
  meta?: string;
  type?: "player" | "pick";
};

type OfferCardProps = {
  partnerName: string;
  partnerPersona: PersonaKey | null;
  sendAssets: CardAsset[];
  receiveAssets: CardAsset[];

  // Director inline section
  verdict: string;          // "We should take this deal" / etc.
  verdictColor: string;     // hex — green/yellow/red
  prose: string;
  proseLoading?: boolean;

  // Action handlers
  onPass: () => void;
  onEdit: () => void;
  onMakeOffer: () => void;

  // Optional label overrides (default to cycler labels)
  destructiveLabel?: string;  // default "PASS"
  secondaryLabel?: string;    // default "EDIT"
  primaryLabel?: string;      // default "MAKE THIS OFFER"

  // State
  sending?: boolean;
};

const PERSONA_LABELS: Record<PersonaKey, string> = {
  closer: "CLOSER",
  straight_shooter: "STRAIGHT SHOOTER",
  hustler: "HUSTLER",
  architect: "ARCHITECT",
};

// Tabler placeholder icons — globally loaded via CSS link
const PERSONA_ICONS: Record<PersonaKey, string> = {
  closer: "ti-handshake",
  straight_shooter: "ti-target-arrow",
  hustler: "ti-arrows-shuffle",
  architect: "ti-blueprint",
};

export default function OfferCard({
  partnerName,
  partnerPersona,
  sendAssets,
  receiveAssets,
  verdict,
  verdictColor,
  prose,
  proseLoading = false,
  onPass,
  onEdit,
  onMakeOffer,
  destructiveLabel = "PASS",
  secondaryLabel = "EDIT",
  primaryLabel = "MAKE THIS OFFER",
  sending = false,
}: OfferCardProps) {
  return (
    <div style={{
      background: "#FEFCF9",
      border: "2.5px solid #1A1A1A",
      boxShadow: "4px 4px 0 #1A1A1A",
      maxWidth: 560,
      margin: "0 auto",
      width: "100%",
      fontFamily: F,
      color: "#1A1A1A",
    }}>
      {/* Team header */}
      <div style={{
        padding: "16px 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "2px solid #1A1A1A",
        gap: 12,
      }}>
        <div style={{
          fontFamily: FH,
          fontWeight: 800,
          fontSize: 19,
          letterSpacing: "-0.01em",
          color: "#1A1A1A",
          textTransform: "uppercase",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {partnerName}
        </div>
        {partnerPersona && (
          <div style={{
            background: "#1A1A1A",
            color: "#FEFCF9",
            padding: "5px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}>
            <i className={`ti ${PERSONA_ICONS[partnerPersona]}`} style={{ fontSize: 13 }} aria-hidden="true" />
            <span style={{
              fontFamily: FM,
              fontSize: 10,
              letterSpacing: "0.1em",
              fontWeight: 700,
            }}>
              {PERSONA_LABELS[partnerPersona]}
            </span>
          </div>
        )}
      </div>

      {/* Ledger */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        borderBottom: "2px solid #1A1A1A",
      }}>
        <div style={{ padding: "16px 18px", borderRight: "2px solid #1A1A1A" }}>
          <div style={{
            fontFamily: FM,
            fontSize: 9,
            letterSpacing: "0.14em",
            fontWeight: 700,
            color: "#8C7E6A",
            marginBottom: 10,
          }}>
            SEND
          </div>
          {sendAssets.map(a => <AssetCell key={a.key} asset={a} />)}
        </div>
        <div style={{ padding: "16px 18px" }}>
          <div style={{
            fontFamily: FM,
            fontSize: 9,
            letterSpacing: "0.14em",
            fontWeight: 700,
            color: "#8C7E6A",
            marginBottom: 10,
          }}>
            RECEIVE
          </div>
          {receiveAssets.map(a => <AssetCell key={a.key} asset={a} />)}
        </div>
      </div>

      {/* Director inline section */}
      <div style={{
        padding: "20px 18px",
        borderBottom: "2px solid #1A1A1A",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <img
          src="/avatars/pro-personnel.png"
          alt=""
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "#1A1A1A",
            display: "inline-block",
            marginBottom: 10,
            textDecoration: "underline",
            textDecorationColor: verdictColor,
            textDecorationThickness: 4,
            textUnderlineOffset: 6,
          }}>
            {verdict}
          </span>
          <div style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: "#1A1A1A",
            opacity: proseLoading ? 0.5 : 1,
          }}>
            {prose}
          </div>
        </div>
      </div>

      {/* Pass | Edit (or Pass | Counter) row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        borderBottom: "2px solid #1A1A1A",
      }}>
        <button
          onClick={onPass}
          style={{
            background: "#FEFCF9",
            border: "none",
            padding: "14px",
            fontFamily: FM,
            fontSize: 11,
            letterSpacing: "0.1em",
            fontWeight: 700,
            color: "#E8503A",
            cursor: "pointer",
            borderRight: "2px solid #1A1A1A",
            textTransform: "uppercase",
          }}
        >
          {destructiveLabel}
        </button>
        <button
          onClick={onEdit}
          style={{
            background: "#FEFCF9",
            border: "none",
            padding: "14px",
            fontFamily: FM,
            fontSize: 11,
            letterSpacing: "0.1em",
            fontWeight: 700,
            color: "#1A1A1A",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          {secondaryLabel}
        </button>
      </div>

      {/* Primary commit button — blue with offset shadow */}
      <div style={{ padding: 14 }}>
        <button
          onClick={sending ? undefined : onMakeOffer}
          disabled={sending}
          style={{
            width: "100%",
            background: "#185FA5",
            color: "#FEFCF9",
            border: "2px solid #1A1A1A",
            boxShadow: "3px 3px 0 #1A1A1A",
            padding: "12px",
            fontFamily: FM,
            fontSize: 12,
            letterSpacing: "0.1em",
            fontWeight: 700,
            cursor: sending ? "not-allowed" : "pointer",
            opacity: sending ? 0.6 : 1,
            textTransform: "uppercase",
          }}
        >
          {sending ? "SENDING…" : primaryLabel}
        </button>
      </div>
    </div>
  );
}

function AssetCell({ asset }: { asset: CardAsset }) {
  return (
    <div style={{
      background: "#F5F0E6",
      border: "1.5px solid #1A1A1A",
      padding: "10px 12px",
      marginBottom: 8,
    }}>
      <div style={{
        fontWeight: 700,
        fontSize: 14,
        color: "#1A1A1A",
        lineHeight: 1.2,
      }}>
        {asset.name}
      </div>
      {asset.meta && (
        <div style={{
          fontFamily: FM,
          fontSize: 10,
          color: "#8C7E6A",
          marginTop: 3,
        }}>
          {asset.meta}
        </div>
      )}
    </div>
  );
}