import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getLeagueData, type AttachmentLevel, type OwnedPick } from "@/shared/league-data";
import {
  buildValuationContext,
  valueAsset,
  applyModifiers,
  AVAILABILITY_PCT,
  CLASS_STRENGTH_PCT,
  type ClassStrength,
} from "@/shared/asset-values";

// Picks share the per-team values table with players. We key each pick row by
// its canonical pick key (the same key availability is saved under), tag it
// position="PICK", and reuse the player modifier columns:
//   own_guys_modifier_pct  -> availability tier  (same scale as players)
//   market_modifier_pct    -> draft class strength (picks only)
//   studs/youth             -> 0 (player-only signals)

const pad = (n: number): string => String(n).padStart(2, "0");

function pickLabel(p: OwnedPick): string {
  if (p.kind === "current" && p.slot != null) return `${p.season} ${p.round}.${pad(p.slot)}`;
  const ord = p.round === 1 ? "1st" : p.round === 2 ? "2nd" : p.round === 3 ? "3rd" : `${p.round}th`;
  return `${p.season} ${ord}`;
}

// Maps legacy attachment values to the current set; null/unknown -> listening.
function normalizeAttachment(v: string | null | undefined): AttachmentLevel {
  if (!v) return "listening";
  const m: Record<string, AttachmentLevel> = {
    love_my_guys: "untouchable",
    prefer_to_keep_them: "core_piece",
    neutral: "listening",
    ready_to_shake_it_up: "moveable",
    untouchable: "untouchable",
    core_piece: "core_piece",
    listening: "listening",
    moveable: "moveable",
  };
  return m[v.toLowerCase().trim()] ?? "listening";
}

// Recompute and store adjusted values for ALL of one team's picks. Fires when a
// pick's availability or its draft-class strength changes. Cheap to over-rebuild
// (a team owns ~8-12 picks), and keeps every pick row internally consistent.
export async function rebuildPickValuesForTeam(
  leagueId: string,
  teamId: string,
): Promise<void> {
  const { client } = getSupabaseAdminClient();
  if (!client) return;

  // 1. My picks — the canonical ownership fact (current + future, spent dropped).
  const league = await getLeagueData();
  if ("error" in league) return;
  const myPicks = league.pickOwnership.get(teamId) ?? [];
  if (myPicks.length === 0) return;

  // 2. Base prices + team tiers + ladder, built once for the whole set.
  const ctx = await buildValuationContext();

  // 3. This team's availability tiers + class strengths, keyed by pick key.
  const [availRes, classRes] = await Promise.all([
    client
      .from("cfc_team_player_attachment")
      .select("sleeper_player_id, attachment")
      .eq("league_id", leagueId)
      .eq("team_id", teamId),
    client
      .from("cfc_team_draft_class_strength")
      .select("pick_key, strength")
      .eq("league_id", leagueId)
      .eq("team_id", teamId),
  ]);

  const availByKey = new Map<string, AttachmentLevel>();
  for (const r of (availRes.data ?? []) as Array<{ sleeper_player_id: string; attachment: string }>) {
    availByKey.set(r.sleeper_player_id, normalizeAttachment(r.attachment));
  }
  const classByKey = new Map<string, ClassStrength>();
  for (const r of (classRes.data ?? []) as Array<{ pick_key: string; strength: string }>) {
    if (r.strength === "weak" || r.strength === "average" || r.strength === "stacked") {
      classByKey.set(r.pick_key, r.strength);
    }
  }

  // 4. Build one adjusted row per pick.
  const nowIso = new Date().toISOString();
  const rows = myPicks.map((pick) => {
    const base = valueAsset({ type: "pick", key: pick.key }, ctx); // no perspective => base
    const availability = availByKey.get(pick.key) ?? "listening";
    const strength = classByKey.get(pick.key) ?? "average";
    const availPct = AVAILABILITY_PCT[availability];
    const classPct = CLASS_STRENGTH_PCT[strength];
    const final = applyModifiers(base, [availPct, classPct]);

    return {
      league_id: leagueId,
      team_id: teamId,
      sleeper_player_id: pick.key,
      player_name: pickLabel(pick),
      position: "PICK",
      nfl_team: null,
      base_value: base,
      auto_value: final,
      manual_override_value: null,
      final_value: final,
      studs_modifier_pct: 0,
      youth_modifier_pct: 0,
      market_modifier_pct: classPct,
      own_guys_modifier_pct: availPct,
      total_modifier_pct: availPct + classPct,
      is_overridden: false,
      created_at: nowIso,
      updated_at: nowIso,
    };
  });

  await client
    .from("cfc_team_trade_values_current")
    .upsert(rows, { onConflict: "league_id,team_id,sleeper_player_id" });
}