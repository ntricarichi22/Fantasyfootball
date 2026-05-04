"use client";

import type { StudioOffer } from "../../lib/trade/studio/types";

type Props = {
  anchorOffer: StudioOffer;
  similarOffers: StudioOffer[];
  loading: boolean;
  onPick: (offer: StudioOffer) => void;
  onClose: () => void;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

function fitColor(value: number): string {
  if (value >= 85) return "#007370";
  if (value >= 67) return "#F5C230";
  return "#E8503A";
}

export default function MoreLikeThisModal({ anchorOffer, similarOffers, loading, onPick, onClose }: Props) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "6px 6px 0 #1A1A1A", width: "90%", maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ background: "#1A1A1A", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, color: "#FEFCF9" }}>More like this</div>
            <div style={{ fontFamily: FM, fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>
              Similar shape, different partners
            </div>
          </div>
          <div onClick={onClose} style={{ fontSize: 18, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontWeight: 700 }}>✕</div>
        </div>

        <div style={{ padding: "14px 20px", borderBottom: "1.5px solid #C8C3B8", background: "#F5F0E6" }}>
          <div style={{ fontFamily: FM, fontSize: 8, color: "#8C7E6A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>You liked</div>
          <div style={{ fontFamily: F, fontSize: 12, color: "#1A1A1A" }}>
            <span style={{ fontWeight: 700 }}>{anchorOffer.partnerTeamName}</span>
            <span style={{ color: "#8C7E6A" }}> — {anchorOffer.send.map(a => a.name).join(" + ")} for {anchorOffer.receive.map(a => a.name).join(" + ")}</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {loading ? (
            <div style={{ padding: "30px 0", textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
              Finding similar shapes…
            </div>
          ) : similarOffers.length === 0 ? (
            <div style={{ padding: "30px 0", textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
              No clean alternatives with similar shape. Try a different persona or partner.
            </div>
          ) : (
            similarOffers.map(offer => (
              <div
                key={offer.id}
                onClick={() => { onPick(offer); onClose(); }}
                style={{ border: "2px solid #1A1A1A", background: "#FEFCF9", padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#F5F0E6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#FEFCF9"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 14, color: "#1A1A1A" }}>{offer.partnerTeamName}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, color: "#FEFCF9", background: fitColor(offer.worksForYou.total), padding: "2px 6px" }}>
                      You {offer.worksForYou.total}%
                    </span>
                    <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, color: "#FEFCF9", background: fitColor(offer.worksForThem.total), padding: "2px 6px" }}>
                      Them {offer.worksForThem.total}%
                    </span>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11 }}>
                  <div>
                    <div style={{ fontFamily: FM, fontSize: 7, color: "#8C7E6A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>You send</div>
                    {offer.send.map(a => <div key={a.key} style={{ fontWeight: 600, color: "#1A1A1A" }}>{a.name}</div>)}
                  </div>
                  <div>
                    <div style={{ fontFamily: FM, fontSize: 7, color: "#8C7E6A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>You receive</div>
                    {offer.receive.map(a => <div key={a.key} style={{ fontWeight: 600, color: "#1A1A1A" }}>{a.name}</div>)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
