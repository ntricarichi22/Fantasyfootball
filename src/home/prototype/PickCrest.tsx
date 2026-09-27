"use client";
import { useDemo } from "./DemoState";
import { teams } from "./model";
import { Crest } from "./UI";
import s from "./Prototype.module.css";

export function PickCrest({
  asset,
  owner = "own",
}: {
  asset: { originTeam?: string; meta?: string };
  owner?: string;
}) {
  const { identity } = useDemo();
  const origin =
    asset.originTeam ?? asset.meta?.match(/^\(via (.+)\)$/)?.[1] ?? owner;
  const own = origin === "own";
  const team = teams.find((t) => t.name === origin);
  const name = own ? identity.name : (team?.name ?? origin);
  return (
    <span
      className={s.pickCrest}
      role="img"
      aria-label={`${name} original pick`}
    >
      <Crest name={name} crest={own ? identity.crest : team?.crest} size={28} />
    </span>
  );
}
