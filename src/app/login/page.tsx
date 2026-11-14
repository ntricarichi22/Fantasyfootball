"use client";

import { Suspense, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { finalizeLeagueSession, listLeagueChoices, type LeagueChoice } from "@/infrastructure/identity/leagueSelection";
import { LeagueChoiceList } from "@/shared/ui/LeagueSwitcher";
import { supabase } from "@/infrastructure/supabase/client";

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

type Step = "email" | "new-password" | "existing-password";

const subscribeToHydration = () => () => {};

function LoginForm() {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const searchParams = useSearchParams();
  const [leagues, setLeagues] = useState<LeagueChoice[] | null>(null);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const signIn = async (identifier: string, secret: string) => {
    if (!supabase) throw new Error("client_unavailable");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier, password: secret }),
    });
    const result = await response.json();
    if (!response.ok || !result.accessToken || !result.refreshToken) return false;
    const { error } = await supabase.auth.setSession({
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    });
    return !error;
  };

  const handleEmailSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setFormError("");
    setStep("existing-password");
  };

  const finalizeAndRedirect = async (leagueId?: string) => {
    const result = await finalizeLeagueSession(leagueId);
    if (result.leagues) { setLeagues(result.leagues); setSubmitting(false); return; }
    window.location.href = result.redirect ?? "/";
  };

  useEffect(() => {
    if (searchParams.get("selectLeague") !== "1") return;
    let cancelled = false;
    listLeagueChoices().then(choices => { if (!cancelled) setLeagues(choices); }).catch(() => {});
    return () => { cancelled = true; };
  }, [searchParams]);

  const handleNewPasswordSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const trimmed = email.trim().toLowerCase();
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      // Create an invited account only after mailbox confirmation.
      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, password }),
      });
      const signupJson = await signupRes.json();
      if (!signupRes.ok) {
        setFormError(
          signupJson?.error === "password_too_short"
            ? "Password must be at least 8 characters."
            : "Unable to create your account. Please try again."
        );
        setSubmitting(false);
        return;
      }

      if (signupJson?.confirmationRequired) {
        setFormError("If this address is invited, check your email to verify the account, then return here to sign in.");
        setStep("existing-password");
        setSubmitting(false);
        return;
      }

      // Sign in with the newly-created credentials
      if (!(await signIn(trimmed, password))) {
        setFormError("Account created but sign-in failed. Please try signing in.");
        setSubmitting(false);
        return;
      }

      await finalizeAndRedirect();
    } catch {
      setFormError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const handleExistingPasswordSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const trimmed = email.trim().toLowerCase();
    if (!password) {
      setFormError("Enter your password.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      if (!(await signIn(trimmed, password))) {
        setFormError("Unable to sign in. Check your email and password.");
        setSubmitting(false);
        return;
      }
      await finalizeAndRedirect();
    } catch {
      setFormError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || resetSending) return;
    if (!supabase) {
      setFormError("Something went wrong. Please try again.");
      return;
    }
    setResetSending(true);
    setFormError("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/reset`,
      });
      if (error) {
        setFormError("Couldn't send a reset link. Please try again.");
        setResetSending(false);
        return;
      }
      setResetSent(true);
      setResetSending(false);
    } catch {
      setFormError("Couldn't send a reset link. Please try again.");
      setResetSending(false);
    }
  };

  const hasEmail = email.trim().length > 0;
  const hasPassword = password.length > 0;
  const passwordLongEnough = password.length >= 8;

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
            Members Only
          </div>
        </div>

        <div style={{ marginTop: 44, width: "100%", maxWidth: 360 }}>
          <Suspense fallback={null}>
            <LoginErrorMessage />
          </Suspense>

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

          {leagues && <LeagueChoiceList leagues={leagues} busy={submitting} onChoose={async leagueId => {
            setSubmitting(true); setFormError("");
            try { await finalizeAndRedirect(leagueId); }
            catch { setFormError("Unable to select this league. Please try again."); setSubmitting(false); }
          }} />}
          {!leagues && step === "email" && (
            <form onSubmit={handleEmailSubmit}>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 12,
                  color: "#666",
                  textAlign: "center",
                  marginBottom: 14,
                }}
              >
                Enter your email to continue.
              </div>

              <input
                type="email"
                disabled={!hydrated}
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />

              <button
                type="submit"
                disabled={!hasEmail || submitting}
                style={{
                  ...buttonBaseStyle,
                  ...(hasEmail ? activeButtonStyle : disabledButtonStyle),
                }}
              >
                Continue
              </button>
            </form>
          )}

          {!leagues && step === "new-password" && (
            <form onSubmit={handleNewPasswordSubmit}>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 12,
                  color: "#FEFCF9",
                  textAlign: "center",
                  marginBottom: 6,
                }}
              >
                Create a password for your invited account.
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 11,
                  color: "#666",
                  textAlign: "center",
                  marginBottom: 14,
                }}
              >
                {email.trim().toLowerCase()}
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

              <button
                type="submit"
                disabled={!passwordLongEnough || submitting}
                style={{
                  ...buttonBaseStyle,
                  ...(passwordLongEnough ? activeButtonStyle : disabledButtonStyle),
                }}
              >
                {submitting ? "Creating…" : "Create Account"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setPassword("");
                  setFormError("");
                  setResetSent(false);
                  setResetSending(false);
                }}
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

          {!leagues && step === "existing-password" && (
            <form onSubmit={handleExistingPasswordSubmit}>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 12,
                  color: "#FEFCF9",
                  textAlign: "center",
                  marginBottom: 6,
                }}
              >
                Enter your password to sign in.
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  fontSize: 11,
                  color: "#666",
                  textAlign: "center",
                  marginBottom: 14,
                }}
              >
                {email.trim().toLowerCase()}
              </div>

              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />

              <button
                type="submit"
                disabled={!hasPassword || submitting}
                style={{
                  ...buttonBaseStyle,
                  ...(hasPassword ? activeButtonStyle : disabledButtonStyle),
                }}
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>

              <button
                type="button"
                onClick={() => { setStep("new-password"); setPassword(""); setFormError(""); }}
                style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", marginTop: 16, width: "100%", textDecoration: "underline" }}
              >
                Create an invited account
              </button>

              {resetSent ? (
                <div
                  style={{
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 12,
                    color: "#4a8fd3",
                    textAlign: "center",
                    marginTop: 16,
                    lineHeight: 1.5,
                  }}
                >
                  Reset link sent to {email.trim().toLowerCase()}.
                  <br />
                  Check your inbox (and spam folder).
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetSending}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#888",
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                    fontSize: 12,
                    cursor: resetSending ? "default" : "pointer",
                    marginTop: 16,
                    width: "100%",
                    textAlign: "center",
                    textDecoration: "underline",
                  }}
                >
                  {resetSending ? "Sending…" : "Forgot password?"}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setPassword("");
                  setFormError("");
                  setResetSent(false);
                  setResetSending(false);
                }}
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
