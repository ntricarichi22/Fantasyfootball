"use client";

import { useEffect, useState } from "react";

type InsiderItem = {
  type: "done_deal" | "active_talks" | "on_the_block" | "multiple_calls";
  headline: string;
  timestamp: string;
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  done_deal: { label: "Done deal", color: "#E8503A" },
  active_talks: { label: "Active talks", color: "#F5C230" },
  on_the_block: { label: "On the block", color: "#F5C230" },
  multiple_calls: { label: "Multiple calls", color: "#3366CC" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function renderHeadline(headline: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = headline;
  let keyIdx = 0;

  while (remaining.length > 0) {
    const boldStart = remaining.indexOf("**");
    if (boldStart === -1) {
      parts.push(remaining);
      break;
    }
    if (boldStart > 0) {
      parts.push(remaining.slice(0, boldStart));
    }
    const boldEnd = remaining.indexOf("**", boldStart + 2);
    if (boldEnd === -1) {
      parts.push(remaining);
      break;
    }
    const boldText = remaining.slice(boldStart + 2, boldEnd);
    parts.push(
      <strong key={keyIdx++} style={{ color: "#fff" }}>
        {boldText}
      </strong>
    );
    remaining = remaining.slice(boldEnd + 2);
  }

  return parts;
}

export default function InsiderPanel() {
  const [items, setItems] = useState<InsiderItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/inbox/insider");
        if (!res.ok) throw new Error("Failed");
        const json = await res.json();
        if (!cancelled) setItems(json.items ?? []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      style={{
        background: "#1A1A1A",
        borderLeft: "2.5px solid #1A1A1A",
        borderRight: "2.5px solid #1A1A1A",
        borderBottom: "2.5px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {loading && (
          <div
            style={{
              fontSize: 10,
              color: "#8C7E6A",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              padding: "8px 0",
            }}
          >
            Loading intel…
          </div>
        )}

        {!loading && items.length === 0 && (
          <div
            style={{
              fontSize: 10,
              color: "#8C7E6A",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              padding: "8px 0",
            }}
          >
            The league is quiet. For now.
          </div>
        )}

        {items.map((item, idx) => {
          const typeInfo = TYPE_LABELS[item.type] ?? { label: item.type, color: "#8C7E6A" };
          return (
            <div key={`${item.type}-${idx}`}>
              {idx > 0 && (
                <div
                  style={{
                    height: 0,
                    borderBottom: "1px solid #333",
                    marginBottom: 12,
                  }}
                />
              )}
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: typeInfo.color,
                    fontWeight: 700,
                    marginBottom: 3,
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {typeInfo.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.8)",
                    lineHeight: 1.45,
                    fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  {renderHeadline(item.headline)}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    fontSize: 8,
                    color: "#8C7E6A",
                    marginTop: 3,
                  }}
                >
                  {timeAgo(item.timestamp)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
