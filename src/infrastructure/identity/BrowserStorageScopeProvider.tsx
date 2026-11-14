"use client";

import { createContext, useContext, type ReactNode } from "react";

const BrowserStorageScopeContext = createContext<string | null>(null);

export function BrowserStorageScopeProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  return <BrowserStorageScopeContext.Provider value={scope}>{children}</BrowserStorageScopeContext.Provider>;
}

export function useBrowserStorageScope() {
  return useContext(BrowserStorageScopeContext);
}
