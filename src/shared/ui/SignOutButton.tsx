"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/infrastructure/supabase/client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNeedsSignIn(false);
    try {
      const client = getSupabaseClient();
      const session = client ? await client.auth.getSession() : null;
      const token = session?.data.session?.access_token;
      if (!client || session?.error || !token) {
        setNeedsSignIn(true);
        setError("Sign in again to verify this session before signing out.");
        return;
      }
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setNeedsSignIn(response.status === 401 || response.status === 403);
        setError("Sign out could not be confirmed. Please try again.");
        return;
      }
      // The server has revoked this provider session and cleared app cookies.
      // Clear the provider's browser state only after revocation succeeds.
      const { error: localError } = await client.auth.signOut({ scope: "local" });
      if (localError) {
        setNeedsSignIn(true);
        setError("Your session was revoked. Return to login to sign in again.");
        return;
      }
      window.location.replace("/login");
    } catch {
      setError("Sign out could not be confirmed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={signOut}
        style={{
          display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
          background: "none", border: "none", cursor: busy ? "wait" : "pointer",
          fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 12,
          letterSpacing: "0.05em", textTransform: "uppercase", color: "#1A1A1A",
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <div role="alert" style={{ padding: "0 12px 12px", fontSize: 12, color: "#9D291A" }}>
          {error}{needsSignIn && <> <Link href="/login">Return to login</Link>.</>}
        </div>
      )}
    </>
  );
}
