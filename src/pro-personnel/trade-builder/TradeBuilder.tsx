"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import TradeBalanceChip from "@/shared/ui/TradeBalanceChip";
import { teamNick } from "@/shared/util/teamNick";
import DealCard, { type DealAsset } from "@/pro-personnel/trade-builder/DealCard";
import AIAdvisor, { type AdvisorSuggestion } from "@/pro-personnel/trade-builder/AIAdvisor";
import PlayerRow from "@/pro-personnel/trade-builder/PlayerRow";
import TierDivider from "@/pro-personnel/trade-builder/TierDivider";
import RoutingPopup from "@/pro-personnel/trade-builder/RoutingPopup";
import TeamPickerModal, { type PartnerFit } from "@/pro-personnel/trade-builder/TeamPickerModal";
import SendNoteModal from "@/pro-personnel/components/SendNoteModal";

type Team = { id: string; name: string };
type Props = {
  initialTeams: Team[];
  // Seeds both sides of a deal at once (Edit handoffs from the cycler/Studio).
  initialDealAssets?: DealAsset[];
  // The director's take on the seeded deal, carried over from the card the
  // user tapped Edit on — shown verbatim (plus a bridge line) so the handoff
  // reads as one continuous conversation. The live Studio advisor takes over
  // on the first change to the deal.
  initialAdvisor?: { prose: string; grade: string; gradeColor: string };
  onBack: () => void;
};
type RosterPlayer = {
  key: string; name: string; meta: string; rosterMeta: string;
  tier: string; value: number; position: string; posGroup: string;
  type: "player" | "pick"; fitScore: number;
  isStud: boolean; isYouth: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const POS_SECTIONS = [
  { key: "QB", label: "Quarterbacks" },
  { key: "RB", label: "Running Backs" },
  { key: "PASS", label: "Pass Catchers" },
  { key: "PICK", label: "Draft Picks" },
];

export default function TradeBuilder({ initialTeams, initialDealAssets, initialAdvisor, onBack }: Props) {
  const { rosterId = "", teamName: myTeamName = "" } = readStoredTeam();
  const myTeamId = rosterId;

  const [teams, setTeams] = useState<Team[]>(() => {
    const me = { id: myTeamId, name: myTeamName || `Team ${myTeamId}` };
    return [me, ...initialTeams.filter(t => t.id !== myTeamId)];
  });

  const [dealAssets, setDealAssets] = useState<DealAsset[]>(() => initialDealAssets ?? []);
  const [activeTab, setActiveTab] = useState(myTeamId);
  const [rosters, setRosters] = useState<Record<string, RosterPlayer[]>>({});
  const [allTeamsList, setAllTeamsList] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // Engine-ranked partner fit (who the director found deals with) — fetched in
  // the background; the picker orders its team list by it when available.
  const [fitRanking, setFitRanking] = useState<PartnerFit[] | null>(null);
  const [routingPopup, setRoutingPopup] = useState<{ key: string; name: string; fromTeamId: string } | null>(null);
  const [pickerMode, setPickerMode] = useState<"swap" | "add" | null>(null);
  // Whether the CURRENT picker session offers cross-roster player search.
  // Captured when the picker opens (no partner yet) so the first search-pick —
  // which creates the partner — doesn't yank search out from under the modal.
  const [pickerSearch, setPickerSearch] = useState(false);
  // Mobile: the roster panel renders as a bottom sheet; this holds the teamId
  // whose roster the sheet shows (null = closed). Inert on desktop.
  const [sheetOpen, setSheetOpen] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const [advisorProse, setAdvisorProse] = useState(() =>
    initialAdvisor ? initialAdvisor.prose : "Add assets to both sides to get my take on this deal.",
  );
  const [advisorGrade, setAdvisorGrade] = useState(() => initialAdvisor?.grade ?? "");
  const [advisorGradeColor, setAdvisorGradeColor] = useState(() => initialAdvisor?.gradeColor ?? "#8C7E6A");
  const [advisorSuggestions, setAdvisorSuggestions] = useState<AdvisorSuggestion[]>([]);
  const [advisorLoading, setAdvisorLoading] = useState(false);

  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const advisorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fresh entry (?seed=fresh) starts with NO partner team. When the user takes
  // an action that needs one (tapping their own player, "+ Add from their
  // roster"), we open the team picker and stash the intended add here so it
  // completes right after they choose.
  const pendingAddRef = useRef<{ key: string; name: string } | null>(null);
  // While the carried-over director take is on screen, hold the live advisor
  // back until the deal actually changes (the effect also re-fires when the
  // async roster fetch lands — that must not clobber his words).
  const initialDealRef = useRef(dealAssets);
  const carriedProseRef = useRef(!!initialAdvisor);

  const threeTeam = teams.length > 2;
  const dealKeys = useMemo(() => new Set(dealAssets.map(a => a.key)), [dealAssets]);
  const otherTeams = useMemo(() => teams.filter(t => t.id !== myTeamId), [teams, myTeamId]);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // All swap-picker opens route through here so the session's search mode is
  // captured consistently.
  const openSwapPicker = useCallback(() => {
    setPickerSearch(otherTeams.length === 0);
    setPickerMode("swap");
  }, [otherTeams.length]);

  useEffect(() => {
    if (!myTeamId) return;
    fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(myTeamId)}`)
      .then(r => r.json())
      .then(j => {
        const raw = j.rosters ?? {};
        const r: Record<string, RosterPlayer[]> = {};
        for (const rid of Object.keys(raw)) {
          r[rid] = (raw[rid] ?? []).map((p: RosterPlayer) => {
            // Picks display as one bold name — "2027 Rd 1 (via Onslaught)" —
            // with no muted "Draft pick" line. The via-suffix folds into the
            // name so it carries onto the deal card and sent offers too.
            const isPick = p.type === "pick";
            const via = isPick ? ((p.rosterMeta ?? p.meta ?? "").match(/\(via [^)]+\)/)?.[0] ?? "") : "";
            return {
              ...p,
              // ONE key vocabulary: engine keys (raw sleeper id / pick:…).
              // Seeded deals and advisor suggestions carry engine keys; keeping
              // the panel on "player:" prefixes made the same player two
              // different assets (broken selected-state, double-adds).
              key: p.key.startsWith("player:") ? p.key.slice("player:".length) : p.key,
              name: isPick && via ? `${p.name} ${via}` : p.name,
              tier: p.tier === "core_piece" ? "core" : (p.tier || "core"),
              rosterMeta: isPick ? "" : (p.rosterMeta ?? p.meta),
              isStud: p.isStud ?? false,
              isYouth: p.isYouth ?? false,
            };
          });
        }
        setRosters(r);
        const list: Team[] = [];
        for (const rid of Object.keys(raw)) {
          const sample = (raw[rid] ?? [])[0];
          const name = sample?.teamName ?? `Team ${rid}`;
          list.push({ id: rid, name });
        }
        setAllTeamsList(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [myTeamId]);

  // EDITOR OPENING — the continuation beat. The card showed his take; the GM
  // tapped Edit. Once rosters land, ask the advisor to pick the conversation
  // up: acknowledge the tweak intent, then recommend concrete changes (the
  // same ones rendered as tappable suggestions) or double down if the deal
  // needs nothing. The carried prose stays on screen (dimmed) while it loads.
  const openingFiredRef = useRef(false);
  useEffect(() => {
    if (!initialAdvisor || openingFiredRef.current) return;
    if (!dealAssets.length || Object.keys(rosters).length === 0 || otherTeams.length === 0) return;
    openingFiredRef.current = true;
    let cancelled = false;
    setAdvisorLoading(true);
    fetch("/api/pro-personnel/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        my_team_id: myTeamId,
        other_team_ids: otherTeams.map(t => t.id),
        deal_assets: dealAssets,
        rosters,
        mode: "editor_opening",
        prior_prose: initialAdvisor.prose,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled || !j) return;
        if (j.prose) setAdvisorProse(j.prose);
        setAdvisorSuggestions(Array.isArray(j.suggestions) ? j.suggestions : []);
        if (j.grade) { setAdvisorGrade(j.grade); setAdvisorGradeColor(j.gradeColor ?? "#8C7E6A"); }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAdvisorLoading(false); });
    return () => { cancelled = true; };
  }, [initialAdvisor, dealAssets, rosters, otherTeams, myTeamId]);

  // Background fetch of the engine's partner-fit ranking — non-blocking, the
  // picker works unranked until it lands.
  useEffect(() => {
    if (!myTeamId) return;
    fetch(`/api/pro-personnel/partner-fit?team_id=${encodeURIComponent(myTeamId)}`)
      .then(r => r.json())
      .then(j => { if (Array.isArray(j.teams)) setFitRanking(j.teams); })
      .catch(() => {});
  }, [myTeamId]);

  // While the mobile roster sheet is open we only need the live chip — the
  // grade is deterministic math, so skip the LLM (fast + cheap) and use a
  // short debounce. When the sheet closes the effect re-fires and fetches the
  // full prose for the card.
  const gradeOnly = !!(isMobile && sheetOpen);
  useEffect(() => {
    // Carried director take stays up until the user edits the deal.
    if (carriedProseRef.current) {
      if (dealAssets === initialDealRef.current) return;
      carriedProseRef.current = false;
    }
    if (advisorTimer.current) clearTimeout(advisorTimer.current);
    // No opinion until the deal is two-sided — grading a one-sided "trade"
    // ("we're getting a steal, we give up nothing") is noise.
    const hasSendSide = dealAssets.some(a => a.fromTeamId === myTeamId);
    const hasRecvSide = dealAssets.some(a => a.toTeamId === myTeamId);
    if (!hasSendSide || !hasRecvSide) {
      setAdvisorProse(
        !hasSendSide && !hasRecvSide
          ? "Add players or picks to both sides to get my take."
          : hasRecvSide
            ? "Now pick what you're sending from our side and I'll grade it."
            : "Now pick what you want back from their roster and I'll grade it.",
      );
      setAdvisorGrade("");
      setAdvisorGradeColor("#8C7E6A");
      setAdvisorSuggestions([]);
      setAdvisorLoading(false);
      return;
    }
    setAdvisorLoading(true);
    advisorTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/pro-personnel/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            my_team_id: myTeamId,
            other_team_ids: otherTeams.map(t => t.id),
            deal_assets: dealAssets,
            rosters,
            ...(gradeOnly ? { skip_prose: true } : {}),
          }),
        });
        if (res.ok) {
          const j = await res.json();
          if (!gradeOnly && j.prose) setAdvisorProse(j.prose);
          setAdvisorGrade(j.grade ?? "");
          setAdvisorGradeColor(j.gradeColor ?? "#8C7E6A");
          setAdvisorSuggestions(Array.isArray(j.suggestions) ? j.suggestions : []);
        }
      } catch {} finally {
        setAdvisorLoading(false);
      }
    }, gradeOnly ? 450 : 1500);
    return () => { if (advisorTimer.current) clearTimeout(advisorTimer.current); };
  }, [dealAssets, myTeamId, otherTeams, rosters, gradeOnly]);

  const removeDealAsset = useCallback((key: string) => {
    setDealAssets(prev => prev.filter(a => a.key !== key));
  }, []);

  // Reroute: change toTeamId on the asset, keep fromTeamId as-is
  const rerouteDealAsset = useCallback((key: string, newToTeamId: string) => {
    setDealAssets(prev => prev.map(a => {
      if (a.key !== key) return a;
      const newToTeam = teams.find(t => t.id === newToTeamId);
      return {
        ...a,
        toTeamId: newToTeamId,
        toTeamName: newToTeam?.name ?? newToTeamId,
      };
    }));
  }, [teams]);

  const addDealAsset = useCallback((key: string, name: string, fromTeamId: string, toTeamId: string) => {
    const from = teams.find(t => t.id === fromTeamId);
    const to = teams.find(t => t.id === toTeamId);
    setDealAssets(prev => prev.some(a => a.key === key) ? prev : [...prev, {
      key, name, fromTeamId, toTeamId,
      fromTeamName: from?.name ?? fromTeamId,
      toTeamName: to?.name ?? toTeamId,
    }]);
  }, [teams]);

  const handleRosterTap = useCallback((key: string, name: string) => {
    if (dealKeys.has(key)) { removeDealAsset(key); return; }
    if (threeTeam) { setRoutingPopup({ key, name, fromTeamId: activeTab }); return; }
    if (activeTab === myTeamId) {
      const o = otherTeams[0];
      if (o) {
        addDealAsset(key, name, myTeamId, o.id);
      } else {
        // No partner yet (fresh entry): pick one, then complete this add.
        pendingAddRef.current = { key, name };
        openSwapPicker();
      }
    } else {
      addDealAsset(key, name, activeTab, myTeamId);
    }
  }, [activeTab, threeTeam, myTeamId, otherTeams, dealKeys, addDealAsset, removeDealAsset, openSwapPicker]);

  const handleRoutingSelect = useCallback((toTeamId: string) => {
    if (!routingPopup) return;
    addDealAsset(routingPopup.key, routingPopup.name, routingPopup.fromTeamId, toTeamId);
    setRoutingPopup(null);
  }, [routingPopup, addDealAsset]);

  const handleAddFromTeam = useCallback((teamId: string) => {
    if (teamId === "__universal__") {
      setRoutingPopup({ key: "__browse__", name: "", fromTeamId: "__universal__" });
    } else if (!teamId) {
      // "+ Add from their roster" with no partner yet — pick one first.
      openSwapPicker();
    } else {
      setActiveTab(teamId);
      setRosterSearch("");
      setSheetOpen(teamId); // mobile: open the roster sheet (inert on desktop)
    }
  }, [openSwapPicker]);

  const handleUniversalBrowse = useCallback((teamId: string) => {
    setRoutingPopup(null);
    setActiveTab(teamId);
    setRosterSearch("");
  }, []);

  // Per-asset direction routing — handles same-direction (all send / all
  // receive) and bidirectional swap suggestions uniformly.
  const handleSuggestionTap = useCallback((suggestion: AdvisorSuggestion) => {
    const otherTeam = otherTeams[0];
    if (!otherTeam) return;
    setDealAssets(prev => {
      const existing = new Set(prev.map(a => a.key));
      const additions: DealAsset[] = [];
      for (const asset of suggestion.assets) {
        if (existing.has(asset.key)) continue;
        const fromTeamId = asset.direction === "send" ? myTeamId : otherTeam.id;
        const toTeamId = asset.direction === "send" ? otherTeam.id : myTeamId;
        const fromTeam = teams.find(t => t.id === fromTeamId);
        const toTeam = teams.find(t => t.id === toTeamId);
        additions.push({
          key: asset.key, name: asset.name,
          fromTeamId, toTeamId,
          fromTeamName: fromTeam?.name ?? fromTeamId,
          toTeamName: toTeam?.name ?? toTeamId,
        });
      }
      return [...prev, ...additions];
    });
  }, [otherTeams, myTeamId, teams]);

  // ── Team management ────────────────────────────────────────────────────
  const handleSwapTeam = useCallback((newTeamId: string) => {
    setPickerMode(null);
    if (newTeamId === myTeamId) return;
    const newTeamName = allTeamsList.find(t => t.id === newTeamId)?.name ?? `Team ${newTeamId}`;
    const oldOtherId = otherTeams[0]?.id;

    // No partner yet (fresh entry): this "swap" SETS the partner. Complete any
    // pending roster add that triggered the picker, with explicit names (the
    // `teams` state hasn't updated yet inside this closure).
    if (!oldOtherId) {
      const pending = pendingAddRef.current;
      pendingAddRef.current = null;
      setTeams(prev => {
        const me = prev.find(t => t.id === myTeamId);
        return [
          me ?? { id: myTeamId, name: myTeamName || `Team ${myTeamId}` },
          { id: newTeamId, name: newTeamName },
        ];
      });
      if (pending) {
        setDealAssets(prev => prev.some(a => a.key === pending.key) ? prev : [...prev, {
          key: pending.key, name: pending.name,
          fromTeamId: myTeamId, toTeamId: newTeamId,
          fromTeamName: myTeamName || `Team ${myTeamId}`,
          toTeamName: newTeamName,
        }]);
        // They were browsing their own roster — keep them there.
      } else {
        setActiveTab(newTeamId);
        setSheetOpen(newTeamId); // mobile: show their roster right away
      }
      setRosterSearch("");
      return;
    }

    if (oldOtherId === newTeamId) return;
    setDealAssets(prev =>
      prev
        .filter(a => a.fromTeamId !== oldOtherId)
        .map(a => {
          if (a.toTeamId === oldOtherId) {
            return { ...a, toTeamId: newTeamId, toTeamName: newTeamName };
          }
          return a;
        })
    );
    setTeams(prev => {
      const me = prev.find(t => t.id === myTeamId);
      return [
        me ?? { id: myTeamId, name: myTeamName || `Team ${myTeamId}` },
        { id: newTeamId, name: newTeamName },
      ];
    });
    setActiveTab(newTeamId);
    setSheetOpen(newTeamId); // mobile: show the new partner's roster
    setRosterSearch("");
  }, [myTeamId, myTeamName, otherTeams, allTeamsList]);

  // Player tapped inside the picker's cross-roster search (fresh build, no
  // partner yet). Locks the partner to his team, completes any pending add
  // from our roster, and adds him to our receive side. The picker stays open
  // (same-team browsing) until the user hits Done.
  const handlePickerPlayer = useCallback((teamId: string, key: string, name: string) => {
    if (teamId === myTeamId) return;
    const teamName = allTeamsList.find(t => t.id === teamId)?.name ?? `Team ${teamId}`;
    const myName = myTeamName || `Team ${myTeamId}`;
    if (!otherTeams[0]) {
      const pending = pendingAddRef.current;
      pendingAddRef.current = null;
      setTeams(prev => {
        const me = prev.find(t => t.id === myTeamId);
        return [me ?? { id: myTeamId, name: myName }, { id: teamId, name: teamName }];
      });
      if (pending) {
        setDealAssets(prev => prev.some(a => a.key === pending.key) ? prev : [...prev, {
          key: pending.key, name: pending.name,
          fromTeamId: myTeamId, toTeamId: teamId,
          fromTeamName: myName, toTeamName: teamName,
        }]);
      }
    } else if (otherTeams[0].id !== teamId) {
      return; // search is constrained to the partner once one exists
    }
    setDealAssets(prev => prev.some(a => a.key === key) ? prev : [...prev, {
      key, name,
      fromTeamId: teamId, toTeamId: myTeamId,
      fromTeamName: teamName, toTeamName: myName,
    }]);
  }, [myTeamId, myTeamName, otherTeams, allTeamsList]);

  const handleAddTeam = useCallback((newTeamId: string) => {
    setPickerMode(null);
    if (teams.length >= 3) return;
    if (teams.some(t => t.id === newTeamId)) return;
    const newTeamName = allTeamsList.find(t => t.id === newTeamId)?.name ?? `Team ${newTeamId}`;
    setTeams(prev => [...prev, { id: newTeamId, name: newTeamName }]);
    setActiveTab(newTeamId);
    setRosterSearch("");
  }, [teams, allTeamsList]);

  const handleRemoveThirdTeam = useCallback(() => {
    if (teams.length < 3) return;
    const thirdId = teams[2].id;
    setDealAssets(prev =>
      prev.filter(a => a.fromTeamId !== thirdId && a.toTeamId !== thirdId)
    );
    setTeams(prev => prev.slice(0, 2));
    if (activeTab === thirdId) setActiveTab(myTeamId);
  }, [teams, activeTab, myTeamId]);

  const [sendModalOpen, setSendModalOpen] = useState(false);
  const handleSendOffer = useCallback(async (note: string) => {
    if (sending) return;
    const ms = dealAssets.filter(a => a.fromTeamId === myTeamId);
    const mr = dealAssets.filter(a => a.toTeamId === myTeamId);
    if (!ms.length || !mr.length) { flash("Add assets to both sides."); return; }
    setSending(true);
    try {
      const to = otherTeams[0];
      if (!to) return;
      const res = await fetch("/api/pro-personnel/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myTeamId,
          to_team_id: to.id,
          assets_from: ms.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("pick:") ? "pick" : "player", value: 0 })),
          assets_to: mr.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("pick:") ? "pick" : "player", value: 0 })),
          from_value: 0,
          to_value: 0,
          grade_label: advisorGrade || "Fair",
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (note && j.thread_id) {
          await fetch(`/api/inbox/threads/${encodeURIComponent(j.thread_id)}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from_team_id: myTeamId, message: note }),
          });
        }
        flash("Offer sent!");
        setTimeout(() => { window.location.href = j.thread_id ? `/inbox/${j.thread_id}` : "/inbox"; }, 900);
      } else {
        const j = await res.json().catch(() => ({}));
        flash(j.error || "Failed");
      }
    } catch {
      flash("Failed");
    } finally {
      setSending(false);
    }
  }, [sending, dealAssets, myTeamId, otherTeams, advisorGrade, flash]);

  const activeRoster = useMemo(() => {
    const players = rosters[activeTab] ?? [];
    if (!rosterSearch.trim()) return players;
    const q = rosterSearch.toLowerCase();
    return players.filter(p => p.name.toLowerCase().includes(q) || p.meta.toLowerCase().includes(q) || p.rosterMeta.toLowerCase().includes(q));
  }, [rosters, activeTab, rosterSearch]);

  // Picks list sequentially — 2026 1sts→3rds, then 2027, then 2028 — not by
  // value. Names are "2026 2.02" / "2027 Rd 1 (via X)"; parse year + round.
  const pickOrd = (n: string) => {
    const year = parseInt(n.slice(0, 4), 10) || 9999;
    const round = parseInt(n.match(/Rd (\d)/)?.[1] ?? n.match(/^\d{4} (\d)\./)?.[1] ?? "9", 10);
    return year * 10 + round;
  };
  const posSections = useMemo(() => POS_SECTIONS.map(sec => ({
    ...sec,
    items: activeRoster
      .filter(p => (p.posGroup ?? "OTHER") === sec.key)
      .sort((a, b) => sec.key === "PICK" ? pickOrd(a.name) - pickOrd(b.name) || b.value - a.value : b.value - a.value),
  })).filter(s => s.items.length > 0), [activeRoster]);

  const canSend = dealAssets.some(a => a.fromTeamId === myTeamId) && dealAssets.some(a => a.toTeamId === myTeamId);
  const tabFontSize = teams.length > 2 ? Math.min(11, Math.floor(90 / Math.max(...teams.map(t => teamNick(t.name).length), 1))) : 11;

  const pickerProps = useMemo(() => {
    if (pickerMode === "swap") {
      const hasPartner = otherTeams.length > 0;
      return {
        title: hasPartner ? "Switch trade partner" : "Who are we trading with?",
        directorMessage: hasPartner
          ? "Who are we calling instead? Their pieces come off the card; ours stay put."
          : "Here's the league, ranked by who's most likely to deal with us. Or, if we've got a specific target in mind, punch him into the search and I'll make the call.",
        teams: allTeamsList,
        excludeIds: [myTeamId, ...otherTeams.map(t => t.id)],
        onSelect: handleSwapTeam,
      };
    }
    if (pickerMode === "add") {
      return {
        title: "Add a third team",
        subtitle: "The current deal stays in place.",
        teams: allTeamsList,
        excludeIds: teams.map(t => t.id),
        onSelect: handleAddTeam,
      };
    }
    return null;
  }, [pickerMode, allTeamsList, myTeamId, otherTeams, teams, handleSwapTeam, handleAddTeam]);

  // ── Shared render pieces (desktop column / mobile sheet) ────────────────
  const rosterSearchInput = (
    <input
      type="text"
      placeholder={`Search ${teamNick(teams.find(t => t.id === activeTab)?.name ?? "")} roster…`}
      value={rosterSearch}
      onChange={e => setRosterSearch(e.target.value)}
      style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }}
    />
  );

  const rosterListContent = loading ? (
    <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading roster…</div>
  ) : posSections.length === 0 ? (
    <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>No players found.</div>
  ) : (
    posSections.map(sec => (
      <div key={sec.key}>
        <TierDivider label={sec.label} />
        {sec.items.map(p => (
          <PlayerRow key={p.key} name={p.name} meta={p.rosterMeta} selected={dealKeys.has(p.key)} onToggle={() => handleRosterTap(p.key, p.name)} />
        ))}
      </div>
    ))
  );

  const modals = (
    <>
      {routingPopup && routingPopup.key === "__browse__" ? (
        <RoutingPopup teams={teams} onSelect={handleUniversalBrowse} onClose={() => setRoutingPopup(null)} />
      ) : routingPopup ? (
        <RoutingPopup teams={teams.filter(t => t.id !== routingPopup.fromTeamId)} onSelect={handleRoutingSelect} onClose={() => setRoutingPopup(null)} />
      ) : null}
      {pickerProps && (
        <TeamPickerModal
          title={pickerProps.title}
          subtitle={"subtitle" in pickerProps ? pickerProps.subtitle : undefined}
          directorMessage={"directorMessage" in pickerProps ? pickerProps.directorMessage : undefined}
          teams={pickerProps.teams}
          excludeIds={pickerProps.excludeIds}
          onSelect={pickerProps.onSelect}
          onClose={() => { pendingAddRef.current = null; setPickerMode(null); }}
          fitRanking={fitRanking}
          // Player search only for sessions opened with no partner — once one
          // exists the roster panel/sheet is the add surface; the picker is
          // pure swap. Captured at open so the first pick doesn't yank it.
          rosters={pickerSearch ? rosters : undefined}
          onSelectPlayer={pickerSearch ? handlePickerPlayer : undefined}
          selectedKeys={dealKeys}
        />
      )}
      {sendModalOpen && (
        <SendNoteModal
          partnerName={teamNick(otherTeams[0]?.name ?? "them")}
          onSend={(note) => handleSendOffer(note)}
          onClose={() => setSendModalOpen(false)}
          sending={sending}
        />
      )}
    </>
  );

  const sendButton = (
    <div onClick={canSend ? () => setSendModalOpen(true) : undefined} style={{ background: canSend ? "#185FA5" : "#C8C3B8", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: canSend ? "3px 3px 0 #1A1A1A" : "none", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 14, cursor: canSend ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.04em", opacity: canSend ? 1 : 0.5 }}>
      {sending ? "Sending…" : "Send offer"}
    </div>
  );

  const toastEl = toast ? (
    <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 120, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A", whiteSpace: "nowrap" }}>
      {toast}
    </div>
  ) : null;

  // Viewport not yet known (first client render) — paint the canvas only.
  if (isMobile === null) {
    return <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6" }} />;
  }

  // ── MOBILE: stacked card + advisor; roster panel as a bottom sheet with a
  // sticky deal summary + live grade chip. Two-team only (no +Add team).
  if (isMobile) {
    const mySendNames = dealAssets.filter(a => a.fromTeamId === myTeamId).map(a => a.name).join(", ");
    const myRecvNames = dealAssets.filter(a => a.toTeamId === myTeamId).map(a => a.name).join(", ");
    const closeSheet = () => setSheetOpen(null);
    return (
      <div style={{ height: "calc(100dvh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {toastEl}
        <div style={{ background: "#F5F0E6", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div onClick={onBack} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer", flexShrink: 0 }}>← Back</div>
            <div style={{ width: 1, height: 14, background: "#C8C3B8", flexShrink: 0 }} />
            <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teams.map(t => teamNick(t.name)).join(" × ")}</span>
          </div>
          <div onClick={openSwapPicker} style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 8px", letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}>Change team</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <DealCard myTeamId={myTeamId} teams={teams} assets={dealAssets} onRemove={removeDealAsset} onReroute={rerouteDealAsset} onAddFromTeam={handleAddFromTeam} threeTeam={false} />
          <AIAdvisor
            grade={advisorGrade}
            gradeColor={advisorGradeColor}
            prose={advisorProse}
            suggestions={advisorSuggestions}
            onTapSuggestion={handleSuggestionTap}
            loading={advisorLoading}
          />
        </div>
        <div style={{ padding: "10px 14px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
          {sendButton}
        </div>

        {sheetOpen && (
          <>
            <div onClick={closeSheet} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.45)", zIndex: 60 }} aria-hidden="true" />
            <div role="dialog" aria-modal="true" style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "82dvh", background: "#FEFCF9", borderTop: "2.5px solid #1A1A1A", zIndex: 61, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Drag handle (visual affordance; overlay tap / Done closes) */}
              <div style={{ padding: "8px 0 4px", display: "flex", justifyContent: "center", flexShrink: 0 }} onClick={closeSheet}>
                <div style={{ width: 44, height: 5, background: "#C8C3B8", borderRadius: 3 }} />
              </div>
              {/* Sticky deal summary + LIVE grade chip — the "am I out of
                  whack" signal while the full card is hidden behind the sheet. */}
              <div style={{ padding: "4px 14px 10px", borderBottom: "2px solid #1A1A1A", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ fontWeight: 700, letterSpacing: "0.06em" }}>SEND</span> {mySendNames || "—"}
                  </div>
                  <div style={{ fontFamily: FM, fontSize: 9, color: "#8C7E6A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                    <span style={{ fontWeight: 700, letterSpacing: "0.06em" }}>GET</span> {myRecvNames || "—"}
                  </div>
                </div>
                {advisorGrade ? (
                  <div style={{ flexShrink: 0 }}>
                    <TradeBalanceChip label={advisorGrade} color={advisorGradeColor} />
                  </div>
                ) : null}
                <div onClick={closeSheet} style={{ flexShrink: 0, fontFamily: FH, fontWeight: 800, fontSize: 11, background: "#185FA5", color: "#FEFCF9", border: "2px solid #1A1A1A", boxShadow: "2px 2px 0 #1A1A1A", padding: "6px 12px", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Done
                </div>
              </div>
              <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
                {rosterSearchInput}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "0 14px", minHeight: 0 }}>
                {rosterListContent}
                <div style={{ height: 12 }} />
              </div>
            </div>
          </>
        )}
        {modals}
      </div>
    );
  }

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toastEl}
      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div onClick={onBack} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back</div>
          <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
          <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>{teams.map(t => teamNick(t.name)).join(" × ")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div onClick={openSwapPicker} style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Change team</div>
          {teams.length < 3 && (
            <div onClick={() => setPickerMode("add")} style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Add team</div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", borderRight: "2px solid #1A1A1A", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <DealCard myTeamId={myTeamId} teams={teams} assets={dealAssets} onRemove={removeDealAsset} onReroute={rerouteDealAsset} onAddFromTeam={handleAddFromTeam} threeTeam={threeTeam} addsLocked />
            <AIAdvisor
              grade={advisorGrade}
              gradeColor={advisorGradeColor}
              prose={advisorProse}
              suggestions={advisorSuggestions}
              onTapSuggestion={handleSuggestionTap}
              loading={advisorLoading}
            />
          </div>
          <div style={{ padding: "12px 20px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
            {sendButton}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "2.5px solid #1A1A1A", flexShrink: 0 }}>
            {teams.map((t, i) => {
              const isThird = i === 2;
              return (
                <div key={t.id} onClick={() => { setActiveTab(t.id); setRosterSearch(""); }} style={{ flex: 1, padding: "10px 4px", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: tabFontSize, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", background: activeTab === t.id ? "#1A1A1A" : "#FEFCF9", color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A", borderRight: i < teams.length - 1 ? "1px solid " + (activeTab === t.id ? "#FEFCF9" : "#C8C3B8") : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <span>{teamNick(t.name)}</span>
                  {isThird && (
                    <span onClick={e => { e.stopPropagation(); handleRemoveThirdTeam(); }} style={{ fontSize: 11, fontWeight: 800, color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A", cursor: "pointer", padding: "0 2px" }} title="Remove third team">✕</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
            {rosterSearchInput}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px", minHeight: 0 }}>
            {rosterListContent}
            <div style={{ height: 12 }} />
          </div>
        </div>
      </div>
      {modals}
    </div>
  );
}