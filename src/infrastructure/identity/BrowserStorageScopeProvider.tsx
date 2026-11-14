"use client";

import { createContext, useContext, type ReactNode } from "react";
import { browserStorageScope } from "./browserStorage";

export type AppIdentity = {
  userId: string;
  leagueId: string;
  rosterId: string;
  role: "member" | "commissioner" | "admin";
  teamName: string;
  cfcFeatures: boolean;
};
const AppIdentityContext = createContext<AppIdentity | null>(null);

export function BrowserStorageScopeProvider({ identity, children }: { identity: AppIdentity | null; children: ReactNode }) {
  return <AppIdentityContext.Provider value={identity}>{children}</AppIdentityContext.Provider>;
}

export const useAppIdentity = () => useContext(AppIdentityContext);

export function useBrowserStorageScope() {
  return browserStorageScope(useAppIdentity());
}

/** Server-verified display identity; readable cookies never select a private roster. */
export function useStoredTeam() {
  const identity = useAppIdentity();
  return { rosterId: identity?.rosterId, teamName: identity?.teamName, leagueId: identity?.leagueId, cfcFeatures: identity?.cfcFeatures ?? false };
}
