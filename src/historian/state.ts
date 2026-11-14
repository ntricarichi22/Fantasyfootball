import { deriveTitle, type ChatMessage, type Conversation } from "./types.ts";

export type HistorianState = {
  conversations: Conversation[];
  activeId: string | null;
  hydrated: boolean;
};

type Action =
  | { type: "hydrate"; conversations: Conversation[] }
  | { type: "select"; id: string | null }
  | { type: "new" }
  | { type: "delete"; id: string }
  | { type: "appendMessage"; conversationId: string; message: ChatMessage };

const newestFirst = (list: Conversation[]) =>
  [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function historianReducer(state: HistorianState, action: Action): HistorianState {
  switch (action.type) {
    case "hydrate":
      return { conversations: newestFirst(action.conversations), activeId: null, hydrated: true };
    case "select":
      return { ...state, activeId: action.id };
    case "new":
      return { ...state, activeId: null };
    case "delete":
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== action.id),
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    case "appendMessage": {
      const updatedAt = action.message.timestamp;
      if (state.conversations.some((c) => c.id === action.conversationId)) {
        return {
          ...state,
          conversations: newestFirst(state.conversations.map((c) =>
            c.id === action.conversationId
              ? { ...c, updatedAt, messages: [...c.messages, action.message] }
              : c)),
        };
      }
      // A late response must neither resurrect a deleted chat nor enter the selected chat.
      if (action.message.role !== "user") return state;
      return {
        ...state,
        activeId: action.conversationId,
        conversations: newestFirst([{
          id: action.conversationId,
          title: deriveTitle(action.message.content),
          updatedAt,
          messages: [action.message],
        }, ...state.conversations]),
      };
    }
  }
}
