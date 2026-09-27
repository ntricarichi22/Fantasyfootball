"use client";
import { Minus, Plus } from "lucide-react";
import { Crest } from "./UI";
import { teams, type Transaction, type TransactionAsset } from "./model";
import s from "./Prototype.module.css";

function Assets({
  items,
  outgoing,
}: {
  items: TransactionAsset[];
  outgoing?: boolean;
}) {
  const Icon = outgoing ? Minus : Plus;
  return (
    <div className={s.historyAssets}>
      {items.length ? (
        items.map((a, i) => (
          <div key={a.name + i}>
            <Icon
              size={15}
              aria-label={outgoing ? "Drop or send" : "Add or receive"}
            />
            <span>
              <strong>{a.name}</strong>
              {a.meta && <small>{a.meta}</small>}
            </span>
          </div>
        ))
      ) : (
        <span className={s.historyDash}>—</span>
      )}
    </div>
  );
}
export function TransactionHistory({ list }: { list: Transaction[] }) {
  return (
    <div className={s.historyScroll}>
      <table className={s.historyTable}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type / Partner</th>
            <th>Add / Receive</th>
            <th>Drop / Send</th>
            <th>Salary cap</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => {
            const success = ["Accepted", "Successful", "Completed"].includes(
              t.status,
            );
            const outcome =
              t.type === "Waiver"
                ? ((
                    {
                      Successful: "Successful",
                      Lost: "Outbid",
                      Withdrawn: "Cancelled",
                    } as Record<string, string>
                  )[t.status] ?? t.status)
                : t.type === "Trade" &&
                    ["Rejected", "Withdrawn"].includes(t.status)
                  ? `${t.status === "Rejected" ? "Declined" : "Withdrawn"} by ${t.actor ?? t.partner ?? "you"}`
                  : t.status;
            const team = teams.find((team) => team.name === t.partner);
            return (
              <tr key={t.id} className={s.historyRow}>
                <td>
                  <time>{t.date}</time>
                </td>
                <td>
                  <div className={s.historyType}>
                    <span>
                      <strong>
                        {t.type === "Waiver" ? "Waiver claim" : t.type}
                      </strong>
                      {t.partner && (
                        <small>
                          {team && (
                            <Crest
                              name={team.name}
                              crest={team.crest}
                              size={20}
                            />
                          )}
                          with {t.partner}
                        </small>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  <Assets items={t.received ?? []} />
                </td>
                <td>
                  <Assets items={t.sent ?? []} outgoing />
                </td>
                <td>
                  <span className={s.historyAmount}>
                    {t.bid !== undefined ? `$${t.bid}` : "—"}
                    {t.bid !== undefined && (
                      <small>{success ? "spent" : "bid"}</small>
                    )}
                  </span>
                </td>
                <td>
                  <span className={s.historyOutcome} data-success={success}>
                    {outcome}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
