"use client";

import { useCallback, useMemo } from "react";
import { useAppIdentity } from "./BrowserStorageScopeProvider";
import { createLeagueRequester } from "./leagueCommands";

export function useLeagueFetch() {
  const identity = useAppIdentity();
  const leagueId = identity?.leagueId, userId = identity?.userId, rosterId = identity?.rosterId;
  return useMemo(() => createLeagueRequester(leagueId && userId && rosterId ? { leagueId, userId, rosterId } : undefined), [leagueId, userId, rosterId]);
}

export function useLeagueAiFetch() {
  const request = useLeagueFetch();
  return useCallback((input: string, init?: RequestInit) => request(input, { ...init, credentials: "same-origin" }), [request]);
}
