"use client";
import { useEffect, useState } from "react";
import { demoLeague } from "./leagueFixture";
import s from "./Prototype.module.css";
export function WaiverHeader() {
  const [remaining, setRemaining] = useState(2 * 86400 + 13 * 3600 + 45 * 60);
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining((v) => Math.max(0, v - 60)),
      60000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <span className={s.waiverCountdown}>
        Processing in{" "}
        <b>
          {Math.floor(remaining / 86400)}d {Math.floor(remaining / 3600) % 24}h{" "}
          {Math.floor(remaining / 60) % 60}m
        </b>
        <small>Sample clock</small>
      </span>
      <span className={s.waiverHeaderCap}>
        <strong>
          ${demoLeague.salaryCapRemaining}
          <span> / ${demoLeague.salaryCap}</span>
        </strong>
        <small>Salary cap remaining</small>
      </span>
    </>
  );
}
