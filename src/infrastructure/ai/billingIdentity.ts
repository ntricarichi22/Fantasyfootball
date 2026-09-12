export function resolveAiBillingUserId(
  authenticatedUserId: string,
  background: boolean,
  configuredBackgroundUserId?: string,
) {
  return background ? configuredBackgroundUserId : authenticatedUserId;
}
