"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const ERROR_MESSAGES: Record<string, string> = {
  not_a_member: "This email isn't registered with the CFC league.",
  auth_failed: "Something went wrong. Please try again.",
  missing_code: "Invalid or expired link. Please request a new one.",
};

function LoginForm() {
  const [email, setEmail] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      if (supabase && typeof window !== "undefined") {
        await supabase.auth.signInWithOtp({
          email: trimmed,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            shouldCreateUser: false,
          },
        });
      }
    } catch {
      // Swallow errors to prevent email enumeration
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  };

  const hasEmail = email.trim().length > 0;

  const buttonStyle = hasEmail
    ? {
        background: "#E8503A",
        color: "#fff",
        border: "2px solid #FEFCF9",
        cursor: "pointer" as const,
      }
    : {
        background: "#1e1e1e",
        color: "#444",
        border: "2px solid #2a2a2a",
        cursor: "not-allowed" as const,
      };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1A1A1A",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {!logoFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/cfc-logo.png"
            alt="Cleveland Football Club"
            style={{ height: 72, display: "block" }}
            onError={() => setLogoFailed(true)}
          />
        )}

        <div style={{ marginTop: 32, textAlign: "center", width: "100%" }}>
          <div
            style={{
              fontFamily: "var(--font-headline, 'Syne', sans-serif)",
              fontWeight: 800,
              fontSize: 32,
              color: "#FEFCF9",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              lineHeight: 1.1,
            }}
          >
            Cleveland Football Club
          </div>
          <div
            style={{
              width: "100%",
              height: 3,
              background: "#E8503A",
              margin: "14px 0",
            }}
          />
          <div
            style={{
              fontFamily: "var(--font-headline, 'Syne', sans-serif)",
              fontWeight: 800,
              fontSize: 32,
              color: "#FEFCF9",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              lineHeight: 1.1,
            }}
          >
            Members Only
          </div>
        </div>

        <div style={{ marginTop: 44, width: "100%", maxWidth: 360 }}>
          <Suspense fallback={null}>
            <LoginErrorMessage />
          </Suspense>

          {sent ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "#3366CC",
                  border: "2.5px solid #FEFCF9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="#fff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontWeight: 700,
                  fontSize: 15,
                  color: "#FEFCF9",
                }}
              >
                Check your inbox.
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 12,
                  color: "#666",
                }}
              >
                Link sent to {email.trim().toLowerCase()}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 12,
                  color: "#666",
                  textAlign: "center",
                  marginBottom: 14,
                }}
              >
                Enter your email and we&apos;ll send you a link to get in.
              </div>

              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  background: "#111",
                  color: "#FEFCF9",
                  border: "2px solid #2a2a2a",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 14,
                  width: "100%",
                  outline: "none",
                  marginBottom: 12,
                  boxSizing: "border-box",
                }}
              />

              <button
                type="submit"
                disabled={!hasEmail || submitting}
                style={{
                  ...buttonStyle,
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontWeight: 800,
                  fontSize: 13,
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.1em",
                  borderRadius: 8,
                  padding: 13,
                  width: "100%",
                }}
              >
                {submitting ? "Sending…" : "Send My Link"}
              </button>
            </form>
          )}
        </div>

        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 9,
            color: "#333",
            textAlign: "center",
            marginTop: 40,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          Private league · Invitation only
        </div>
      </div>
    </div>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
