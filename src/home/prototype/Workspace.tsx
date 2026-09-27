"use client";
import type { ReactNode } from "react";
import type { FeatureId } from "./model";
import { Lineup, Matchup } from "./CoachWorkspace";
import { Draft, Strategy, Trades, Transactions, Waivers } from "./GMWorkspace";
import {
  Identity,
  LeagueActivity,
  LeagueHistory,
  Meetings,
  Rules,
  Scores,
  Standings,
} from "./OwnerLeagueWorkspace";
import s from "./Prototype.module.css";
export function Workspace({
  feature,
  task,
  navigate,
}: {
  feature: FeatureId | null;
  task: string;
  navigate: (feature: FeatureId) => void;
}) {
  const views: [FeatureId, ReactNode][] = [
    ["matchup", <Matchup key="matchup" onLineup={() => navigate("lineup")} />],
    ["lineup", <Lineup key="lineup" />],
    ["strategy", <Strategy key="strategy" />],
    ["trades", <Trades key="trades" task={task} />],
    ["draft", <Draft key="draft" task={task} />],
    ["waivers", <Waivers key="waivers" />],
    ["transactions", <Transactions key="transactions" />],
    ["rules", <Rules key="rules" task={task} />],
    ["meetings", <Meetings key="meetings" task={task} />],
    ["identity", <Identity key="identity" />],
    ["standings", <Standings key="standings" />],
    ["scores", <Scores key="scores" />],
    ["activity", <LeagueActivity key="activity" />],
    ["history", <LeagueHistory key="history" />],
  ];
  return (
    <>
      {views.map(([id, content]) => (
        <div
          key={id}
          data-review-view={id}
          hidden={feature !== id}
          className={s.view}
        >
          {content}
        </div>
      ))}
    </>
  );
}
