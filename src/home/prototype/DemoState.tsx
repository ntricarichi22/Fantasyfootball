"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  initialPlayers,
  initialTransactions,
  type Player,
  type Transaction,
} from "./model";
import { movePlayer, swapRanks, rankByProjection } from "./coaching";
import type { PickPrice } from './playerMetrics';
export type Claim = {
  id: string;
  playerId: string;
  name: string;
  bid: number;
  drop: string;
};
export type Need = { stance: string; goals: string[] };
function useDemoState() {
  const [players, setPlayers] = useState(initialPlayers);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [needs, setNeeds] = useState<Record<string, Need>>({
    QB: { stance: "Set", goals: [] },
    RB: { stance: "Thin", goals: ["insurance"] },
    "Pass Catchers": { stance: "Deep", goals: ["consolidate"] },
    "Draft Picks": { stance: "Set", goals: [] },
  });
  const [identity, setIdentity] = useState({
    city: "Virginia",
    name: "Founders",
    crest: "founders",
  });
  const [selectedPlayer, openPlayer] = useState<string | null>(null);
  const [toast, notify] = useState("");
  const [phase, setPhase] = useState("WEEK 4");
  const [now, setNow] = useState(-1);
  const [playerPrices, setPlayerPrices] = useState<Record<string, PickPrice>>({});
  const [pickSettings, setPickSettings] = useState<
    Record<string, { availability: string; asking: string }>
  >({});
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const editPlayer = (id: string, changes: Partial<Player>) =>
    setPlayers((old) =>
      old.map((p) => (p.id === id ? { ...p, ...changes } : p)),
    );
  function move(id: string, destination: string) {
    const result = movePlayer(players, id, destination, now);
    if (result.error) {
      notify(result.error);
      return false;
    }
    setPlayers(result.players);
    notify("Lineup updated.");
    return true;
  }
  function reorder(a: string, b: string) {
    setPlayers((old) => swapRanks(old, a, b, now));
  }
  function autoRank() {
    setPlayers((old) => rankByProjection(old, now));
    notify("Unlocked Subs ranked by projections.");
  }
  function addTransaction(item: Omit<Transaction, "id" | "date">) {
    setTransactions((old) => [
      { ...item, id: "demo-" + Date.now(), date: "Just now" },
      ...old,
    ]);
  }
  function cancelClaim(id: string) {
    const claim = claims.find((c) => c.id === id);
    if (!claim) return;
    setClaims((old) => old.filter((c) => c.id !== id));
    addTransaction({
      title: "Claim for " + claim.name,
      detail: "$" + claim.bid + " bid cancelled before processing",
      type: "Waiver",
      status: "Withdrawn",
    });
    notify("Claim cancelled.");
  }
  function scenario(value: number) {
    if (value < now) {
      setPlayers(initialPlayers);
      notify("Sample lineup reset for this earlier scenario.");
    }
    setNow(value);
  }
  return {
    players,
    setPlayers,
    transactions,
    setTransactions,
    identity,
    setIdentity,
    selectedPlayer,
    openPlayer,
    toast,
    notify,
    phase,
    setPhase,
    now,
    scenario,
    editPlayer,
    move,
    reorder,
    autoRank,
    addTransaction,
    claims,
    setClaims,
    cancelClaim,
    needs,
    setNeeds,
    pickSettings,
    setPickSettings,
    playerPrices,
    setPlayerPrices,
  };
}
const DemoContext = createContext<ReturnType<typeof useDemoState> | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  return (
    <DemoContext.Provider value={useDemoState()}>
      {children}
    </DemoContext.Provider>
  );
}
export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw Error("DemoProvider required");
  return value;
}
