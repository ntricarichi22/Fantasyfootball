"use client";
import { useEffect, useState } from "react";

export type Identity = {
  rosterId: string;
  teamName: string;
  email: string;
};

export const useIdentity = (): Identity | null => {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    try {
      const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith("cfc_identity="));
      if (!match) return;
      const raw = decodeURIComponent(match.split("=")[1]);
      const parsed = JSON.parse(raw);
      if (parsed?.rosterId && parsed?.teamName && parsed?.email) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIdentity(parsed as Identity);
      }
    } catch {
      // ignore
    }
  }, []);

  return identity;
};
