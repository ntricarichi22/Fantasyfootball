"use client";

import { useEffect, useState } from "react";
import DraftRoom from "../../page";

export default function DraftPage() {
  // Guard direct access to /draft: if the identity cookie is missing,
  // bounce back to / so the user enters through the home screen door.
  // This replaces the old auto-redirect effect that previously lived in
  // page.tsx and caused a bouncing loop with the cookie-sync effect.
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasIdentity = document.cookie
      .split("; ")
      .some((row) => row.startsWith("cfc_identity="));
    if (!hasIdentity) {
      window.location.href = "/";
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllowed(true);
  }, []);

  if (!allowed) return null;
  return <DraftRoom />;
}
