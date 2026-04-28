"use client";

import { useEffect, useState } from "react";
import DraftRoom from "../../page";
import DraftCompleteModal from "../../../components/DraftCompleteModal";

export default function DraftPage() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasIdentity = document.cookie
      .split("; ")
      .some((row) => row.startsWith("cfc_identity="));
    if (!hasIdentity) {
      window.location.href = "/";
      return;
    }
    setAllowed(true);
  }, []);

  if (!allowed) return null;
  return (
    <>
      <DraftRoom />
      <DraftCompleteModal />
    </>
  );
}
