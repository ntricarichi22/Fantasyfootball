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
        <span>Processing in</span>
        <span className={s.countdownDigits}>
          {[
            [Math.floor(remaining / 86400), "days"],
            [Math.floor(remaining / 3600) % 24, "hours"],
            [Math.floor(remaining / 60) % 60, "minutes"],
          ].map(([value, label]) => (
            <span key={label}>
              <b>{String(value).padStart(2, "0")}</b>
              <small>{label}</small>
            </span>
          ))}
        </span>
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
