// Smooth TE position multiplier — replaces the DB rebuild's 4-step TE ladder
// (1.0 / 0.85 / 0.7 / 0.5 with cliffs at $250/$150/$100 composite). Runs as a
// post-pass right after cfc_rebuild_value_layers() and before the per-team
// rebuilds, so every downstream layer inherits the smoothed base.
//
// Calibration (owner call, 2026-07-19): a flat 10% haircut that fades out at
// the top — ×0.9 for every TE under $150 composite, linear to ×1.0 at $250+.
// League rationale: no dedicated TE slot (TEs fight WR/RB for flex), so a mild
// across-the-board discount; elite TEs (Bowers tier) are priced fairly by the
// market already and keep full value.

type SupabaseAdmin = NonNullable<
  ReturnType<typeof import("@/infrastructure/supabase/admin").getSupabaseAdminClient>["client"]
>;

const TE_RAMP: Array<{ comp: number; mult: number }> = [
  { comp: 150, mult: 0.9 },
  { comp: 250, mult: 1.0 },
];

export function teRampMultiplier(composite: number): number {
  const a = TE_RAMP;
  if (composite <= a[0].comp) return a[0].mult;
  if (composite >= a[a.length - 1].comp) return a[a.length - 1].mult;
  for (let i = 1; i < a.length; i++) {
    if (composite <= a[i].comp) {
      const t = (composite - a[i - 1].comp) / (a[i].comp - a[i - 1].comp);
      return a[i - 1].mult + t * (a[i].mult - a[i - 1].mult);
    }
  }
  return a[a.length - 1].mult;
}

type CalcRow = {
  asset_key: string;
  composite_value: number | null;
  elite_multiplier_applied: number | null;
  age_multiplier_applied: number | null;
  scoring_factor_applied: number | null;
  position_multiplier_applied: number | null;
  computed_cfc_value: number | null;
  final_cfc_value: number | null;
};

// Recompute every TE's position multiplier off the smooth ramp and cascade it
// into computed/final values. cfc_trade_values_current is a VIEW over these
// calc rows, so updating cfc_asset_calculations is the whole write. Rows with
// a manual override (final != computed) keep their final value untouched.
export async function applyTeRamp(client: SupabaseAdmin): Promise<{ updated: number }> {
  const { data: teAssets, error: assetErr } = await client
    .from("cfc_assets")
    .select("asset_key")
    .eq("asset_type", "player")
    .eq("position", "TE");
  if (assetErr) throw new Error(`teRamp: asset query failed: ${assetErr.message}`);
  const keys = (teAssets ?? []).map((a: { asset_key: string }) => a.asset_key);
  if (!keys.length) return { updated: 0 };

  const { data: calcData, error: calcErr } = await client
    .from("cfc_asset_calculations")
    .select("asset_key, composite_value, elite_multiplier_applied, age_multiplier_applied, scoring_factor_applied, position_multiplier_applied, computed_cfc_value, final_cfc_value")
    .in("asset_key", keys);
  if (calcErr) throw new Error(`teRamp: calc query failed: ${calcErr.message}`);

  let updated = 0;
  for (const c of (calcData ?? []) as CalcRow[]) {
    if (typeof c.composite_value !== "number") continue;
    const mult = Math.round(teRampMultiplier(c.composite_value) * 10000) / 10000;
    const computed = Math.round(
      c.composite_value *
        (c.elite_multiplier_applied ?? 1) *
        mult *
        (c.age_multiplier_applied ?? 1) *
        (c.scoring_factor_applied ?? 1)
    );
    const hasOverride =
      c.final_cfc_value != null && c.computed_cfc_value != null && c.final_cfc_value !== c.computed_cfc_value;
    const final = hasOverride ? c.final_cfc_value! : computed;

    const { error: updErr } = await client
      .from("cfc_asset_calculations")
      .update({ position_multiplier_applied: mult, computed_cfc_value: computed, final_cfc_value: final })
      .eq("asset_key", c.asset_key);
    if (updErr) throw new Error(`teRamp: calc update failed for ${c.asset_key}: ${updErr.message}`);
    updated++;
  }
  return { updated };
}
