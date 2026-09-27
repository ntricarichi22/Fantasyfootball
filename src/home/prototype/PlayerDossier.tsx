"use client";
import { X, ShieldCheck } from "lucide-react";
import { useDemo } from "./DemoState";
import { Portrait } from "./UI";
import {
  priceDollars,
  formatDollars,
  playerMetrics,
  defaultPrice,
  priceText,
  type PickPrice,
} from "./playerMetrics";
import type { Player, Availability } from "./model";
import s from "./Prototype.module.css";

export function PlayerBadges({ player }: { player: Player }) {
  const m = playerMetrics(player);
  return (
    <span className={s.playerBadges}>
      <span className={s.ageNumber}>
        <b>{m.age}</b>
        <small>YRS</small>
      </span>
      <b className={s.qualityChip} data-quality={m.quality}>
        {m.quality}
      </b>
      {m.ageStatus !== "prime" && (
        <b className={s.ageChip} data-age={m.ageStatus}>
          {m.ageStatus}
        </b>
      )}
    </span>
  );
}
export function PriceControls({
  value,
  onChange,
}: {
  value: PickPrice;
  onChange: (next: PickPrice) => void;
}) {
  return (
    <div className={s.priceCounters}>
      {(
        [
          ["firsts", "1sts"],
          ["seconds", "2nds"],
          ["thirds", "3rds"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <span>{label}</span>
          <div>
            <button
              aria-label={"Decrease " + label}
              disabled={value[key] === 0}
              onClick={() =>
                onChange({ ...value, [key]: Math.max(0, value[key] - 1) })
              }
            >
              −
            </button>
            <output aria-label={label + " quantity"}>{value[key]}</output>
            <button
              aria-label={"Increase " + label}
              onClick={() => onChange({ ...value, [key]: value[key] + 1 })}
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
export function PlayerDossier({
  player,
  editable,
}: {
  player: Player;
  editable: boolean;
}) {
  const demo = useDemo(),
    m = playerMetrics(player);
  const price = demo.playerPrices[player.id] ?? defaultPrice(player);
  const metric = (value: string | number, label: string) => (
    <div key={label}>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
  return (
    <>
      <header>
        <span>
          PLAYER DOSSIER <small>· SAMPLE DATA</small>
        </span>
        <button
          aria-label="Close player profile"
          onClick={() => demo.openPlayer(null)}
        >
          <X size={20} />
        </button>
      </header>
      <div className={s.profileHero}>
        <Portrait id={player.id} name={player.name} />
        <div>
          <small>
            {player.position} · {player.team} · {player.condition ?? "Healthy"}
          </small>
          <h2>{player.name}</h2>
          <PlayerBadges player={player} />
        </div>
      </div>
      {editable && (
        <div className={s.profileValuation} aria-live="polite">
          <div>
            <small>YOUR PRIVATE ASKING PRICE</small>
            <strong>{formatDollars(priceDollars(price))}</strong>
          </div>
          <span>{player.availability}</span>
        </div>
      )}
      <section className={s.dossierSection}>
        <h3>
          THIS SEASON <span>2026 · Half PPR</span>
        </h3>
        <div className={s.dossierMetrics}>
          {metric(m.games ? m.seasonPoints : "—", "FANTASY POINTS")}
          {metric(m.games ? m.average : "—", "POINTS / GAME")}
          {metric(
            m.games ? player.position + " " + m.seasonRank : "—",
            "SEASON RANK",
          )}
          {metric(m.games, "GAMES")}
        </div>
        <p>
          {m.games ? m.statLine : "No appearances this season"}
          <span>
            WK 4: {player.opponent} · {player.points.toFixed(1)} projected
          </span>
        </p>
      </section>
      <section className={s.dossierSection}>
        <h3>
          WITH THE {demo.identity.name.toUpperCase()}{" "}
          <span>
            Since {m.joined} · {m.acquisition}
          </span>
        </h3>
        <div className={s.dossierMetrics}>
          {metric(m.franchiseSeasons, "SEASONS ON TEAM")}
          {metric(m.franchiseStarts, "STARTS")}
          {metric(m.franchisePoints, "POINTS AS STARTER")}
          {metric("#" + m.franchiseRank, "TEAM ALL-TIME · " + player.position)}
        </div>
      </section>
      <section className={s.dossierSection}>
        <h3>
          CAREER <span>NFL fantasy production · Half PPR</span>
        </h3>
        <div className={s.careerStrip}>
          <b>
            {m.careerPoints} <small>CAREER POINTS</small>
          </b>
          <b>
            #{m.careerRank}{" "}
            <small>ALL-TIME {player.position} POINTS RANK</small>
          </b>
        </div>
      </section>
      {editable && (
        <section className={s.privateStrategy}>
          <h3>
            <ShieldCheck size={16} /> YOUR PRIVATE VALUATION{" "}
            <small>Saved as you edit</small>
          </h3>
          <div
            className={s.availabilityButtons}
            role="group"
            aria-label="Player availability"
          >
            {(
              [
                "Untouchable",
                "Core piece",
                "Listening",
                "Moveable",
              ] as Availability[]
            ).map((a) => (
              <button
                key={a}
                aria-pressed={player.availability === a}
                onClick={() => demo.editPlayer(player.id, { availability: a })}
              >
                {a}
              </button>
            ))}
          </div>
          <div className={s.priceHeading}>
            <strong>Asking price</strong>
            <span>{priceText(price)}</span>
          </div>
          <PriceControls
            value={price}
            onChange={(next) => {
              demo.setPlayerPrices((old) => ({ ...old, [player.id]: next }));
              demo.editPlayer(player.id, { asking: priceText(next) });
            }}
          />
        </section>
      )}
    </>
  );
}
