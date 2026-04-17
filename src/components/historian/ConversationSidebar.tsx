"use client";

import { Plus, Trash2, MessageSquare, X } from "lucide-react";

import { type Conversation, relativeTime } from "./types";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  open: boolean;
  onClose: () => void;
};

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  open,
  onClose,
}: Props) {
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <button
          type="button"
          aria-label="Close conversations"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      <aside
        className={[
          "z-40 flex w-72 flex-none flex-col border-r border-white/5 bg-[#0d0f16] transition-transform duration-200",
          // Mobile: overlay drawer
          "fixed inset-y-0 left-0 md:static md:inset-auto",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          // Hide entirely on desktop when closed
          open ? "md:flex" : "md:hidden",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
            Conversations
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-white/5 hover:text-white md:hidden"
            aria-label="Close conversations"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600/90 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            <Plus className="h-4 w-4" />
            New conversation
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-gray-500">
              No past conversations yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => {
                const active = c.id === activeId;
                return (
                  <li key={c.id}>
                    <div
                      className={[
                        "group flex items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition",
                        active
                          ? "bg-red-600/15 text-white"
                          : "text-gray-300 hover:bg-white/5 hover:text-white",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      >
                        <MessageSquare
                          className={[
                            "mt-0.5 h-4 w-4 flex-none",
                            active ? "text-red-400" : "text-gray-500",
                          ].join(" ")}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.title}</p>
                          <p className="text-[11px] text-gray-500">
                            {relativeTime(c.updatedAt)}
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(c.id);
                        }}
                        className="flex h-7 w-7 flex-none items-center justify-center rounded text-gray-500 opacity-0 transition hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
