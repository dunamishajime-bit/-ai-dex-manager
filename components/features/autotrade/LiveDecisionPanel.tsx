"use client";

import { CurrentStrategyStatus } from "@/components/features/strategy/CurrentStrategyStatus";

export function LiveDecisionPanel({ compact = false }: { compact?: boolean }) {
  return <CurrentStrategyStatus compact={compact} />;
}

