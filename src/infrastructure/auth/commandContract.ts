export type CommandEnvelope = { request_id: string; expected_revision: number };
export const commandEnvelope = (body: Record<string, unknown>): CommandEnvelope | null =>
  typeof body.request_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id) &&
  Number.isSafeInteger(body.expected_revision) && Number(body.expected_revision) >= 0
    ? { request_id: body.request_id, expected_revision: Number(body.expected_revision) } : null;
