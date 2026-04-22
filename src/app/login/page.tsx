"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const ERROR_MESSAGES: Record<string, string> = {
  not_a_member: "This email isn't registered with the CFC league.",
  auth_failed: "Something went wrong. Please try again.",
  missing_code: "Invalid or expired link. Please request a new one.",
};

function LoginErrorMessage() {
  const searchParams = useSearchParams();
  const errorKey = searchParams.get("error");
  if (!errorKey) return null;
  const message = ERROR_MESSAGES[errorKey];
  if (!message) return null;
  return (
    <div
      style={{
        fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
        fontSize: 13,
        color: "#E8503A",
        textAlign: "center",
        marginBottom: 14,
      }}
    >
      {message}
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      if (supabase && typeof window !== "undefined") {
        await supabase.auth.signInWithOtp({
          email: trimmed,
          options: { shouldCreateUser: false },
        });
      }
    } catch {
      // Swallow errors to prevent email enumeration
    } finally {
      setStep("code");
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    if (!trimmedCode || submitting) return;
    setSubmitting(true);
    setVerifyError("");
    try {
      if (!supabase) throw new Error("Client unavailable");
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email: trimmed,
        token: trimmedCode,
        type: "email",
      });
      if (verifyErr) throw verifyErr;
      const res = await fetch("/api/auth/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error === "not_a_member"
            ? "This email isn't registered with the CFC league."
            : json?.error ?? "Failed to finalize login"
        );
      }
      window.location.href = json.redirect ?? "/";
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Invalid code. Please try again.");
      setSubmitting(false);
    }
  };

  const hasEmail = email.trim().length > 0;
  const hasCode = code.trim().length === 6;

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
          <div style={{ width: "100%", height: 3, background: "#E8503A", margin: "14px 0" }} />
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

          {step === "email" ? (
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
                Enter your email and we&apos;ll send you a 6-digit code.
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
                  background: hasEmail ? "#E8503A" : "#1e1e1e",
                  color: hasEmail ? "#fff" : "#444",
                  border: hasEmail ? "2px solid #FEFCF9" : "2px solid #2a2a2a",
                  cursor: hasEmail ? "pointer" : "not-allowed",
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
                {submitting ? "Sending…" : "Send My Code"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginBottom: 20 }}>
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
                    <path d="M4 4h16v12H4z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M4 4l8 8 8-8" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontWeight: 700,
                    fontSize: 15,
                    color: "#FEFCF9",
                    marginTop: 8,
                  }}
                >
                  Check your inbox.
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 12,
                    color: "#666",
                    textAlign: "center",
                  }}
                >
                  We sent a 6-digit code to {email.trim().toLowerCase()}
                </div>
              </div>

              {verifyError && (
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 13,
                    color: "#E8503A",
                    textAlign: "center",
                    marginBottom: 12,
                  }}
                >
                  {verifyError}
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{
                  background: "#111",
                  color: "#FEFCF9",
                  border: "2px solid #2a2a2a",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 24,
                  fontWeight: 700,
                  width: "100%",
                  outline: "none",
                  marginBottom: 12,
                  boxSizing: "border-box",
                  textAlign: "center",
                  letterSpacing: "0.3em",
                }}
              />

              <button
                type="submit"
                disabled={!hasCode || submitting}
                style={{
                  background: hasCode ? "#E8503A" : "#1e1e1e",
                  color: hasCode ? "#fff" : "#444",
                  border: hasCode ? "2px solid #FEFCF9" : "2px solid #2a2a2a",
                  cursor: hasCode ? "pointer" : "not-allowed",
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
                {submitting ? "Verifying…" : "Verify Code"}
              </button>

              <button
                type="button"
                onClick={() => { setStep("email"); setCode(""); setVerifyError(""); }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#555",
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 12,
                  cursor: "pointer",
                  marginTop: 12,
                  width: "100%",
                  textAlign: "center",
                }}
              >
                ← Use a different email
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
