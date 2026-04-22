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

type Step = "email" | "new-password" | "existing-password";

function LoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const handleEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/auth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json?.error === "not_a_member") {
          setFormError("This email isn't registered with the CFC league.");
        } else {
          setFormError("Something went wrong. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      setStep(json.exists ? "existing-password" : "new-password");
      setSubmitting(false);
    } catch {
      setFormError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const finalizeAndRedirect = async () => {
    if (!supabase) throw new Error("client_unavailable");
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
    if (!res.ok) {
      throw new Error(json?.error ?? "finalize_failed");
    }
    window.location.href = json.redirect ?? "/";
  };

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
      // Create the auth user server-side with email_confirm: true
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

      // Sign in with the newly-created credentials
      if (!supabase) throw new Error("client_unavailable");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (signInError) {
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
      if (!supabase) throw new Error("client_unavailable");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (signInError) {
        setFormError("Incorrect password. Please try again.");
        setSubmitting(false);
        return;
      }
      await finalizeAndRedirect();
    } catch {
      setFormError("Something went wrong. Please try again.");
      setSubmitting(false);
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

          {step === "email" && (
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
                {submitting ? "Checking…" : "Continue"}
              </button>
            </form>
          )}

          {step === "new-password" && (
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
                First time here. Create a password.
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
                {submitting ? "Creating…" : "Create & Sign In"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setPassword("");
                  setFormError("");
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

          {step === "existing-password" && (
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
                Welcome back. Enter your password.
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
                onClick={() => {
                  setStep("email");
                  setPassword("");
                  setFormError("");
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
