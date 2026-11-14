"use client";
import { useAppIdentity, type AppIdentity } from "./BrowserStorageScopeProvider";

export type Identity = AppIdentity;
export const useIdentity = useAppIdentity;
