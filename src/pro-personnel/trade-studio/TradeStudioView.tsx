"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import RosterPanel, { type RosterAssetItem } from "./RosterPanel";
import OfferCard from "./OfferCard";
import PassConfirmModal from "./PassConfirmModal";
import { type PersonaKey } from "@/pro-personnel/trade-engine/studio/persona";
import type { StudioOffer } from "@/pro-personnel/trade-engine/studio/types";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

type RosterApiAsset = {
  key: string;
  name: string;
  meta: string;
  rosterMeta: string;
  position: string;
  posGroup: string;
  tier: string;
  value: number;
  type: "player" | "pick";
  isStud?: boolean;
  isYouth?: boolean;
};

// Synthesize works_for_you / works_for_them from value gap ratio for feedback
// POST backwards-compat. The schema column accepts these as nullable but we
// populate them so any downstream ML training data stays consistent.
//   ratio = 1.00 → 85 (fair)
//   ratio = 1.20 → 95 (you ahead)
//   ratio = 0.80 → 75 (you behind)
function synthFitFromRatio(ratio: number, perspective: "you" | "them"): number {
  const r = perspective === "you" ? ratio : (ratio > 0 ? 1 / ratio : 0);
  return Math.round(Math.max(0, Math.min(100, 85 + (r - 1) * 50)));
}

export default function TradeStudioView() {
  const { rosterId = "", teamName = "" } = readStoredTeam();
  const [allRosters, setAllRosters] = useState<Record<string, RosterApiAsset[]>>({});
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [shopKeys, setShopKeys] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [offers, setOffers] = useState<StudioOffer[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [advisorByOffer, setAdvisorByOffer] = useState<Record<string, { prose: string; loading: boolean }>>({});
  const [needsRegenerate, setNeedsRegenerate] = useState(false);
  const [showPassModal, setShowPassModal] = useState(false);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [toast, setToast] = useState("");

  // Tracks advisor fetches currently in flight so the effect can re-run on
  // state updates without firing duplicate requests. Replaces the earlier
  // AbortController dance that aborted its own in-flight requests on every
  // setState (the prose-empty guard never short-circuited because empty
  // string is falsy → re-entry → abort → fallback prose stomp).
  const inFlightRefs = useRef<Set<string>>(new Set());

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Load all rosters via existing trade-builder targets endpoint
  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(rosterId)}`)
      .then(r => r.json())
      .then(j => {
        const rosters: Record<string, RosterApiAsset[]> = j.rosters ?? {};
        setAllRosters(rosters);
        const names: Record<string, string> = {};
        for (const [tid, assets] of Object.entries(rosters)) {
          const sample = (assets as { teamName?: string }[])[0];
          names[tid] = sample?.teamName ?? `Team ${tid}`;
        }
        // Use stored team name for self
        if (teamName) names[rosterId] = teamName;
        setTeamNames(names);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rosterId, teamName]);

  // My roster items for the panel
  const myAssets = useMemo<RosterAssetItem[]>(() => {
    const raw = allRosters[rosterId] ?? [];
    return raw.map(a => ({
      key: a.key,
      name: a.name,
      meta: a.rosterMeta ?? a.meta,
      position: a.position,
      posGroup: a.posGroup,
      tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
      value: a.value ?? 0,
      type: a.type,
    }));
  }, [allRosters, rosterId]);

  const handleToggle = useCallback((key: string) => {
    setShopKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (drawerOpen) setNeedsRegenerate(true);
  }, [drawerOpen]);

  const fetchOffers = useCallback(async (opts?: {
    personaOverride?: PersonaKey;
    anchorPartnerId?: string;
  }): Promise<StudioOffer[]> => {
    if (shopKeys.size === 0 || !rosterId) return [];
    const res = await fetch("/api/pro-personnel/trade-studio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: rosterId,
        shop_list_keys: Array.from(shopKeys),
        persona_override: opts?.personaOverride,
        anchor_partner_id: opts?.anchorPartnerId,
        rosters: allRosters,
        team_names: teamNames,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? "Generation failed");
    }
    const j = await res.json();
    return Array.isArray(j.offers) ? j.offers : [];
  }, [shopKeys, rosterId, allRosters, teamNames]);

  const handleGenerate = useCallback(async () => {
    if (shopKeys.size === 0) return;
    setGenerating(true);
    try {
      const generated = await fetchOffers();
      setOffers(generated);
      setActiveIndex(0);
      setAdvisorByOffer({});
      setNeedsRegenerate(false);
      setDrawerOpen(true);
      if (generated.length === 0) flash("No offers met the constraints. Try a different persona or adjust your block.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [shopKeys, fetchOffers, flash]);

  // Build the rosters payload that the advisor expects (key + name only)
  const advisorRosterPayload = useMemo(() => {
    const payload: Record<string, Array<{ key: string; name: string; position: string; posGroup: string; value: number; tier: string; type: string; isStud?: boolean; isYouth?: boolean; meta: string; rosterMeta: string }>> = {};
    for (const [tid, assets] of Object.entries(allRosters)) {
      payload[tid] = assets.map(a => ({
        key: a.key,
        name: a.name,
        position: a.position,
        posGroup: a.posGroup,
        value: a.value,
        tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
        type: a.type,
        isStud: a.isStud,
        isYouth: a.isYouth,
        meta: a.meta,
        rosterMeta: a.rosterMeta,
      }));
    }
    return payload;
  }, [allRosters]);

  // Fetch advisor prose for active offer when it changes.
  // Re-entry safe: inFlightRefs prevents duplicate fetches while one is
  // already pending for this offer. .finally() removes the marker so the
  // user can re-trigger after navigating away and back if needed.
  useEffect(() => {
    if (!drawerOpen || offers.length === 0) return;
    const offer = offers[activeIndex];
    if (!offer) return;
    if (advisorByOffer[offer.id]?.prose) return;
    if (inFlightRefs.current.has(offer.id)) return;

    inFlightRefs.current.add(offer.id);
    setAdvisorByOffer(prev => ({ ...prev, [offer.id]: { prose: prev[offer.id]?.prose ?? "", loading: true } }));

    const dealAssets = [
      ...offer.send.map(a => ({ key: a.key, name: a.name, fromTeamId: rosterId, toTeamId: offer.partnerTeamId })),
      ...offer.receive.map(a => ({ key: a.key, name: a.name, fromTeamId: offer.partnerTeamId, toTeamId: rosterId })),
    ];

    fetch("/api/pro-personnel/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        my_team_id: rosterId,
        other_team_ids: [offer.partnerTeamId],
        deal_assets: dealAssets,
        rosters: advisorRosterPayload,
      }),
    })
      .then(r => r.json())
      .then(j => {
        setAdvisorByOffer(prev => ({ ...prev, [offer.id]: { prose: j.prose ?? "Couldn't generate analysis for this one.", loading: false } }));
      })
      .catch(() => {
        setAdvisorByOffer(prev => ({ ...prev, [offer.id]: { prose: prev[offer.id]?.prose ?? "Couldn't generate analysis for this one.", loading: false } }));
      })
      .finally(() => {
        inFlightRefs.current.delete(offer.id);
      });
  }, [drawerOpen, offers, activeIndex, advisorByOffer, rosterId, advisorRosterPayload]);

  const handlePersonaChange = useCallback(async (newPersona: PersonaKey) => {
    if (offers.length === 0) return;
    const current = offers[activeIndex];
    if (!current) return;
    setGenerating(true);
    try {
      const replaced = await fetchOffers({ personaOverride: newPersona, anchorPartnerId: current.partnerTeamId });
      const replacement = replaced[0];
      if (!replacement) {
        flash(`No clean ${newPersona.replace("_", " ")} deal with ${current.partnerTeamName}.`);
        return;
      }
      setOffers(prev => {
        const next = [...prev];
        next[activeIndex] = replacement;
        return next;
      });
      setAdvisorByOffer(prev => {
        const next = { ...prev };
        delete next[current.id];
        return next;
      });
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed to swap persona");
    } finally {
      setGenerating(false);
    }
  }, [offers, activeIndex, fetchOffers, flash]);

  const handlePass = useCallback(async () => {
    const offer = offers[activeIndex];
    if (!offer) return;
    fetch("/api/pro-personnel/trade-studio/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: rosterId,
        partner_team_id: offer.partnerTeamId,
        persona: offer.persona,
        shop_list: Array.from(shopKeys),
        offer_payload: offer,
        works_for_you: synthFitFromRatio(offer.valueGap.ratio, "you"),
        works_for_them: synthFitFromRatio(offer.valueGap.ratio, "them"),
      }),
    }).catch(() => {});
    setOffers(prev => prev.filter((_, i) => i !== activeIndex));
    setActiveIndex(prev => Math.max(0, prev - (prev === offers.length - 1 ? 1 : 0)));
    setShowPassModal(false);
  }, [offers, activeIndex, rosterId, shopKeys]);

  const handleTryPersona = useCallback((newPersona: PersonaKey) => {
    setShowPassModal(false);
    handlePersonaChange(newPersona);
  }, [handlePersonaChange]);

  const handleEdit = useCallback(() => {
    const offer = offers[activeIndex];
    if (!offer) return;
    try {
      sessionStorage.setItem("cfc_studio_seed_deal", JSON.stringify({
        partner_team_id: offer.partnerTeamId,
        partner_team_name: offer.partnerTeamName,
        send: offer.send,
        receive: offer.receive,
      }));
    } catch {}
    window.location.href = "/trade-builder?seed=studio";
  }, [offers, activeIndex]);

  const handleMakeOffer = useCallback(async () => {
    const offer = offers[activeIndex];
    if (!offer || sendingOffer) return;
    setSendingOffer(true);
    try {
      const res = await fetch("/api/pro-personnel/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: rosterId,
          to_team_id: offer.partnerTeamId,
          assets_from: offer.send.map(a => ({ key: a.key, label: a.name, type: a.type, value: a.value })),
          assets_to: offer.receive.map(a => ({ key: a.key, label: a.name, type: a.type, value: a.value })),
          from_value: Math.round(offer.sendValue),
          to_value: Math.round(offer.receiveValue),
          grade_label: "Studio",
        }),
      });
      if (res.ok) {
        flash("Offer sent!");
        // Always go to inbox, not the thread itself
        setTimeout(() => { window.location.href = "/inbox"; }, 800);
      } else {
        const j = await res.json().catch(() => ({}));
        flash(j.error || "Failed to send");
      }
    } catch {
      flash("Failed to send");
    } finally {
      setSendingOffer(false);
    }
  }, [offers, activeIndex, rosterId, sendingOffer, flash]);

  const goPrev = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i - 1 + offers.length) % offers.length);
  }, [offers.length]);
  const goNext = useCallback(() => {
    if (offers.length <= 1) return;
    setActiveIndex(i => (i + 1) % offers.length);
  }, [offers.length]);

  const currentOffer = offers[activeIndex] ?? null;
  const generateButtonDisabled = shopKeys.size === 0 || generating;
  const generateButtonLabel = generating
    ? "Generating…"
    : drawerOpen
    ? "Regenerate offers"
    : "Generate offers";

  if (!rosterId) {
    return (
      <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F }}>
        <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "32px 40px", textAlign: "center" }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Sign in to shop</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>
      )}

      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div onClick={() => { window.location.href = "/inbox"; }} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back to inbox</div>
        <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>Who are you shopping?</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: FM, fontSize: 10, color: "#8C7E6A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{teamName}</div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: drawerOpen ? "40% 60%" : "1fr", minHeight: 0, overflow: "hidden" }}>
        <RosterPanel
          assets={myAssets}
          selectedKeys={shopKeys}
          onToggle={handleToggle}
          onGenerate={handleGenerate}
          layout={drawerOpen ? "list" : "grid"}
          buttonLabel={generateButtonLabel}
          buttonPulse={drawerOpen && needsRegenerate}
          buttonDisabled={generateButtonDisabled}
        />

        {drawerOpen && (
          <div style={{ background: "#FEFCF9", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {loading || generating ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
                Generating offers…
              </div>
            ) : currentOffer ? (
              <OfferCard
                offer={currentOffer}
                index={activeIndex}
                total={offers.length}
                advisorProse={advisorByOffer[currentOffer.id]?.prose ?? "Reading the matchup…"}
                advisorLoading={!!advisorByOffer[currentOffer.id]?.loading}
                onPrev={goPrev}
                onNext={goNext}
                onPersonaChange={handlePersonaChange}
                onPass={() => setShowPassModal(true)}
                onEdit={handleEdit}
                onMakeOffer={handleMakeOffer}
                sendingOffer={sendingOffer}
              />
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A" }}>
                No offers met the constraints. Adjust your block or persona and regenerate.
              </div>
            )}
          </div>
        )}
      </div>

      {showPassModal && currentOffer && (
        <PassConfirmModal
          currentPersona={currentOffer.persona}
          onTryPersona={handleTryPersona}
          onPass={handlePass}
          onClose={() => setShowPassModal(false)}
        />
      )}
    </div>
  );
}
