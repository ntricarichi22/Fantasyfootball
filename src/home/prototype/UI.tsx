"use client";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, UserRound } from "lucide-react";
import s from "./Prototype.module.css";
export function Tabs({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className={s.subTabs} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
export function Crest({
  crest,
  name,
  size = 36,
}: {
  crest?: string;
  name: string;
  size?: number;
}) {
  return crest ? (
    <Image src={"/teams/" + crest + ".png"} alt="" width={size} height={size} />
  ) : (
    <span className={s.letterCrest}>{name.slice(0, 1)}</span>
  );
}
export function Portrait({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState(false);
  return (
    <span className={s.portrait}>
      {error || id.startsWith("rookie") ? (
        <UserRound aria-label={name} size={22} />
      ) : (
        <Image
          src={"/ui-refresh/players/" + id + ".webp"}
          alt=""
          fill
          sizes="64px"
          unoptimized
          onError={() => setError(true)}
        />
      )}
    </span>
  );
}
export function SectionLabel({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.sectionLabel}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  if (total <= size) return null;
  return (
    <nav className={s.pagination} aria-label="List pages">
      <button disabled={page === 0} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        {page + 1} / {Math.ceil(total / size)}
      </span>
      <button
        disabled={(page + 1) * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className={s.empty}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
export type Tile = {
  id: string;
  title: string;
  text: string;
  image: string;
  tag?: string;
  disabled?: boolean;
  position?: string;
};
export function TaskTiles({
  tiles,
  onSelect,
  label,
}: {
  tiles: Tile[];
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <div className={s.taskGallery} aria-label={label}>
      {tiles.map((t, i) => (
        <button
          key={t.id}
          className={s.taskTile}
          disabled={t.disabled}
          onClick={() => onSelect(t.id)}
          aria-label={t.title}
          style={
            { "--tile-position": t.position ?? "center" } as React.CSSProperties
          }
        >
          <Image
            src={"/ui-refresh/" + t.image + ".jpg"}
            alt=""
            fill
            sizes="(max-width:760px) 85vw, 30vw"
          />
          <span className={s.tileShade} />
          <span className={s.tileTop}>
            <b>0{i + 1}</b>
            <span>
              {t.disabled ? "COMING SOON" : (t.tag ?? "FRANCHISE HQ")}
            </span>
          </span>
          <span className={s.tileCopy}>
            <strong>{t.title}</strong>
            <small>{t.text}</small>
            <span className={s.tileAction}>
              {t.disabled ? "Draft inactive" : "Enter"}
              <ArrowRight size={18} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
export function EventRow({
  title,
  detail,
  tag,
  children,
}: {
  title: string;
  detail: string;
  tag?: string;
  children?: ReactNode;
}) {
  return (
    <article className={s.event}>
      <ChevronRight size={18} />
      <div>
        {tag && <small>{tag}</small>}
        <h3>{title}</h3>
        <p>{detail}</p>
        {children}
      </div>
    </article>
  );
}
