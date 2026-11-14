import assert from "node:assert/strict";
import { test } from "node:test";
import { browserStorageScope, browserStorageKey, readBrowserJson, writeBrowserJson } from "../src/infrastructure/identity/browserStorage.ts";
import { historianReducer, type HistorianState } from "../src/historian/state.ts";
import { conversationStorageKey, loadConversations, saveConversations } from "../src/historian/types.ts";

function installStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage, sessionStorage: storage }, configurable: true,
  });
  return { values, storage };
}

test("historian history is isolated by user and league and retains unattributed legacy data", () => {
  const { values } = installStorage();
  const conversations = [{ id: "chat-a", title: "Private question", updatedAt: "2026-11-14", messages: [] }];
  try {
    values.set("cfc_historian_conversations_v1", JSON.stringify(conversations));
    assert.deepEqual(loadConversations("league:user-b"), []);
    saveConversations("league:user-a", conversations);
    assert.deepEqual(loadConversations("league:user-a"), conversations);
    assert.deepEqual(loadConversations("league:user-b"), []);
    assert.deepEqual(loadConversations("other-league:user-a"), []);
    assert.ok(values.has("cfc_historian_conversations_v1"));
    values.set(conversationStorageKey("league:user-a")!, JSON.stringify([{ ...conversations[0], messages: [null] }]));
    assert.deepEqual(loadConversations("league:user-a"), []);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("late historian replies stay in their original chat and cannot resurrect deleted chats", () => {
  const initial: HistorianState = { conversations: [], activeId: null, hydrated: false };
  let state = historianReducer(initial, { type: "hydrate", conversations: [] });
  assert.equal(state.hydrated, true);
  const message = { id: "q", role: "user" as const, content: "Question", timestamp: "2026-11-14T10:00:00Z" };
  state = historianReducer(state, { type: "appendMessage", conversationId: "a", message });
  state = historianReducer(state, { type: "appendMessage", conversationId: "b", message: { ...message, id: "q-b" } });
  const reply = { ...message, id: "reply", role: "assistant" as const, content: "Answer" };
  state = historianReducer(state, { type: "appendMessage", conversationId: "a", message: reply });
  assert.equal(state.activeId, "b");
  assert.equal(state.conversations.find((c) => c.id === "a")?.messages.length, 2);
  assert.equal(state.conversations.find((c) => c.id === "b")?.messages.length, 1);
  state = historianReducer(state, { type: "delete", id: "a" });
  assert.equal(historianReducer(state, { type: "appendMessage", conversationId: "a", message: reply }), state);
});

test("browser caches separate accounts, leagues, and features and handle blocked storage", () => {
  const { values, storage } = installStorage();
  try {
    const accountA = browserStorageScope({ userId: "user:a", leagueId: "league" });
    const accountB = browserStorageScope({ userId: "user:b", leagueId: "league" });
    const leagueB = browserStorageScope({ userId: "user:a", leagueId: "other" });
    const key = browserStorageKey("trade-seed", accountA);
    writeBrowserJson("sessionStorage", key, { private: true });
    assert.deepEqual(readBrowserJson("sessionStorage", key), { private: true });
    assert.equal(readBrowserJson("sessionStorage", browserStorageKey("trade-seed", accountB)), null);
    assert.equal(readBrowserJson("sessionStorage", browserStorageKey("trade-seed", leagueB)), null);
    assert.equal(readBrowserJson("sessionStorage", browserStorageKey("lineup", accountA)), null);
    assert.equal(browserStorageKey("trade-seed", null), null);
    assert.notEqual(browserStorageScope({ userId: "a:b", leagueId: "c" }), browserStorageScope({ userId: "b", leagueId: "c:a" }));
    values.set(key!, "corrupt json");
    assert.equal(readBrowserJson("sessionStorage", key), null);
    storage.getItem = () => { throw new Error("disabled"); };
    storage.setItem = () => { throw new Error("quota"); };
    assert.equal(readBrowserJson("localStorage", key), null);
    assert.doesNotThrow(() => writeBrowserJson("localStorage", key, {}));
  } finally { Reflect.deleteProperty(globalThis, "window"); }
});
