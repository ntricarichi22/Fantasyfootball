export function selectMailpitMessage(payload, recipient) {
  const messages = Array.isArray(payload) ? payload : payload?.messages;
  if (!Array.isArray(messages)) return null;
  const normalized = recipient.toLowerCase();
  return messages.find((message) => {
    const recipients = [...(message.To ?? []), ...(message.Cc ?? []), ...(message.Bcc ?? [])];
    return recipients.some((entry) => String(entry?.Address ?? entry?.address ?? "").toLowerCase() === normalized)
      && /confirm/i.test(String(message.Subject ?? message.subject ?? ""));
  }) ?? null;
}

export function extractMailpitVerificationUrl(message) {
  const content = `${message?.HTML ?? message?.html ?? message?.Text ?? message?.text ?? ""}`
    .replaceAll("&amp;", "&");
  return content.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0] ?? null;
}
