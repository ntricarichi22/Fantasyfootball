"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initialPlayers, initialTransactions, type Player, type Transaction } from "./model";

function useDemoState() {
  const [players, setPlayers] = useState(initialPlayers);
  const [direction, setDirection] = useState("Contending");
  const [transactions, setTransactions] = useState(initialTransactions);
  const [identity, setIdentity] = useState({ city: "Virginia", name: "Founders", crest: "founders" });
  const [selectedPlayer, openPlayer] = useState<string | null>(null);
  const [toast, notify] = useState("");
  const [phase, setPhase] = useState("WEEK 4");
  const [rosterGroup, setRosterGroup] = useState("Starters");
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => notify(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const editPlayer = (id: string, changes: Partial<Player>) => setPlayers((old) => old.map((p) => p.id === id ? { ...p, ...changes } : p));
  function startPlayer(id: string, slot: string) {
    setPlayers((old) => old.map((p) => p.id === id ? { ...p, group: "Starters", slot } : p.slot === slot ? { ...p, group: "Bench", slot: undefined } : p));
    notify("Sample lineup updated.");
  }
  function addTransaction(item: Omit<Transaction, "id" | "date">) {
    setTransactions((old) => [{ ...item, id: "demo-" + Date.now(), date: "Just now" }, ...old]);
  }
  return { players, setPlayers, direction, setDirection, transactions, setTransactions, identity, setIdentity, selectedPlayer, openPlayer, toast, notify, phase, setPhase, rosterGroup, setRosterGroup, editPlayer, startPlayer, addTransaction };
}
const DemoContext = createContext<ReturnType<typeof useDemoState> | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) { return <DemoContext.Provider value={useDemoState()}>{children}</DemoContext.Provider>; }
export function useDemo() { const value = useContext(DemoContext); if (!value) throw new Error("DemoProvider is required"); return value; }
