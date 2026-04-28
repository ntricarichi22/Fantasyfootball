"use client";

import type { ReactNode, CSSProperties } from "react";

type Props = {
  label: string;
  title: string;
  children: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
};

export default function Card({ label, title, children, right, style }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "2.5px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        background: "#FEFCF9",
        ...style,
      }}
    >
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: "2px solid #1A1A1A",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 8,
              color: "#8C7E6A",
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 3,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 900,
              fontSize: 14,
              color: "#1A1A1A",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {title}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
