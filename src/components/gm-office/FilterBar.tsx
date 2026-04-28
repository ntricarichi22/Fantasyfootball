"use client";

type FilterValue = "all" | "open" | "closed";

type Props = {
  active: FilterValue;
  onFilterChange: (value: FilterValue) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
};

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

export type { FilterValue };

export default function FilterBar({ active, onFilterChange, searchTerm, onSearchChange }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {FILTERS.map((f) => {
          const isActive = active === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilterChange(f.value)}
              style={{
                padding: "6px 12px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                background: isActive ? "#1A1A1A" : "#FEFCF9",
                color: isActive ? "#F5C230" : "#1A1A1A",
                border: "2px solid #1A1A1A",
                cursor: "pointer",
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        placeholder="Search players, teams…"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{
          border: "2px solid #1A1A1A",
          padding: "5px 10px",
          fontSize: 11,
          color: "#1A1A1A",
          flex: 1,
          maxWidth: 200,
          background: "#FEFCF9",
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          outline: "none",
        }}
      />
    </div>
  );
}
