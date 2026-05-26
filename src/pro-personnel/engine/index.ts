// src/pro-personnel/engine/index.ts
//
// Public surface of the unified deal engine. Routes import from here only.

import { construct } from "./construct";
import type { EngineContext } from "./construct";
import {
  studioRequest,
  builderRequest,
  builderRequestForTarget,
  scoutingRequest,
} from "./adapters";
import type { EngineSlate, Intent, Lean } from "./types";

export * from "./types";
export { construct, studioRequest, builderRequest, builderRequestForTarget, scoutingRequest };
export type { EngineContext };

// Thin runners — one call from a route: adapter → constructor → slate.

export function runStudio(
  ec: EngineContext,
  ourTeamId: string,
  shopKeys: string[],
  opts?: { counterpartyTeamIds?: string[] },
): EngineSlate {
  return construct(studioRequest(ourTeamId, shopKeys, opts), ec);
}

export function runBuilder(
  ec: EngineContext,
  ourTeamId: string,
  opts?: { counterpartyTeamIds?: string[]; leans?: Lean[] },
): EngineSlate {
  return construct(builderRequest(ourTeamId, opts), ec);
}

export function runScouting(
  ec: EngineContext,
  ourTeamId: string,
  args: {
    pickKeys: string[];
    intent: Intent;
    counterpartyTeamIds?: string[];
    requiredCounterpartyKeys?: string[];
    leans?: Lean[];
  },
): EngineSlate {
  return construct(scoutingRequest(ourTeamId, args), ec);
}