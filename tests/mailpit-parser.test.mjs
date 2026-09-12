import assert from "node:assert/strict";
import test from "node:test";
import { extractMailpitVerificationUrl, selectMailpitMessage } from "../scripts/lib/mailpit.mjs";

const recipient = "synthetic@example.invalid";
const list = { total: 1, messages: [{ ID: "fixture-id", Subject: "Confirm Your Signup",
  To: [{ Name: "Synthetic", Address: recipient }] }] };

test("selects the supported Mailpit v1 message shape by synthetic recipient", () => {
  assert.equal(selectMailpitMessage(list, recipient)?.ID, "fixture-id");
  assert.equal(selectMailpitMessage(list, "other@example.invalid"), null);
});

test("extracts a confirmation URL from the supported Mailpit message shape", () => {
  const url = extractMailpitVerificationUrl({ HTML:
    '<a href="http://127.0.0.1:54321/auth/v1/verify?token=fixture&amp;type=signup">Confirm</a>' });
  assert.equal(url, "http://127.0.0.1:54321/auth/v1/verify?token=fixture&type=signup");
  assert.equal(extractMailpitVerificationUrl({ Text: "no link" }), null);
});
