export const authoritativePasswordFailureEvent = (fingerprint: string | null) => ({
  eventType: "authentication_failure" as const,
  severity: "warning" as const,
  outcome: "failure" as const,
  source: "password_login",
  fingerprint,
  summary: { reason: "credentials_rejected" },
});
