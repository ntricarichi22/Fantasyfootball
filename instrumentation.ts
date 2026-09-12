import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The persistence clients use Node crypto. Edge errors remain available in the
  // hosting logs until a separately reviewed edge-safe transport is configured.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ recordSecurityEvent }, { sendSecurityAlert }] = await Promise.all([
    import("./src/infrastructure/security/audit"),
    import("./src/infrastructure/security/alerts"),
  ]);
  const event = {
    eventType: "application_error" as const,
    severity: "error" as const,
    outcome: "failure" as const,
    source: request.path.slice(0, 120),
    summary: {
      error_type: error instanceof Error ? error.name : "unknown",
      route_type: context.routeType,
      router_kind: context.routerKind,
    },
  };
  await recordSecurityEvent(event);
  await sendSecurityAlert(event, { trusted: true });
};
