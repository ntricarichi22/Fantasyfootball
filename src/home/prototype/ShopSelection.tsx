"use client";
import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { useDemo } from "./DemoState";
import { lineupSlots } from "./leagueFixture";
import { previewPicks, assetDisplayName } from "./pickAssets";
import { Portrait, SectionLabel, Tabs } from "./UI";
import type { Player } from "./model";
import s from "./Prototype.module.css";

export function ShopSelection() {
  const demo = useDemo();
  const [tab, setTab] = useState("Players");
  const picks = previewPicks();
  const selected = demo.shopSelection;
  function toggle(id: string) {
    demo.setShopSelection((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  }
  function playerRow(p: Player, label?: string) {
    return (
      <div key={p.id} className={s.shopRosterEntry}>
        {label && <b className={s.shopSlot}>{label}</b>}
        <button
          className={s.shopRosterPlayer}
          aria-pressed={selected.includes(p.id)}
          onClick={() => toggle(p.id)}
        >
          <Portrait id={p.id} name={p.name} />
          <span>
            <strong>{p.name}</strong>
            <small>
              {p.position} · {p.team}
            </small>
          </span>
          <span className={s.checkBox}>
            {selected.includes(p.id) && <Check size={13} />}
          </span>
        </button>
      </div>
    );
  }
  return (
    <div
      className={s.shopSelection}
      style={{ "--shop-slot-count": lineupSlots.length } as CSSProperties}
    >
      <Tabs
        label="Shop asset group"
        options={["Players", "Picks"]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Players" ? (
        <div className={s.shopRosterGrid}>
          <section data-roster-group="starters">
            <SectionLabel title="Starters" />
            <div className={s.shopRosterRows}>
              {lineupSlots.map((slot) => {
                const p = demo.players.find(
                  (p) => p.group === "Starters" && p.slot === slot.id,
                );
                return p ? (
                  playerRow(p, slot.label)
                ) : (
                  <div key={slot.id} className={s.shopEmptySlot}>
                    {slot.label} · Open spot
                  </div>
                );
              })}
            </div>
          </section>
          <section data-roster-group="subs">
            <SectionLabel title="Subs" />
            <div className={s.shopRosterRows}>
              {demo.players
                .filter((p) => p.group === "Subs")
                .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
                .map((p) => playerRow(p, String(p.rank ?? "")))}
            </div>
          </section>
          <div className={s.shopReserveColumn}>
            <section>
              <SectionLabel title="IR" />
              <div className={s.shopRosterRows}>
                {demo.players
                  .filter((p) => p.group === "IR")
                  .map((p) => playerRow(p))}
              </div>
            </section>
            <section>
              <SectionLabel title="Practice Squad" />
              <div className={s.shopRosterRows}>
                {demo.players
                  .filter((p) => p.group === "Practice Squad")
                  .map((p) => playerRow(p))}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className={s.shopPickGrid}>
          {[1, 2, 3].map((round) => (
            <section key={round}>
              <SectionLabel
                title={`${round}${round === 1 ? "st" : round === 2 ? "nd" : "rd"} round`}
              />
              <div className={s.shopPickRows}>
                {picks
                  .filter((p) => p.round === round)
                  .sort((a, b) => a.season - b.season)
                  .map((p) => (
                    <button
                      key={p.id}
                      className={s.shopPickRow}
                      aria-pressed={selected.includes(p.id)}
                      onClick={() => toggle(p.id)}
                    >
                      <span className={s.assetToken}>RD {round}</span>
                      <span>
                        <strong>{assetDisplayName(p)}</strong>
                      </span>
                      <span className={s.checkBox}>
                        {selected.includes(p.id) && <Check size={13} />}
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
