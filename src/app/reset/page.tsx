"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/infrastructure/supabase/client";

function ResetForm() {
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);

  // The recovery link drops a session token in the URL. The Supabase client
  // (detectSessionInUrl) parses it and fires onAuthStateChange with a session,
  // which is what lets us call updateUser() below. If nothing establishes a
  // session, the link was invalid or expired.
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      setLinkError(true);
      return;
    }
    const client = supabase;
    let resolved = false;
    const markReady = () => {
      if (resolved) return;
      resolved = true;
      setReady(true);
      setChecking(false);
    };

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (session) markReady();
    });

    client.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    // Fallback: if the token is bad, no auth event ever fires — give the URL
    // detection a moment, then surface an expired-link message.
    const timer = window.setTimeout(async () => {
      if (resolved) return;
      const { data } = await client.auth.getSession();
      if (data.session) {
        markReady();
      } else {
        setChecking(false);
        setLinkError(true);
      }
    }, 2500);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }
    if (!supabase) {
      setFormError("Something went wrong. Please try again.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setFormError(
          "Couldn't update your password. This link may have expired — request a new one from the login page."
        );
        setSubmitting(false);
        return;
      }

      // Password is set and we now hold a real session — hand it to finalize so
      // the app's cfc_* cookies get set, then land wherever finalize redirects.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("no_session");

      const res = await fetch("/api/auth/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "finalize_failed");
      window.location.href = json.redirect ?? "/";
    } catch {
      setFormError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = passwordLongEnough && passwordsMatch;

  const activeButtonStyle = {
    background: "#E8503A",
    color: "#fff",
    border: "2px solid #FEFCF9",
    cursor: "pointer" as const,
  };
  const disabledButtonStyle = {
    background: "#1e1e1e",
    color: "#444",
    border: "2px solid #2a2a2a",
    cursor: "not-allowed" as const,
  };

  const inputStyle = {
    background: "#111",
    color: "#FEFCF9",
    border: "2px solid #2a2a2a",
    borderRadius: 8,
    padding: "12px 14px",
    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    fontSize: 14,
    width: "100%",
    outline: "none",
    marginBottom: 8,
    boxSizing: "border-box" as const,
  };

  const buttonBaseStyle = {
    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    fontWeight: 800,
    fontSize: 13,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    borderRadius: 8,
    padding: 13,
    width: "100%",
    marginTop: 6,
  };

  const helperTextStyle = {
    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
    fontSize: 12,
    color: "#666",
    textAlign: "center" as const,
    marginBottom: 14,
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
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
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
            Reset Password
          </div>
        </div>

        <div style={{ marginTop: 44, width: "100%", maxWidth: 360 }}>
          {formError && (
            <div
              style={{
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                fontSize: 13,
                color: "#E8503A",
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              {formError}
            </div>
          )}

          {checking && <div style={helperTextStyle}>Verifying your reset link…</div>}

          {!checking && linkError && (
            <div style={{ textAlign: "center" }}>
              <div style={{ ...helperTextStyle, color: "#E8503A" }}>
                This reset link is invalid or has expired.
              </div>
              <a
                href="/login"
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 13,
                  color: "#4a8fd3",
                  textDecoration: "none",
                }}
              >
                ← Back to login
              </a>
            </div>
          )}

          {!checking && ready && (
            <form onSubmit={handleSubmit}>
              <div style={{ ...helperTextStyle, color: "#FEFCF9" }}>
                Choose a new password.
              </div>

              <input
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 11,
                  color: passwordLongEnough ? "#4a8fd3" : "#666",
                  marginBottom: 12,
                  marginLeft: 4,
                }}
              >
                {passwordLongEnough ? "✓ " : ""}Minimum 8 characters.
              </div>

              <input
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={inputStyle}
              />
              {confirm.length > 0 && (
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 11,
                    color: passwordsMatch ? "#4a8fd3" : "#E8503A",
                    marginBottom: 12,
                    marginLeft: 4,
                  }}
                >
                  {passwordsMatch ? "✓ Passwords match." : "Passwords don't match."}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                style={{
                  ...buttonBaseStyle,
                  ...(canSubmit ? activeButtonStyle : disabledButtonStyle),
                }}
              >
                {submitting ? "Saving…" : "Set New Password"}
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

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
