import type { StrategyProfile } from "@/shared/league-data";
import type { WantsClarity, WantsDirection } from "./types";

// ── Wants-clarity grading ─────────────────────────────────────────────────
//
// The very first interpretive read on every team. Grades the wantsMore array
// for direction BEFORE any archetype is considered. See trade_brain.docx
// Section 3.2.
//
// Rules:
//   CLEAR  — exactly 1 or 2 wants AND no internal contradiction.
//             Direction inferred: build wants (picks, youth) → "accumulate";
//             win-now wants (studs, depth) → "convert".
//   NOISE  — 3 or more wants, OR any contradictory pair (one build + one
//             win-now). Wants are dropped; roster does all the work.
//
// Unknown wantsMore values (anything outside the four recognized keywords)
// are filtered out before grading rather than triggering NOISE — defensive
// against typos / future tags. Duplicates are deduped.

const BUILD_WANTS = new Set(["picks", "youth"]);
const WIN_NOW_WANTS = new Set(["studs", "depth"]);

function normalize(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = (raw ?? "").trim().toLowerCase();
    if (!v) continue;
    if (!BUILD_WANTS.has(v) && !WIN_NOW_WANTS.has(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function inferDirection(wants: string[]): WantsDirection {
  const hasBuild = wants.some((w) => BUILD_WANTS.has(w));
  const hasWinNow = wants.some((w) => WIN_NOW_WANTS.has(w));
  if (hasBuild && !hasWinNow) return "accumulate";
  if (hasWinNow && !hasBuild) return "convert";
  return null;
}

export function gradeWants(strategy: StrategyProfile | null | undefined): WantsClarity {
  const raw = strategy?.wantsMore ?? [];
  const cleaned = normalize(raw);

  // Empty or 3+ items → noise. Nothing extractable.
  if (cleaned.length === 0 || cleaned.length >= 3) {
    return { grade: "noise", direction: null, raw };
  }

  // Contradiction check — any build want paired with any win-now want.
  const direction = inferDirection(cleaned);
  if (direction === null) {
    return { grade: "noise", direction: null, raw };
  }

  return { grade: "clear", direction, raw };
}