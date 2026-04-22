"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/lib/hooks/useIdentity";
import { LEAGUE_ID } from "@/lib/config";
import OnboardingWelcome from "@/components/onboarding/OnboardingWelcome";
import OnboardingAttachment from "@/components/onboarding/OnboardingAttachment";
import OnboardingWantsMore from "@/components/onboarding/OnboardingWantsMore";
import OnboardingPosture from "@/components/onboarding/OnboardingPosture";

export default function OnboardingPage() {
  const router = useRouter();
  const identity = useIdentity();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const [wantsMore, setWantsMore] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !identity) {
      router.replace("/login");
    }
  }, [mounted, identity, router]);

  if (!identity) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F5F0E6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      />
    );
  }

  if (step === 0) {
    return (
      <OnboardingWelcome
        onComplete={() => setStep(1)}
        teamName={identity.teamName}
      />
    );
  }
  if (step === 1) {
    return (
      <OnboardingAttachment
        onBack={() => setStep(0)}
        onComplete={() => setStep(2)}
        rosterId={identity.rosterId}
        leagueId={LEAGUE_ID}
      />
    );
  }
  if (step === 2) {
    return (
      <OnboardingWantsMore
        onBack={() => setStep(1)}
        onComplete={(wants) => {
          setWantsMore(wants);
          setStep(3);
        }}
      />
    );
  }
  return (
    <OnboardingPosture
      onBack={() => setStep(2)}
      wantsMore={wantsMore}
      identity={identity}
    />
  );
}
