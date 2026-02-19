"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatDraftPickLabel,
  logDraftPickDistribution,
  withComputedDraftPicks,
  deriveDraftOrderForSeason,
  PICK_SLOT_SEASON,
  DRAFT_ORDER_UNAVAILABLE_MESSAGE,
  type DraftPick,
  type SleeperDraft,
  type TradedPick,
} from "../../../lib/picks";
import { getLeagueId } from "../../../lib/config";
import {
  buildLeagueProfiles,
  type TeamProfile as TradeProfile,
} from "../../../lib/trade/profile";
import { getPickValue, getPlayerValue } from "../../../lib/trade/value";
import {
  computeLeagueRankings,
  rankBandLabel,
  type MetricKey,
  type TeamRanking,
} from "../../../lib/leagueRankings";

interface Team {
  id: number;
  name: string;
  ownerId?: string | null;
}

interface League {
  draft_order?: Record<string, number>;
  roster_positions?: string[];
}

interface Roster {
  roster_id: number;
  owner_id: string | null;
  starters?: (string | number | null)[];
  players?: (string | number | null)[];
  draft_picks?: DraftPick[];
}

type RosterPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  ageLabel: string;
  value: number;
};

interface UserMetadata {
  team_name?: string;
}

interface SleeperUser {
  user_id: string;
  display_name?: string;
  metadata?: UserMetadata;
}

interface SleeperPlayer {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string;
  status?: string;
  birth_date?: string;
  age?: number;
}

interface TradeAsset {
  id: string;
  label: string;
  type: "player" | "pick";
}

type FairnessGrade = "Fair" | "Slight Overpay" | "Overpay" | "Slight Underpay" | "Underpay";

interface OfferAssetDetail {
  id: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
  isUnvalued?: boolean;
  rosterId?: number;
}

interface OfferSuggestion {
  id: string;
  partnerId: number | string;
  partner: string;
  send: OfferAssetDetail[];
  receive: OfferAssetDetail[];
  tags: string[];
  fairness: FairnessGrade;
  explanation: string;
  valueSent: number;
  valueReceived: number;
}

const DEMO_TEAM_ID = 0;
const DEMO_TEAMS: Team[] = [{ id: DEMO_TEAM_ID, name: "Demo Team" }];
const DEMO_ROSTERS: Roster[] = [
  { roster_id: DEMO_TEAM_ID, owner_id: null, starters: [], players: [], draft_picks: [] },
];
const DEMO_ROSTER_POSITIONS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPERFLEX", "BN", "BN", "BN", "BN", "BN"];
const PLAYER_CACHE_KEY = "sleeper_player_dict";
const PLAYER_CACHE_TIME_KEY = "sleeper_player_dict_time";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_CACHE_KEY = "trade_studio_availability";
const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
const SNAPSHOT_FOOTER_PADDING_CLASS = "pb-24";
let playerDictCache: Record<string, SleeperPlayer> | null = null;
let offerIdCounter = 0;

type TimelineLane = "Contend" | "Re-tool" | "Rebuild";
type Posture = "Buyer" | "Seller";
type WorkbenchTabKey = "trade-block" | "incoming" | "chat";
type TradeStudioMode = "studio" | "snapshot";

const YOUNG_PLAYER_AGE_THRESHOLD = 25;
const VETERAN_PLAYER_AGE_THRESHOLD = 29;
const REBUILD_YOUNG_ADVANTAGE = 2;
const REBUILD_PICK_THRESHOLD = 3;
const CONTEND_NEAR_TERM_PICK_MAX = 2;
const BUYER_PICK_THRESHOLD = 1;
const QB_VALUE_MULTIPLIER = 1.25;
const TE_VALUE_MULTIPLIER = 0.75;
const STUD_PLAYER_THRESHOLD = 9000;

interface AiProfileContext {
  topPosition?: string;
  needPosition?: string;
  primaryPickSeason?: string;
  nearTermPicks: number;
  totalPicks: number;
  strengthBand?: string;
  gapBand?: string;
}

interface AiProfile {
  summary: string;
  strengths: string[];
  risks: string[];
  recommendedTimeline: TimelineLane;
  recommendedPosture: Posture;
  primaryPlan: string;
  context: AiProfileContext;
}

const toId = (value: string | number | null | undefined) =>
  value !== undefined && value !== null ? String(value) : "";

const getStoredSessionSelection = () => {
  if (typeof window === "undefined") return { rosterId: "", sessionId: "", teamName: "" };
  try {
    const saved = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!saved) return { rosterId: "", sessionId: "", teamName: "" };
    const parsed = JSON.parse(saved);
    return {
      rosterId: toId(parsed?.rosterId),
      sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : "",
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : "",
    };
  } catch {
    return { rosterId: "", sessionId: "", teamName: "" };
  }
};

const getStoredSelectedTeam = () => getStoredSessionSelection().rosterId;

const computeAge = (player: SleeperPlayer) => {
  if (typeof player.age === "number") return player.age;
  if (player.birth_date) {
    const birthDate = new Date(player.birth_date);
    if (!Number.isNaN(birthDate.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birthDate.getFullYear();
      const hadBirthday =
        now.getMonth() > birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
      if (!hadBirthday) age -= 1;
      return age;
    }
  }
  return null;
};

const availabilityKeyForPlayer = (playerId: string) => `player:${playerId}`;
const availabilityKeyForPick = (pick: DraftPick) =>
  `pick:${pick.season || "future"}-${pick.round || "r"}-${pick.pick_no || "p"}-${
    pick.roster_id || pick.original_roster_id || "roster"
  }`;

const isBenchSlot = (slot: string) => {
  const normalized = slot.trim().toUpperCase();
  return normalized === "BN" || normalized === "BENCH";
};

const normalizePickSlot = (pickNo: number | undefined, teamCount: number) => {
  const teams = Math.max(teamCount, 1);
  if (!pickNo || pickNo <= 0) return undefined;
  if (pickNo > teams) return ((pickNo - 1) % teams) + 1;
  return pickNo;
};

const shortPickLabel = (pick: DraftPick, teamCount: number) => {
  const slot = normalizePickSlot(pick.pick_no, Math.max(teamCount, 1));
  const slotLabel =
    pick.round && slot
      ? `${pick.round}.${String(slot).padStart(2, "0")}`
      : pick.round
        ? `${pick.round}.--`
        : "pick";
  return `${pick.season ?? "Future"} ${slotLabel}`;
};

const fairnessFromValues = (sent: number, received: number): FairnessGrade => {
  if (sent <= 0 || received <= 0) return "Fair";
  const ratio = received / sent;
  if (ratio > 1.02) return "Slight Underpay";
  if (ratio < 0.98) return "Slight Overpay";
  return "Fair";
};

const fairnessStyles: Record<FairnessGrade, string> = {
  Fair: "border-emerald-600/60 bg-emerald-900 text-emerald-100",
  "Slight Overpay": "border-amber-600/60 bg-amber-900 text-amber-100",
  Overpay: "border-red-700/60 bg-red-900 text-red-100",
  "Slight Underpay": "border-sky-700/60 bg-sky-900 text-sky-100",
  Underpay: "border-gray-700 bg-gray-900 text-gray-100",
};

const isOfferWithinBounds = (giveValue: number, receiveAssets: OfferAssetDetail[]) => {
  if (giveValue <= 0) return false;
  const receiveValue = receiveAssets.reduce((sum, asset) => sum + asset.value, 0);
  const ratio = receiveValue / giveValue;
  if (ratio < 0.9 || ratio > 1.1) return false;
  if (Math.abs(receiveValue - giveValue) > Math.max(300, giveValue * 0.1)) return false;
  const largest = receiveAssets.reduce((max, asset) => Math.max(max, asset.value), 0);
  if (giveValue < 500 && largest > giveValue * 3) return false;
  return true;
};

const collectRosterAssets = (
  roster: Roster,
  teamCount: number,
  playerDictionary: Record<string, SleeperPlayer>,
  playerValues: Record<string, number>
) => {
  const players: OfferAssetDetail[] = [];
  const picks: OfferAssetDetail[] = [];

  (roster.players ?? []).forEach((player) => {
    const playerId = toId(player);
    if (!playerId) return;
    const info = playerDictionary[playerId];
    const age = info ? computeAge(info) : null;
    const value = getPlayerValue(playerId, playerValues);
    const position =
      info?.position?.toUpperCase() ||
      info?.fantasy_positions?.[0]?.toUpperCase() ||
      undefined;
    const adjustedValue =
      position === "QB" && typeof value === "number"
        ? value * QB_VALUE_MULTIPLIER
        : position === "TE" && typeof value === "number"
          ? value * TE_VALUE_MULTIPLIER
          : value ?? 0;
    const labelParts = [
      info?.full_name ||
        [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() ||
        playerId,
      position,
      info?.team || "FA",
      age ? `${age}` : "–",
    ];

    players.push({
      id: availabilityKeyForPlayer(playerId),
      label: `${labelParts[0]} (${labelParts[1]} • ${labelParts[2]} • ${labelParts[3]})`,
      type: "player",
      position,
      team: info?.team || "FA",
      ageLabel: age ? String(age) : "–",
      value: adjustedValue,
      isUnvalued: value == null,
      rosterId: roster.roster_id,
    });
  });

  (roster.draft_picks ?? []).forEach((pick) => {
    const value = getPickValue(pick, { teamCount });
    picks.push({
      id: availabilityKeyForPick(pick),
      label: shortPickLabel(pick, teamCount),
      type: "pick",
      value,
      rosterId: roster.roster_id,
    });
  });

  return { players, picks };
};

const tagLabelForPosition = (position?: string) => {
  if (!position) return null;
  return `${position} need match`;
};

const buildOfferTags = (
  sendAssets: OfferAssetDetail[],
  receiveAssets: OfferAssetDetail[],
  userProfile?: TradeProfile,
  partnerProfile?: TradeProfile
) => {
  const tags = new Set<string>();
  const sendPositions = sendAssets.map((asset) => asset.position).filter(Boolean) as string[];
  const receivePositions = receiveAssets.map((asset) => asset.position).filter(Boolean) as string[];

  sendPositions.forEach((pos) => {
    const tag = tagLabelForPosition(pos);
    if (tag) tags.add(tag);
  });
  receivePositions.forEach((pos) => tags.add(`Adds ${pos} help`));
  if (userProfile?.mode === "rebuild" && partnerProfile?.mode === "contend") {
    tags.add("Rebuild fit");
  }
  if (userProfile?.posture === "buyer" && partnerProfile?.posture === "seller") {
    tags.add("Buyer/Seller match");
  }
  if (userProfile?.posture === "seller" && partnerProfile?.posture === "buyer") {
    tags.add("Seller/Buyer balance");
  }
  if (tags.size === 0 && userProfile?.needs?.length) {
    tags.add(userProfile.needs[0]);
  }
  return Array.from(tags);
};

const explanationForOffer = (
  teamName: string,
  partnerName: string,
  fairness: FairnessGrade,
  sendAssets: OfferAssetDetail[],
  receiveAssets: OfferAssetDetail[],
  userProfile?: TradeProfile,
  partnerProfile?: TradeProfile
) => {
  const sendFocus =
    sendAssets.find((asset) => asset.position)?.position ??
    (sendAssets[0]?.type === "pick" ? "future picks" : "depth");
  const receiveFocus =
    receiveAssets.find((asset) => asset.position)?.position ??
    (receiveAssets[0]?.type === "pick" ? "draft capital" : "help");
  const partnerMode = partnerProfile?.mode ?? "contend";
  const userMode = userProfile?.mode ?? "retool";
  return `${partnerName} gets ${sendFocus} to support a ${partnerMode} push; ${teamName} gains ${receiveFocus} for a ${userMode} path (${fairness.toLowerCase()}).`;
};

interface PickAssetContext {
  sendPositions: string[];
  isStudTrade: boolean;
  studPosition?: string;
  qbProtectionNeeded: boolean;
  teamValueTier: "low" | "mid" | "high";
  sendIncludesPicks: boolean;
}

const pickAssetsForPartner = (
  giveValue: number,
  aggression: number,
  userNeeds: string[],
  partnerAssets: { players: OfferAssetDetail[]; picks: OfferAssetDetail[] },
  pickContext?: PickAssetContext
) => {
  if (giveValue <= 0) return [];
  const targetMultiplier = 1 + (aggression - 50) / 200;
  const targetValue = giveValue * targetMultiplier;
  const maxSingleValue = giveValue * 1.2;
  const normalizedNeeds = userNeeds.map((need) => {
    if (need.toLowerCase().includes("qb")) return "QB";
    if (need.toLowerCase().includes("rb")) return "RB";
    if (need.toLowerCase().includes("wr")) return "WR";
    if (need.toLowerCase().includes("te")) return "TE";
    return need;
  });

  // Augment needs based on trade context
  if (pickContext?.qbProtectionNeeded && !normalizedNeeds.includes("QB")) {
    normalizedNeeds.unshift("QB");
  }
  if (pickContext?.sendIncludesPicks && pickContext.sendPositions.length > 0) {
    const upgradePos = pickContext.sendPositions[0];
    if (upgradePos && !normalizedNeeds.includes(upgradePos)) {
      normalizedNeeds.unshift(upgradePos);
    }
  }
  if (pickContext?.isStudTrade && pickContext.studPosition && !normalizedNeeds.includes(pickContext.studPosition)) {
    normalizedNeeds.unshift(pickContext.studPosition);
  }

  const preferredPlayers = partnerAssets.players
    .filter(
      (player) =>
        player.value > 0 &&
        player.value <= maxSingleValue &&
        normalizedNeeds.some((need) => player.position === need)
    )
    .sort((a, b) => b.value - a.value);
  const preferredIds = new Set(preferredPlayers.map((p) => p.id));
  const otherPlayers = partnerAssets.players
    .filter(
      (player) =>
        !preferredIds.has(player.id) && player.value > 0 && player.value <= maxSingleValue
    )
    .sort((a, b) => b.value - a.value);
  const picks = [...partnerAssets.picks]
    .filter((pick) => pick.value > 0 && pick.value <= maxSingleValue)
    .sort((a, b) => b.value - a.value);

  const candidates = [...preferredPlayers, ...picks, ...otherPlayers].slice(0, 12);
  const combos: OfferAssetDetail[][] = [];
  candidates.forEach((candidate) => combos.push([candidate]));
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < Math.min(candidates.length, 8); j += 1) {
      combos.push([candidates[i], candidates[j]]);
    }
  }

  const scoreCombo = (combo: OfferAssetDetail[]): number => {
    if (!pickContext) return 0;
    let score = 0;

    // QB Protection: strongly prefer combos with a QB when protection is needed
    if (pickContext.qbProtectionNeeded) {
      if (combo.some((a) => a.position === "QB" && a.value > 0)) score += 1000;
    }

    // Stud trade: prefer slight downgrade at same position + depth or picks
    if (pickContext.isStudTrade && pickContext.studPosition) {
      const samePos = combo.filter((a) => a.position === pickContext.studPosition);
      const pickPieces = combo.filter((a) => a.type === "pick");
      const otherPos = combo.filter(
        (a) => a.type === "player" && a.position !== pickContext.studPosition
      );
      if (samePos.length > 0 && otherPos.length > 0) score += 200;
      if (samePos.length > 0 && pickPieces.length > 0) score += 200;
    }

    // Position upgrade: if sending player + picks, prefer single upgrade at same position
    if (pickContext.sendIncludesPicks && pickContext.sendPositions.length > 0) {
      const mainPos = pickContext.sendPositions[0];
      if (combo.length === 1 && combo[0].position === mainPos) score += 150;
    }

    // Team value tier preferences
    if (pickContext.teamValueTier === "low") {
      combo.forEach((a) => {
        if (a.type === "pick") score += 50;
        const age = a.ageLabel ? parseInt(a.ageLabel, 10) : null;
        if (age !== null && age <= YOUNG_PLAYER_AGE_THRESHOLD) score += 30;
      });
    } else if (pickContext.teamValueTier === "high") {
      combo.forEach((a) => {
        if (a.type === "player" && a.value >= 3000) score += 40;
      });
    }

    return score;
  };

  let best: OfferAssetDetail[] = [];
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestScore = -1;
  const considerCombo = (combo: OfferAssetDetail[]) => {
    if (!isOfferWithinBounds(giveValue, combo)) return;
    const comboValue = combo.reduce((sum, asset) => sum + asset.value, 0);
    const diff = Math.abs(comboValue - targetValue);
    const comboScore = scoreCombo(combo);
    if (
      comboScore > bestScore ||
      (comboScore === bestScore && diff < bestDiff) ||
      (comboScore === bestScore && diff === bestDiff && combo.length < best.length)
    ) {
      best = combo;
      bestDiff = diff;
      bestScore = comboScore;
    }
  };

  combos.forEach(considerCombo);

  if (!best.length) {
    for (let i = 0; i < Math.min(candidates.length, 6); i += 1) {
      for (let j = i + 1; j < Math.min(candidates.length, 8); j += 1) {
        for (let k = j + 1; k < Math.min(candidates.length, 10); k += 1) {
          considerCombo([candidates[i], candidates[j], candidates[k]]);
        }
      }
    }
  }

  return best;
};

const buildOfferSuggestions = (
  tradeBlock: TradeAsset[],
  context: {
    rosters: Roster[];
    rosterNames: Record<number, string>;
    playerDictionary: Record<string, SleeperPlayer>;
    playerValues: Record<string, number>;
    selectedTeam: string;
    teamCount: number;
    profiles?: Record<string | number, TradeProfile>;
    aggression: number;
  }
): OfferSuggestion[] => {
  if (!context.selectedTeam) return [];

  const rosterAssets = new Map<number, { players: OfferAssetDetail[]; picks: OfferAssetDetail[] }>();
  const assetLookup = new Map<string, OfferAssetDetail>();

  context.rosters.forEach((roster) => {
    const assets = collectRosterAssets(
      roster,
      context.teamCount,
      context.playerDictionary,
      context.playerValues
    );
    rosterAssets.set(roster.roster_id, assets);
    [...assets.players, ...assets.picks].forEach((asset) => assetLookup.set(asset.id, asset));
  });

  const selectedRosterId = Number(context.selectedTeam);
  const userAssets = tradeBlock.map((asset) => {
    const resolved = assetLookup.get(asset.id);
    if (resolved) return resolved;
    return {
      id: asset.id,
      label: asset.label,
      type: asset.type,
      value: 0,
      isUnvalued: asset.type === "player",
    } as OfferAssetDetail;
  });

  const fallbackUserAssets =
    rosterAssets.get(selectedRosterId)?.players
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 2) ?? [];

  const sendAssets = userAssets.length ? userAssets : fallbackUserAssets;
  const valueSent = sendAssets.reduce((sum, asset) => sum + asset.value, 0);
  if (valueSent <= 0) return [];
  const userProfile = context.profiles?.[context.selectedTeam] ?? context.profiles?.[selectedRosterId];
  const userNeeds = userProfile?.needs ?? [];

  // --- Context-aware trade analysis ---
  const sendPlayers = sendAssets.filter((a) => a.type === "player");
  const sendPicks = sendAssets.filter((a) => a.type === "pick");
  const sendPositions = sendPlayers.map((a) => a.position).filter(Boolean) as string[];
  const sendIncludesPicks = sendPicks.length > 0;

  // Stud detection (player with value > 9,000)
  const studPlayer = sendPlayers.find((p) => p.value >= STUD_PLAYER_THRESHOLD);
  const isStudTrade = !!studPlayer;
  const studPosition = studPlayer?.position;

  // QB protection: if sending a QB and team has ≤ 2 valuable QBs
  const userRosterAssets = rosterAssets.get(selectedRosterId);
  const userQBCount = (userRosterAssets?.players ?? []).filter(
    (p) => p.position === "QB" && p.value > 0
  ).length;
  const sendingQB = sendPositions.includes("QB");
  const qbProtectionNeeded = sendingQB && userQBCount <= 2;

  // Team competitive value tier (starting lineup + best 3 bench)
  const teamCompValues = context.rosters.map((roster) => {
    const assets = rosterAssets.get(roster.roster_id);
    if (!assets) return { rosterId: roster.roster_id, value: 0 };
    const starterIds = new Set(
      (roster.starters ?? [])
        .map((s) => availabilityKeyForPlayer(toId(s)))
        .filter((id) => id !== "player:")
    );
    const starterValue = assets.players
      .filter((p) => starterIds.has(p.id))
      .reduce((sum, p) => sum + p.value, 0);
    const benchValue = assets.players
      .filter((p) => !starterIds.has(p.id))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .reduce((sum, p) => sum + p.value, 0);
    return { rosterId: roster.roster_id, value: starterValue + benchValue };
  });
  teamCompValues.sort((a, b) => b.value - a.value);
  const userCompRank =
    teamCompValues.findIndex((t) => t.rosterId === selectedRosterId) + 1;
  const tierSize = Math.max(1, Math.ceil(teamCompValues.length / 3));
  const teamValueTier: "low" | "mid" | "high" =
    userCompRank <= tierSize
      ? "high"
      : userCompRank > teamCompValues.length - tierSize
        ? "low"
        : "mid";

  const pickCtx: PickAssetContext = {
    sendPositions,
    isStudTrade,
    studPosition,
    qbProtectionNeeded,
    teamValueTier,
    sendIncludesPicks,
  };

  const partners = context.rosters
    .filter((roster) => toId(roster.roster_id) !== context.selectedTeam)
    .map((roster) => {
      const profile = context.profiles?.[roster.roster_id];
      let score = 0;
      // Prioritize Buyer posture teams regardless of user posture
      if (profile?.posture === "buyer") score += 3;
      if (profile?.posture === "buyer" && userProfile?.posture === "seller") score += 2;
      if (profile?.mode === "contend" && userProfile?.mode === "rebuild") score += 3;
      if (profile?.mode === "retool") score += 1;
      return { roster, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const offers: OfferSuggestion[] = [];
  const allowedFairness = new Set<FairnessGrade>(["Fair", "Slight Overpay", "Slight Underpay"]);

  partners.forEach(({ roster }) => {
    const partnerAssets = rosterAssets.get(roster.roster_id);
    if (!partnerAssets) return;
    const chosenReceive = pickAssetsForPartner(valueSent, context.aggression, userNeeds, partnerAssets, pickCtx);
    if (!chosenReceive.length) return;
    const valueReceived = chosenReceive.reduce((sum, asset) => sum + asset.value, 0);
    if (!isOfferWithinBounds(valueSent, chosenReceive)) return;
    const fairness = fairnessFromValues(valueSent, valueReceived);
    if (!allowedFairness.has(fairness)) return;
    const partnerName = context.rosterNames[roster.roster_id] || `Roster ${roster.roster_id}`;
    const tags = buildOfferTags(sendAssets, chosenReceive, userProfile, context.profiles?.[roster.roster_id]);
    const explanation = explanationForOffer(
      context.rosterNames[selectedRosterId] || "Your team",
      partnerName,
      fairness,
      sendAssets,
      chosenReceive,
      userProfile,
      context.profiles?.[roster.roster_id]
    );

    offers.push({
      id: `offer-${Date.now()}-${offerIdCounter++}-${roster.roster_id}`,
      partnerId: roster.roster_id,
      partner: partnerName,
      send: sendAssets,
      receive: chosenReceive,
      tags,
      fairness,
      explanation,
      valueSent: Math.round(valueSent),
      valueReceived: Math.round(valueReceived),
    });
  });

  return offers;
};

const parseAgeFromLabel = (ageLabel: string) => {
  if (!ageLabel || !ageLabel.trim()) return null;
  const parsed = parseInt(ageLabel, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildPrimaryPlan = (timeline: TimelineLane, posture: Posture, ctx: AiProfileContext) => {
  const targetNeed = ctx.needPosition || "priority needs";
  const startableNeed =
    targetNeed.toLowerCase().includes("upgrade") || targetNeed.toLowerCase().includes("flex")
      ? targetNeed
      : `startable ${targetNeed}`;
  const coreStrength = ctx.topPosition || "core group";
  const seasonLabel = ctx.primaryPickSeason || PICK_SLOT_SEASON;
  const capitalPhrase =
    ctx.nearTermPicks > 0
      ? `${ctx.nearTermPicks} pick${ctx.nearTermPicks === 1 ? "" : "s"} in ${seasonLabel}`
      : "limited near-term picks";
  const strengthBand = ctx.strengthBand ? `${ctx.strengthBand} ${coreStrength}` : coreStrength;
  const gapBand = ctx.gapBand ? `${ctx.gapBand.toLowerCase()} ${targetNeed}` : targetNeed;

  if (timeline === "Contend" && posture === "Buyer") {
    return `Lean on ${strengthBand}; use ${capitalPhrase} to land a ${startableNeed} (${gapBand}).`;
  }
  if (timeline === "Contend") {
    return `Trim fringe pieces, hold ${capitalPhrase}, and stream upgrades at ${targetNeed} (${gapBand}) to keep the ${coreStrength} stable.`;
  }
  if (timeline === "Rebuild") {
    const rebuildCapital =
      ctx.nearTermPicks > 0 ? capitalPhrase : "future picks and upside darts";
    return `Move veterans for ${rebuildCapital} and build around young ${strengthBand} while stockpiling future shots.`;
  }
  if (posture === "Seller") {
    return `Flip aging contributors for picks, then re-route surplus ${strengthBand} toward ${targetNeed} (${gapBand}).`;
  }
  return `Use ${capitalPhrase} to balance ${targetNeed} (${gapBand}) while protecting the ${strengthBand} you already have.`;
};

const metricLabels: Record<MetricKey, string> = {
  startingQBs: "Starting QB tandem",
  startingRBs: "RB starters",
  startingWRs: "WR starters",
  remainingStarters: "Flex core",
  qbDepth: "QB depth",
  skillDepth: "Skill depth",
};
const DEFAULT_STRENGTH_BAND = "solid";
const DEFAULT_GAP_BAND = "behind the pack";
const pluralize = (count: number, singular: string, plural?: string) =>
  `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
const MAX_RANK_FALLBACK = 999;

const getTopRankedMetric = (ranks: Record<MetricKey, number> | undefined, order: MetricKey[]) => {
  if (!ranks) return undefined;
  const sorted = [...order].sort((a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK));
  return sorted[0];
};

const getWorstRankedMetric = (ranks: Record<MetricKey, number> | undefined, order: MetricKey[]) => {
  if (!ranks) return undefined;
  const sorted = [...order].sort((a, b) => (ranks[b] ?? MAX_RANK_FALLBACK) - (ranks[a] ?? MAX_RANK_FALLBACK));
  return sorted[0];
};

const buildAiProfile = (
  teamName: string,
  players: { position: string; ageLabel: string; value: number }[],
  picks: DraftPick[],
  options?: { teStartableThreshold?: number; teamRanking?: TeamRanking; teamCount?: number }
): AiProfile => {
  const fallbackSummary = `${teamName} profile will refresh as roster data loads.`;
  if (!players.length && !picks.length) {
    return {
      summary: fallbackSummary,
      strengths: ["Flexible starting point", "Clean slate for trades", "No bad contracts"],
      risks: ["Need roster data", "Draft board unsettled", "Awaiting Sleeper sync"],
      recommendedTimeline: "Re-tool",
      recommendedPosture: "Buyer",
      primaryPlan: buildPrimaryPlan("Re-tool", "Buyer", {
        nearTermPicks: 0,
        totalPicks: 0,
      }),
      context: {
        nearTermPicks: 0,
        totalPicks: 0,
      },
    };
  }

  // Limits mirror typical startable cores (QB2/RB3/WR4) with TE treated separately (flex-oriented).
  const positionLimits: Record<string, number> = { QB: 2, RB: 3, WR: 4, TE: 1 };
  const teStartableThreshold = options?.teStartableThreshold ?? 0;
  const teamRanking = options?.teamRanking;
  const teamCount = options?.teamCount ?? 0;
  const bandTeamCount = teamCount || 12;
  const strongRankThreshold = Math.min(4, Math.max(2, Math.ceil(bandTeamCount / 3)));
  const weakRankThreshold = Math.max(bandTeamCount - 3, Math.ceil((bandTeamCount * 2) / 3));

  const positionValues: Record<string, number[]> = Object.fromEntries(
    Object.keys(positionLimits).map((pos) => [pos, [] as number[]])
  );

  players.forEach((p) => {
    const position = p.position?.toUpperCase();
    if (!position || !positionValues[position]) return;
    const adjustedValue = position === "QB" ? p.value * QB_VALUE_MULTIPLIER : position === "TE" ? p.value * TE_VALUE_MULTIPLIER : p.value;
    positionValues[position]?.push(adjustedValue);
  });

  const positionStrengths: Record<string, number> = {};
  Object.entries(positionLimits).forEach(([position, limit]) => {
    const values = [...(positionValues[position] ?? [])].sort((a, b) => b - a);
    const capped = values.slice(0, limit);
    positionStrengths[position] = capped.reduce((sum, value) => sum + value, 0);
  });

  const strengthOrdered = Object.entries(positionStrengths).sort(([, a], [, b]) => b - a);
  const topPosition = strengthOrdered.find(([, strength]) => strength > 0)?.[0];

  // TE excluded from corePositions because it's discounted and often a flex-only upgrade.
  const corePositions: Array<"QB" | "RB" | "WR"> = ["QB", "RB", "WR"];
  const coreStrengths = corePositions
    .map((pos) => [pos, positionStrengths[pos] ?? 0] as const)
    .sort(([, a], [, b]) => a - b);
  const needPosition = coreStrengths[0]?.[0];

  const teValues = [...(positionValues.TE ?? [])].sort((a, b) => b - a);
  const topTeValue = teValues[0] ?? 0;
  const needsTeFlexUpgrade =
    teStartableThreshold > 0 &&
    topTeValue < teStartableThreshold &&
    (positionStrengths.RB > 0 || positionStrengths.WR > 0);

  const ages = players
    .map((p) => parseAgeFromLabel(p.ageLabel))
    .filter((age): age is number => age != null);
  const youngCount = ages.filter((age) => age <= YOUNG_PLAYER_AGE_THRESHOLD).length;
  const veteranCount = ages.filter((age) => age >= VETERAN_PLAYER_AGE_THRESHOLD).length;

  const picksBySeason = picks.reduce<Record<string, number>>((acc, pick) => {
    const season = pick.season ?? "Future";
    acc[season] = (acc[season] ?? 0) + 1;
    return acc;
  }, {});
  const totalPicks = picks.length;
  const nearTermPicks = picksBySeason[PICK_SLOT_SEASON] ?? 0;
  const primaryPickSeason =
    nearTermPicks > 0
      ? PICK_SLOT_SEASON
      : Object.keys(picksBySeason).sort((a, b) => a.localeCompare(b))[0] ?? "Future";

  let recommendedTimeline: TimelineLane = "Re-tool";
  if (youngCount >= veteranCount + REBUILD_YOUNG_ADVANTAGE && totalPicks >= REBUILD_PICK_THRESHOLD) {
    recommendedTimeline = "Rebuild";
  } else if (veteranCount >= youngCount && nearTermPicks <= CONTEND_NEAR_TERM_PICK_MAX) {
    recommendedTimeline = "Contend";
  }

  let recommendedPosture: Posture = "Buyer";
  if (recommendedTimeline === "Rebuild") {
    recommendedPosture = "Seller";
  } else if (recommendedTimeline === "Contend" && totalPicks <= BUYER_PICK_THRESHOLD) {
    recommendedPosture = "Buyer";
  } else if (recommendedTimeline === "Contend") {
    recommendedPosture = "Buyer";
  } else if (recommendedTimeline === "Re-tool") {
    recommendedPosture = veteranCount > youngCount ? "Seller" : "Buyer";
  }

  const coreMetricOrder: MetricKey[] = ["startingQBs", "startingRBs", "startingWRs", "remainingStarters"];
  const depthMetricOrder: MetricKey[] = ["skillDepth", "qbDepth"];

  const bestMetric = getTopRankedMetric(teamRanking?.ranks, [...coreMetricOrder, ...depthMetricOrder]);
  const weakestMetric = getWorstRankedMetric(teamRanking?.ranks, coreMetricOrder);

  const bestLabel = bestMetric ? metricLabels[bestMetric] : topPosition ? `${topPosition} core` : "Core group";
  const bestBand = bestMetric ? rankBandLabel(teamRanking?.ranks?.[bestMetric], bandTeamCount) : null;
  const gapLabel = weakestMetric ? metricLabels[weakestMetric] : needPosition ? `${needPosition} starters` : "priority need";
  const gapBand = weakestMetric ? rankBandLabel(teamRanking?.ranks?.[weakestMetric], bandTeamCount) : null;

  const profileSentence = `${teamName} profiles as a ${recommendedTimeline}/${recommendedPosture} team${
    teamCount ? ` in a ${teamCount}-team league` : ""
  }.`;

  const strategyGuidanceSentence = teamRanking?.ranks
    ? `${bestLabel} is ${bestBand || DEFAULT_STRENGTH_BAND}, but ${gapLabel} sits ${gapBand || DEFAULT_GAP_BAND}; ${
        totalPicks > 0
          ? `use ${pluralize(totalPicks, "pick")} to balance it.`
          : `leverage roster depth to shore it up.`
      }`
    : topPosition
      ? `${topPosition} value leads the way; ${
          totalPicks > 0
            ? `deploy ${pluralize(totalPicks, "pick")} to smooth gaps.`
            : "leverage depth to smooth gaps."
        }`
      : "Roster data is loading.";

  const summary = `${profileSentence} ${strategyGuidanceSentence}`;

  const formatStrength = (metric: MetricKey, rank?: number) => {
    const band = rankBandLabel(rank, bandTeamCount);
    if (metric === "skillDepth") {
      return `Strong ${metricLabels[metric].toLowerCase()} (${band}) gives you trade leverage.`;
    }
    if (metric === "qbDepth") {
      return `QB3/4 depth is ${band} — helpful insurance during byes.`;
    }
    return `${metricLabels[metric]} is ${band} in the league.`;
  };

  const formatRisk = (metric: MetricKey, rank?: number) => {
    const band = rankBandLabel(rank, bandTeamCount);
    if (metric === "qbDepth") {
      return `QB depth is ${band}; add a reliable QB3 to stabilize.`;
    }
    if (metric === "skillDepth") {
      return `Depth behind starters is ${band}; consolidate fringe pieces for sturdier options.`;
    }
    return `${metricLabels[metric]} is ${band} — clear upgrade path.`;
  };

  const pickStrengths = () => {
    if (!teamRanking?.ranks) {
      return [
        topPosition ? `${topPosition} value leads the roster.` : "Balanced positional value mix.",
        youngCount > 0
          ? `Youth movement: ${youngCount} player${youngCount === 1 ? "" : "s"} age 25 or younger`
          : "Veteran stability across the lineup",
        totalPicks > 0
          ? `Draft ammo: ${totalPicks} pick${totalPicks === 1 ? "" : "s"} to deploy`
          : "Clear runway to pursue trades without pick constraints",
      ];
    }

    const ranks = teamRanking.ranks;
    const strongCore = coreMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) <= strongRankThreshold)
      .sort((a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK));
    const strongDepth = depthMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) <= strongRankThreshold)
      .sort((a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK));
    const fillPool = [...coreMetricOrder, ...depthMetricOrder].sort(
      (a, b) => (ranks[a] ?? MAX_RANK_FALLBACK) - (ranks[b] ?? MAX_RANK_FALLBACK)
    );

    const picks: MetricKey[] = [];
    strongCore.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    strongDepth.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    fillPool.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });

    return picks.slice(0, 3).map((m) => formatStrength(m, ranks[m]));
  };

  const pickRisks = () => {
    if (!teamRanking?.ranks) {
      const baseRisks: string[] = [];
      baseRisks.push(
        veteranCount > 0
          ? `Aging core: ${veteranCount} veteran${veteranCount === 1 ? "" : "s"} 29+ need an exit plan`
          : "Unproven core still needs reliable producers"
      );
      if (needsTeFlexUpgrade) {
        baseRisks.push(
          `Flex TE upgrade: no TE above startable threshold (~${Math.round(teStartableThreshold)})`
        );
      }
      baseRisks.push(
        nearTermPicks > 0
          ? `${nearTermPicks} pick${nearTermPicks === 1 ? "" : "s"} in ${PICK_SLOT_SEASON} are the main leverage points`
          : "Limited near-term picks may slow a pivot"
      );
      return baseRisks.slice(0, 3);
    }

    const ranks = teamRanking.ranks;
    const weakCore = coreMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) >= weakRankThreshold)
      .sort((a, b) => (ranks[b] ?? MAX_RANK_FALLBACK) - (ranks[a] ?? MAX_RANK_FALLBACK));
    const weakDepth = depthMetricOrder
      .filter((m) => (ranks[m] ?? MAX_RANK_FALLBACK) >= weakRankThreshold)
      .sort((a, b) => (ranks[b] ?? MAX_RANK_FALLBACK) - (ranks[a] ?? MAX_RANK_FALLBACK));
    const fillPool = [...coreMetricOrder, ...depthMetricOrder].sort(
      (a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0)
    );

    const picks: MetricKey[] = [];
    weakCore.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    weakDepth.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });
    fillPool.forEach((m) => {
      if (picks.length < 3 && !picks.includes(m)) picks.push(m);
    });

    return picks.slice(0, 3).map((m) => formatRisk(m, ranks[m]));
  };

  const strengths = pickStrengths();
  const risks = pickRisks();

  const context: AiProfileContext = {
    topPosition,
    needPosition: needsTeFlexUpgrade ? "flex TE upgrade" : gapLabel,
    primaryPickSeason,
    nearTermPicks,
    totalPicks,
    strengthBand: bestBand || undefined,
    gapBand: gapBand || undefined,
  };

  return {
    summary,
    strengths,
    risks,
    recommendedTimeline,
    recommendedPosture,
    primaryPlan: buildPrimaryPlan(recommendedTimeline, recommendedPosture, context),
    context,
  };
};

export default function TradeStudioPage() {
  return <TradeStudioView mode="studio" />;
}

export function TradeStudioView({ mode = "studio" }: { mode?: TradeStudioMode }) {
  const isSnapshotOnly = mode === "snapshot";
  const pageTitle = isSnapshotOnly ? "Team Snapshot" : "Trade Studio";
  const [teams, setTeams] = useState<Team[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<number, string>>({});
  const [rosterPositions, setRosterPositions] = useState<string[]>([]);
  const [playerDictionary, setPlayerDictionary] = useState<Record<string, SleeperPlayer>>({});
  const [playerValues, setPlayerValues] = useState<Record<string, number>>({});
  const [playerValuesMeta, setPlayerValuesMeta] = useState<{ lastUpdated?: string | null }>({});
  const [selectedTeam, setSelectedTeam] = useState(() => getStoredSelectedTeam());
  const [errorMessage, setErrorMessage] = useState("");
  const [draftOrderAvailable, setDraftOrderAvailable] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [timelineChoice, setTimelineChoice] = useState<TimelineLane>("Re-tool");
  const [postureChoice, setPostureChoice] = useState<Posture>("Buyer");
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTabKey>("trade-block");
  const [offerSuggestions, setOfferSuggestions] = useState<OfferSuggestion[]>([]);
  const [activeOfferIndex, setActiveOfferIndex] = useState(0);
  const [offerAggression, setOfferAggression] = useState(50);
  const lastTeamRef = useRef<string | null>(null);
  const { leagueId, leagueIdError } = useMemo(() => {
    try {
      return { leagueId: getLeagueId(), leagueIdError: "" };
    } catch (error) {
      return {
        leagueId: "",
        leagueIdError:
          error instanceof Error
            ? error.message
            : "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID.",
      };
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(AVAILABILITY_CACHE_KEY);
      if (saved) {
        setAvailability(JSON.parse(saved));
      }
    } catch {
      // ignore corrupted cache
    }
  }, []);

  useEffect(() => {
    if (selectedTeam || typeof window === "undefined") return;
    const stored = getStoredSelectedTeam();
    if (stored) setSelectedTeam(stored);
  }, [selectedTeam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(AVAILABILITY_CACHE_KEY, JSON.stringify(availability));
    } catch {
      // ignore
    }
  }, [availability]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedTeam) {
      sessionStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
      return;
    }

    const team = teams.find((t) => toId(t.id) === selectedTeam);
    if (!team) return;
    const existing = getStoredSessionSelection();

    try {
      sessionStorage.setItem(
        SELECTED_TEAM_CACHE_KEY,
        JSON.stringify({
          rosterId: toId(team.id),
          ownerId: team.ownerId || null,
          teamName: team.name,
          sessionId: existing.sessionId || "",
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [selectedTeam, teams]);

  useEffect(() => {
    let isMounted = true;

    async function fetchSleeperData() {
      const loadDemoData = (message: string) => {
        if (!isMounted) return;
        const demoNameMap = Object.fromEntries(DEMO_TEAMS.map((t) => [t.id, t.name]));
        const demoRosters = withComputedDraftPicks(DEMO_ROSTERS, [], {
          teamCountOverride: DEMO_ROSTERS.length || 1,
        });
        setTeams(DEMO_TEAMS);
        setRosters(demoRosters);
        setRosterPositions(DEMO_ROSTER_POSITIONS);
        setDraftOrderAvailable(false);
        setRosterNames(demoNameMap);
        logDraftPickDistribution(demoRosters, demoNameMap, DEMO_ROSTERS.length || 1);
        setErrorMessage(message);
      };

      if (!leagueId) {
        loadDemoData(
          leagueIdError || "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID."
        );
        return;
      }

      try {
        const [leagueRes, rosterRes, userRes, tradedRes, draftsRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`),
        ]);

        if (!leagueRes.ok || !rosterRes.ok || !userRes.ok || !tradedRes.ok || !draftsRes.ok) {
          throw new Error("Bad response from Sleeper");
        }

        const leagueJson: League = await leagueRes.json();
        const rosterJson: Roster[] = await rosterRes.json();
        const userJson: SleeperUser[] = await userRes.json();
        const tradedJson: TradedPick[] = await tradedRes.json();
        const draftsJson: SleeperDraft[] = await draftsRes.json();

        if (!isMounted) return;

        const rosterOwnerMap: Record<number, string | number | null | undefined> = Object.fromEntries(
          rosterJson.map((roster) => [roster.roster_id, roster.owner_id] as const)
        );
        const mappedTeams: Team[] = rosterJson.map((roster) => {
          const user = roster.owner_id
            ? userJson.find((u) => u.user_id === roster.owner_id)
            : undefined;

          return {
            id: roster.roster_id,
            ownerId: roster.owner_id,
            name:
              user?.metadata?.team_name ||
              user?.display_name ||
              `Roster ${roster.roster_id}`,
          };
        });
        const nameMap = Object.fromEntries(mappedTeams.map((t) => [t.id, t.name]));

        const { draftOrder, available } = deriveDraftOrderForSeason(draftsJson, PICK_SLOT_SEASON);
        // TODO: Remove once draft slot mapping has been verified in production.
        // Temporary debug to verify draft slot mapping against Sleeper Draft Settings.
        console.log(
          `Derived ${PICK_SLOT_SEASON} draft slots (team -> slot):`,
          Object.fromEntries(
            mappedTeams.map((team) => {
              const ownerKey = team.ownerId != null ? String(team.ownerId) : null;
              const rosterKey = String(team.id);
              return [
                team.name,
                ownerKey != null
                  ? draftOrder?.[ownerKey] ?? draftOrder?.[rosterKey]
                  : draftOrder?.[rosterKey],
              ];
            })
          )
        );
        const rostersWithPicks = withComputedDraftPicks(rosterJson, tradedJson, {
          teamCountOverride: rosterJson.length,
          draftOrder: draftOrder ?? leagueJson.draft_order,
          rosterOwnerMap,
        });

        setTeams(mappedTeams);
        setRosterNames(nameMap);
        setRosterPositions(leagueJson.roster_positions || []);
        setRosters(rostersWithPicks);
        setDraftOrderAvailable(available);
        setErrorMessage("");
        logDraftPickDistribution(rostersWithPicks, nameMap, rosterJson.length);
      } catch (error) {
        console.error("Error fetching Sleeper data:", error);
        loadDemoData("Unable to reach Sleeper API. Showing demo data instead.");
      }
    }

    fetchSleeperData();

    return () => {
      isMounted = false;
    };
  }, [leagueId, leagueIdError]);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerDictionary() {
      if (playerDictCache) {
        setPlayerDictionary(playerDictCache);
        return;
      }

      if (typeof window !== "undefined") {
        const cachedDict = localStorage.getItem(PLAYER_CACHE_KEY);
        const cachedTime = localStorage.getItem(PLAYER_CACHE_TIME_KEY);
        const parsedTime = cachedTime ? parseInt(cachedTime, 10) : NaN;
        const isFresh = !Number.isNaN(parsedTime) && Date.now() - parsedTime < CACHE_TTL_MS;
        if (cachedDict && isFresh) {
          try {
            const parsed = JSON.parse(cachedDict);
            playerDictCache = parsed;
            setPlayerDictionary(parsed);
            return;
          } catch {
            // ignore corrupted cache
          }
        }
      }

      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl");
        if (!res.ok) throw new Error("Failed to fetch player dictionary");
        const dict = await res.json();
        if (!isMounted) return;
        playerDictCache = dict;
        setPlayerDictionary(dict);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify(dict));
            localStorage.setItem(PLAYER_CACHE_TIME_KEY, String(Date.now()));
          } catch (storageError) {
            console.warn("Unable to cache player dictionary", storageError);
          }
        }
      } catch (err) {
        console.error("Unable to load player dictionary", err);
      }
    }

    loadPlayerDictionary();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPlayerValues() {
      try {
        const res = await fetch("/api/player-values");
        if (!res.ok) throw new Error("Failed to fetch player values");
        const json = await res.json();
        if (!isMounted) return;
        setPlayerValues(json.data ?? {});
        setPlayerValuesMeta(json.meta ?? {});
      } catch (error) {
        console.warn("Unable to load player values", error);
        if (!isMounted) return;
        setPlayerValues({});
        setPlayerValuesMeta({});
      }
    }

    loadPlayerValues();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeRoster = useMemo(
    () => rosters.find((r) => toId(r.roster_id) === selectedTeam),
    [rosters, selectedTeam]
  );

  const visibleLineupSlots = useMemo(
    () => rosterPositions.filter((slot) => Boolean(slot) && !isBenchSlot(slot)),
    [rosterPositions]
  );

  const startingLineupIds = useMemo(() => {
    const starters = activeRoster?.starters ?? [];
    if (!starters.length) return [];
    if (!visibleLineupSlots.length) {
      return starters.map((starter) => toId(starter)).filter(Boolean);
    }
    return visibleLineupSlots
      .map((_, idx) => toId(starters[idx]))
      .filter(Boolean);
  }, [activeRoster?.starters, visibleLineupSlots]);

  const rosterPlayers = useMemo<RosterPlayer[]>(() => {
    if (!activeRoster?.players?.length) return [];

    return activeRoster.players
      .map((player) => {
        const playerId = toId(player);
        const info = playerDictionary[playerId];
        const value = playerValues[playerId] ?? 0;
        const name =
          info?.full_name ||
          [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim() ||
          playerId ||
          "Unknown Player";
        const position =
          info?.position?.toUpperCase() ||
          info?.fantasy_positions?.[0]?.toUpperCase() ||
          "–";
        const age = info ? computeAge(info) : null;

        return {
          id: playerId,
          name,
          position,
          team: info?.team || "FA",
          ageLabel: age ? String(age) : "–",
          value,
        };
      })
      .filter((p) => p.id);
  }, [activeRoster?.players, playerDictionary, playerValues]);

  const rosterPlayersById = useMemo(
    () => new Map(rosterPlayers.map((player) => [player.id, player] as const)),
    [rosterPlayers]
  );

  const startingPlayers = useMemo(
    () =>
      startingLineupIds
        .map((id) => rosterPlayersById.get(id))
        .filter((player): player is NonNullable<typeof player> => Boolean(player)),
    [rosterPlayersById, startingLineupIds]
  );

  const startingIdSet = useMemo(() => new Set(startingLineupIds), [startingLineupIds]);

  const benchPlayers = useMemo(
    () => rosterPlayers.filter((player) => !startingIdSet.has(player.id)),
    [rosterPlayers, startingIdSet]
  );

  const draftPicks = useMemo(() => activeRoster?.draft_picks || [], [activeRoster?.draft_picks]);

  const draftPickText = useCallback(
    (pick: DraftPick) =>
      formatDraftPickLabel(pick, {
        teamCount: rosters.length || teams.length || 1,
        originalTeamNames: rosterNames,
        draftOrderAvailable: draftOrderAvailable === true,
        slotSeason: PICK_SLOT_SEASON,
      }),
    [draftOrderAvailable, rosterNames, rosters.length, teams.length]
  );

  const hasLoggedPickLabelCheck = useRef(false);

  useEffect(() => {
    if (hasLoggedPickLabelCheck.current || !draftPicks.length) return;
    const sample = draftPicks.find((pick) => pick.season === PICK_SLOT_SEASON);
    if (!sample) return;
    if (process.env.NODE_ENV !== "production") {
      console.log("[Trade Studio] Draft pick label check:", draftPickText(sample));
    }
    hasLoggedPickLabelCheck.current = true;
  }, [draftPicks, draftPickText]);

  const tradeBlock = useMemo(() => {
    const assets: TradeAsset[] = [];
    rosterPlayers.forEach((player) => {
      const key = availabilityKeyForPlayer(player.id);
      if (availability[key]) {
        assets.push({
          id: key,
          label: `${player.name} (${player.position} • ${player.team})`,
          type: "player",
        });
      }
    });
    draftPicks.forEach((pick) => {
      const key = availabilityKeyForPick(pick);
      if (availability[key]) {
        assets.push({
          id: key,
          label: draftPickText(pick),
          type: "pick",
        });
      }
    });
    return assets;
  }, [availability, draftPickText, draftPicks, rosterPlayers]);

  const teStartableThreshold = useMemo(() => {
    const teValues: number[] = [];
    Object.entries(playerValues).forEach(([playerId, value]) => {
      if (typeof value !== "number") return;
      const info = playerDictionary[playerId];
      const position =
        info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase();
      if (position === "TE") {
        teValues.push(value * TE_VALUE_MULTIPLIER);
      }
    });
    if (!teValues.length) return 0;
    const sorted = [...teValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }, [playerDictionary, playerValues]);

  const leagueRankings = useMemo(() => {
    if (!rosters.length || !Object.keys(playerValues).length) return null;
    const teamsInput = rosters.map((roster) => ({
      rosterId: roster.roster_id,
      players: (roster.players ?? []).map((player) => {
        const id = toId(player);
        const info = playerDictionary[id];
        const position =
          info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase() || undefined;
        return { sleeperId: id, position };
      }),
    }));
    return computeLeagueRankings(teamsInput, playerValues, { qbPremium: QB_VALUE_MULTIPLIER });
  }, [playerDictionary, playerValues, rosters]);

  const selectedTeamRanking = leagueRankings?.teams?.[toId(selectedTeam)];
  const teamCount = useMemo(() => rosters.length || teams.length || 12, [rosters.length, teams.length]);

  const tradeProfiles = useMemo(() => {
    if (!rosters.length || !Object.keys(playerDictionary).length) return null;
    const profileTeams = rosters.map((roster) => ({
      rosterId: roster.roster_id,
      players: (roster.players ?? []).map((player) => {
        const id = toId(player);
        const info = playerDictionary[id];
        const position =
          info?.position?.toUpperCase() || info?.fantasy_positions?.[0]?.toUpperCase();
        return {
          id,
          position,
          value: getPlayerValue(id, playerValues),
          age: info ? computeAge(info) : null,
        };
      }),
      picks: roster.draft_picks ?? [],
    }));
    return buildLeagueProfiles(profileTeams, {
      superflex: true,
      teDiscount: TE_VALUE_MULTIPLIER,
      qbPremium: QB_VALUE_MULTIPLIER,
      teamCount,
    });
  }, [playerDictionary, playerValues, rosters, teamCount]);

  const playerValuesLoadedLabel = useMemo(() => {
    const count = Object.keys(playerValues).length;
    const updated = playerValuesMeta?.lastUpdated;
    let suffix = "";
    if (updated) {
      const parsed = new Date(updated);
      if (!Number.isNaN(parsed.getTime())) {
        suffix = ` (updated ${parsed.toLocaleString()})`;
      }
    }
    return `${count} ${count === 1 ? "entry" : "entries"}${suffix}`;
  }, [playerValues, playerValuesMeta]);

  const setAvailabilityForKey = useCallback((key: string, value: boolean) => {
    setAvailability((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const renderPlayerRow = (player: RosterPlayer) => {
    const key = availabilityKeyForPlayer(player.id);
    const isAvailable = availability[key] || false;
    const rowClasses = [
      "flex items-center gap-3 rounded-lg border px-3 py-2 text-xs sm:text-sm transition",
      isAvailable
        ? "border-emerald-500/80 bg-emerald-900/50 shadow-[0_0_0_1px_rgba(16,185,129,0.6)]"
        : "border-gray-800 bg-gray-950",
    ].join(" ");
    return (
      <div key={player.id} className={rowClasses}>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold text-white break-words">{player.name}</span>
            {isAvailable ? (
              <span className="rounded-full bg-emerald-600/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-50">
                Shop
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-300 sm:text-xs">
            <span>{player.position}</span>
            <span className="text-gray-600">•</span>
            <span className="whitespace-nowrap">{player.team}</span>
            <span className="text-gray-600">•</span>
            <span className="whitespace-nowrap">{player.ageLabel}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] text-gray-400 sm:text-xs">Shop?</span>
          <div className="flex overflow-hidden rounded-full border border-gray-700 bg-gray-900">
            <button
              type="button"
              onClick={() => setAvailabilityForKey(key, true)}
              className={`px-2 py-1 font-semibold ${
                isAvailable ? "bg-emerald-700 text-white" : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              Y
            </button>
            <button
              type="button"
              onClick={() => setAvailabilityForKey(key, false)}
              className={`px-2 py-1 font-semibold ${
                !isAvailable ? "bg-gray-800 text-white" : "text-gray-300 hover:bg-gray-800"
              }`}
            >
              N
            </button>
          </div>
        </div>
      </div>
    );
  };

  const regenerateOffers = useCallback(() => {
    if (!selectedTeam || !rosters.length) {
      setOfferSuggestions([]);
      setActiveOfferIndex(0);
      return;
    }
    const selectedRosterId = Number(selectedTeam);
    const profilesWithOverride: Record<string | number, TradeProfile> | undefined =
      tradeProfiles && selectedTeam
        ? {
            ...tradeProfiles,
            [selectedRosterId]: {
              ...(tradeProfiles[selectedRosterId] ??
                tradeProfiles[selectedTeam] ?? {
                  rosterId: selectedRosterId,
                  mode: "retool",
                  posture: "neutral",
                  positionRanks: { QB: teamCount, RB: teamCount, WR: teamCount, TE: teamCount },
                  positionBands: { QB: "middle tier", RB: "middle tier", WR: "middle tier", TE: "middle tier" },
                  needs: [],
                  totalValue: 0,
                  averageAge: null,
                }),
              mode:
                timelineChoice === "Contend"
                  ? "contend"
                  : timelineChoice === "Rebuild"
                    ? "rebuild"
                    : "retool",
              posture:
                postureChoice === "Buyer"
                  ? "buyer"
                  : postureChoice === "Seller"
                    ? "seller"
                    : tradeProfiles[selectedRosterId]?.posture ?? "neutral",
            } as TradeProfile,
          }
        : tradeProfiles ?? undefined;
    const offers = buildOfferSuggestions(tradeBlock, {
      rosters,
      rosterNames,
      playerDictionary,
      playerValues,
      selectedTeam,
      teamCount,
      profiles: profilesWithOverride ?? undefined,
      aggression: offerAggression,
    });
    setOfferSuggestions(offers);
    setActiveOfferIndex(0);
  }, [
    offerAggression,
    playerDictionary,
    playerValues,
    rosterNames,
    rosters,
    selectedTeam,
    teamCount,
    timelineChoice,
    tradeBlock,
    tradeProfiles,
    postureChoice,
  ]);

  const handleSendOffer = useCallback(() => {
    window.alert("Send Offer is coming soon.");
  }, []);

  const goToNextOffer = useCallback(() => {
    setActiveOfferIndex((prev) => {
      if (!offerSuggestions.length) return 0;
      return (prev + 1) % offerSuggestions.length;
    });
  }, [offerSuggestions.length]);

  const goToPreviousOffer = useCallback(() => {
    setActiveOfferIndex((prev) => {
      if (!offerSuggestions.length) return 0;
      return (prev - 1 + offerSuggestions.length) % offerSuggestions.length;
    });
  }, [offerSuggestions.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      regenerateOffers();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [regenerateOffers]);

  const teamName = useMemo(
    () => teams.find((t) => toId(t.id) === selectedTeam)?.name || "Selected Team",
    [selectedTeam, teams]
  );

  const aiProfile = useMemo(
    () =>
      buildAiProfile(
        teamName,
        rosterPlayers.map((p) => ({ position: p.position, ageLabel: p.ageLabel, value: p.value })),
        draftPicks,
        {
          teStartableThreshold,
          teamRanking: selectedTeamRanking,
          teamCount: leagueRankings?.teamCount,
        }
      ),
    [teamName, rosterPlayers, draftPicks, teStartableThreshold, leagueRankings?.teamCount, selectedTeamRanking]
  );

  useEffect(() => {
    if (lastTeamRef.current !== selectedTeam) {
      setTimelineChoice(aiProfile.recommendedTimeline);
      setPostureChoice(aiProfile.recommendedPosture);
      lastTeamRef.current = selectedTeam;
    }
  }, [aiProfile, selectedTeam]);

  const currentOffer = offerSuggestions[activeOfferIndex] ?? offerSuggestions[0] ?? null;
  const offerTotal = offerSuggestions.length;
  const offerPosition = offerTotal ? activeOfferIndex + 1 : 0;

  return (
    <main className="h-screen overflow-hidden bg-black text-gray-100">
      {leagueIdError && (
        <div className="mx-auto mb-4 mt-4 w-[calc(100%-2rem)] max-w-3xl rounded-lg border border-amber-400/60 bg-amber-500/15 px-4 py-3 text-sm text-amber-50">
          {leagueIdError} Live Sleeper data is unavailable until it is set.
        </div>
      )}
      <div className="mx-auto flex h-full max-w-7xl flex-col px-4 py-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-4xl font-bold text-white">{pageTitle}</h1>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Back to Home
          </Link>
        </header>

        <div className="h-[calc(100vh-140px)] min-h-0 overflow-hidden">
          {!selectedTeam ? (
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-xl rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-white">Choose your team</h2>
                  <span className="text-xs text-gray-400">Locked after selection</span>
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  We’ll load your roster and draft picks from Sleeper once you pick a team.
                </p>
                {errorMessage ? <p className="mt-3 text-sm text-red-400">{errorMessage}</p> : null}
                <div className="mt-4">
                  <label className="mb-3 block text-xs text-gray-400" htmlFor="team-picker">
                    Sleeper team
                  </label>
                  <select
                    id="team-picker"
                    className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-white"
                    disabled={!!selectedTeam}
                    value={selectedTeam}
                    onChange={(e) => {
                      setSelectedTeam(e.target.value);
                    }}
                  >
                    <option value="">-- Choose Team --</option>
                    {teams.map((team) => (
                      <option key={team.id} value={toId(team.id)}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : isSnapshotOnly ? (
            <div className="flex h-full flex-col">
              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-indigo-800/60 bg-gradient-to-b from-gray-900 via-gray-900 to-black p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-white">Team Snapshot</h2>
                    <span className="rounded-full bg-indigo-900 px-3 py-1 text-xs font-semibold text-indigo-200">Beta</span>
                  </div>
                  <span className="rounded-full border border-gray-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                    AI stub
                  </span>
                </div>
                <div className="relative flex h-full flex-col overflow-hidden text-sm text-gray-200">
                  <div className={`flex-1 space-y-4 overflow-y-auto pr-1 ${SNAPSHOT_FOOTER_PADDING_CLASS}`}>
                    <p className="text-sm text-gray-300">{aiProfile.summary}</p>
                    <p className="text-xs text-gray-500">Values loaded: {playerValuesLoadedLabel}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-300">Strengths</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-200">
                          {aiProfile.strengths.slice(0, 3).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                        <p className="text-xs uppercase tracking-wide text-amber-300">Risks / Gaps</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-200">
                          {aiProfile.risks.slice(0, 3).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className="sticky bottom-0 mt-3 flex-shrink-0 border-t border-gray-800 bg-gradient-to-b from-gray-900 via-gray-900/95 to-black px-4 py-3">
                    <div className="flex flex-wrap items-start gap-6">
                      <div className="min-w-[180px] flex-1">
                        <p className="text-xs text-gray-400">Timeline</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {(["Contend", "Re-tool", "Rebuild"] as TimelineLane[]).map((lane) => {
                            const selected = timelineChoice === lane;
                            return (
                              <button
                                key={lane}
                                type="button"
                                onClick={() => setTimelineChoice(lane)}
                                className={[
                                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                                  selected
                                    ? "border-emerald-500 bg-emerald-900 text-emerald-50"
                                    : "border-gray-700 bg-gray-800 text-gray-300 hover:border-emerald-500/60 hover:text-white",
                                ].join(" ")}
                              >
                                {lane}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="min-w-[180px] flex-1">
                        <p className="text-xs text-gray-400">Posture</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {(["Buyer", "Seller"] as Posture[]).map((posture) => {
                            const selected = postureChoice === posture;
                            return (
                              <button
                                key={posture}
                                type="button"
                                onClick={() => setPostureChoice(posture)}
                                className={[
                                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                                  selected
                                    ? "border-indigo-500 bg-indigo-900 text-indigo-50"
                                    : "border-gray-700 bg-gray-800 text-gray-300 hover:border-indigo-500/60 hover:text-white",
                                ].join(" ")}
                              >
                                {posture}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 gap-6 xl:grid-cols-[520px_1fr]">
              <div className="flex h-full min-h-0 flex-col gap-4">
                <section className="flex h-full flex-[3] min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Roster</h2>
                      <p className="text-xs text-gray-500">
                        Toggle Shop? to mark assets; offers update automatically.
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">{teamName}</span>
                  </div>
                  <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
                    {startingPlayers.length ? (
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">Starting lineup</p>
                        {startingPlayers.map(renderPlayerRow)}
                      </div>
                    ) : null}
                    {benchPlayers.length ? (
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">Bench</p>
                        {benchPlayers.map(renderPlayerRow)}
                      </div>
                    ) : null}
                    {!startingPlayers.length && !benchPlayers.length ? (
                      <p className="text-sm text-gray-400">No players loaded.</p>
                    ) : null}
                  </div>
                </section>

                <section className="flex h-full flex-[2] min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Draft Picks</h2>
                      <p className="text-xs text-gray-500">Shop picks separately; each scrolls inside this card.</p>
                    </div>
                    <span className="text-xs text-gray-400">{teamName}</span>
                  </div>
                  {draftOrderAvailable === false ? (
                    <p className="mb-2 text-xs text-amber-300">{DRAFT_ORDER_UNAVAILABLE_MESSAGE}</p>
                  ) : null}
                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {draftPicks.length ? (
                      draftPicks.map((pick) => {
                        const key = availabilityKeyForPick(pick);
                        const isAvailable = availability[key] || false;
                        const label = draftPickText(pick);
                        const rowClasses = [
                          "flex items-center gap-3 rounded-lg border px-3 py-2 text-xs sm:text-sm transition",
                          isAvailable
                            ? "border-emerald-500/80 bg-emerald-900/50 shadow-[0_0_0_1px_rgba(16,185,129,0.6)]"
                            : "border-gray-800 bg-gray-950",
                        ].join(" ");
                        return (
                          <div key={key} className={rowClasses}>
                            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="font-semibold text-white break-words">{label}</span>
                                {isAvailable ? (
                                  <span className="rounded-full bg-emerald-600/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-50">
                                    Shop
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-300 sm:text-xs">
                                <span>{pick.season || "Future"}</span>
                                <span className="text-gray-600">•</span>
                                <span>{pick.round ? `Round ${pick.round}` : "Round tbd"}</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                              <span className="text-[11px] text-gray-400 sm:text-xs">Shop?</span>
                              <div className="flex overflow-hidden rounded-full border border-gray-700 bg-gray-900">
                                <button
                                  type="button"
                                  onClick={() => setAvailabilityForKey(key, true)}
                                  className={`px-2 py-1 font-semibold ${
                                    isAvailable ? "bg-emerald-700 text-white" : "text-gray-300 hover:bg-gray-800"
                                  }`}
                                >
                                  Y
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAvailabilityForKey(key, false)}
                                  className={`px-2 py-1 font-semibold ${
                                    !isAvailable ? "bg-gray-800 text-white" : "text-gray-300 hover:bg-gray-800"
                                  }`}
                                >
                                  N
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-gray-400">No draft picks found.</p>
                    )}
                  </div>
                </section>
              </div>

              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-white">Trade Workbench</h2>
                    <span className="rounded-full bg-indigo-900 px-3 py-1 text-xs font-semibold text-indigo-200">Beta</span>
                  </div>
                  <span className="text-xs text-gray-400">Offers auto-refresh</span>
                </div>
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {([
                      { key: "trade-block" as WorkbenchTabKey, label: "Trade Block" },
                      { key: "incoming" as WorkbenchTabKey, label: "Incoming Offers" },
                      { key: "chat" as WorkbenchTabKey, label: "Trade Chat" },
                    ] satisfies Array<{ key: WorkbenchTabKey; label: string }>).map((tab) => {
                      const selected = activeWorkbenchTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveWorkbenchTab(tab.key)}
                          className={[
                            "rounded-full px-3 py-1 text-xs font-semibold transition",
                            selected
                              ? "bg-indigo-700 text-white"
                              : "border border-gray-700 bg-gray-800 text-gray-300 hover:border-indigo-500/60 hover:text-white",
                          ].join(" ")}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex-1 min-h-0">
                    {activeWorkbenchTab === "trade-block" ? (
                      <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-950/70 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-400">Offer Suggestions</p>
                            <p className="text-sm font-semibold text-white">Offers refresh as you mark Shop items.</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-emerald-700/60 bg-emerald-900/60 px-3 py-1 text-[11px] font-semibold text-emerald-50">
                              Auto
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={goToPreviousOffer}
                                disabled={!offerSuggestions.length}
                                className="rounded-md border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-200 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
                              >
                                Prev
                              </button>
                              <button
                                type="button"
                                onClick={goToNextOffer}
                                disabled={!offerSuggestions.length}
                                className="rounded-md border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-200 transition hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        </div>

                        {offerSuggestions.length ? (
                          <>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-wide text-gray-400">Partner</p>
                                <p className="text-base font-semibold text-white">{currentOffer?.partner ?? ""}</p>
                                <p className="text-xs text-gray-500">
                                  {currentOffer
                                    ? `You send ${Math.round(currentOffer.valueSent)} • You receive ${Math.round(currentOffer.valueReceived)}`
                                    : null}
                                </p>
                              </div>
                              <div className="min-w-[200px] flex-1 sm:flex-none">
                                <label
                                  className="flex items-center justify-between text-xs text-gray-400"
                                  htmlFor="aggression-slider"
                                >
                                  <span>Conservative to Aggressive</span>
                                  <span className="text-[11px] text-gray-500">{offerAggression}%</span>
                                </label>
                                <input
                                  id="aggression-slider"
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={offerAggression}
                                  onChange={(e) => setOfferAggression(Number(e.target.value))}
                                  className="mt-1 h-2 w-full cursor-pointer accent-indigo-500"
                                />
                                <div className="mt-1 flex justify-between text-[11px] text-gray-500">
                                  <span>Conservative</span>
                                  <span>Aggressive</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-lg border border-gray-800 bg-black/40 p-3">
                                  <p className="text-xs uppercase tracking-wide text-gray-400">
                                    You send ({teamName})
                                  </p>
                                  <ul className="mt-2 space-y-2 text-sm text-gray-200">
                                    {currentOffer?.send?.map((item) => (
                                      <li
                                        key={`${currentOffer?.id}-send-${item.id}`}
                                        className="rounded-md border border-gray-800 bg-gray-900 px-2 py-2"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold text-white">{item.label}</p>
                                            <p className="text-[11px] text-gray-500">
                                              {item.type === "player"
                                                ? `${item.position || "Flex"} • ${item.team || "FA"} • ${item.ageLabel ?? "–"}`
                                                : "Draft pick"}
                                            </p>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {item.isUnvalued ? (
                                              <span className="rounded-full bg-gray-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                                                Unvalued
                                              </span>
                                            ) : null}
                                            <span className="rounded-md bg-gray-800 px-2 py-1 text-[11px] text-gray-200">
                                              {Math.round(item.value)}
                                            </span>
                                          </div>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="rounded-lg border border-gray-800 bg-black/40 p-3">
                                  <p className="text-xs uppercase tracking-wide text-gray-400">
                                    You receive ({currentOffer?.partner ?? ""})
                                  </p>
                                  <ul className="mt-2 space-y-2 text-sm text-gray-200">
                                    {currentOffer?.receive?.map((item) => (
                                      <li
                                        key={`${currentOffer?.id}-receive-${item.id}`}
                                        className="rounded-md border border-gray-800 bg-gray-900 px-2 py-2"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold text-white">{item.label}</p>
                                            <p className="text-[11px] text-gray-500">
                                              {item.type === "player"
                                                ? `${item.position || "Flex"} • ${item.team || "FA"} • ${item.ageLabel ?? "–"}`
                                                : "Draft pick"}
                                            </p>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {item.isUnvalued ? (
                                              <span className="rounded-full bg-gray-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                                                Unvalued
                                              </span>
                                            ) : null}
                                            <span className="rounded-md bg-gray-800 px-2 py-1 text-[11px] text-gray-200">
                                              {Math.round(item.value)}
                                            </span>
                                          </div>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                              <div className="mt-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  {currentOffer?.tags?.map((tag) => (
                                    <span
                                      key={`${currentOffer.id}-tag-${tag}`}
                                      className="rounded-full border border-indigo-700/60 bg-indigo-900/60 px-3 py-1 text-[11px] font-semibold text-indigo-50"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {currentOffer ? (
                                    <span
                                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                                        fairnessStyles[currentOffer.fairness] ??
                                        "border-gray-700 bg-gray-800 text-gray-200"
                                      }`}
                                    >
                                      {currentOffer.fairness}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-sm text-gray-200">{currentOffer?.explanation ?? ""}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={regenerateOffers}
                                  className="rounded-md border border-indigo-700 bg-indigo-900 px-3 py-2 text-xs font-semibold text-indigo-50 transition hover:border-indigo-500 hover:text-white"
                                >
                                  Generate again
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSendOffer}
                                  className="rounded-md border border-emerald-700 bg-emerald-800 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:border-emerald-600 hover:text-white"
                                >
                                  Send Offer
                                </button>
                              </div>
                              <span className="text-xs text-gray-400">
                                Offer carousel {offerPosition} of {offerTotal}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-800 bg-black/40 p-4 text-sm text-gray-400">
                            {tradeBlock.length
                              ? "No fair offers met the constraints. Adjust your Shop list or aggression to try again."
                              : "Toggle Shop? on players or picks to see suggestions."}
                          </div>
                        )}
                      </div>
                    ) : activeWorkbenchTab === "incoming" ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-800 bg-black/40 text-sm text-gray-400">
                        <p>No incoming offers yet.</p>
                        <p className="text-xs text-gray-500">Generate offers or await league activity.</p>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-800 bg-black/40 text-sm text-gray-400">
                        <p>Chat coming soon.</p>
                        <p className="text-xs text-gray-500">Collaborate with league mates here.</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
