export type Quality102CausalV1Mode = "SHADOW" | "PAPER" | "LIVE";

export const QUALITY102_CAUSAL_V1 = Object.freeze({
  strategyId: "QUALITY102_CAUSAL_V1",
  maximumGross: 0.5,
  cryptoGrossCap: 2,
  totalGrossCap: 2.5,
  maximumPositions: 1,
  historicalSelectorParity: false,
  brkEnabled: false,
});

export interface ResolvedQuality102CausalV1Runtime {
  readonly strategyId: typeof QUALITY102_CAUSAL_V1.strategyId;
  readonly mode: Quality102CausalV1Mode;
  readonly enabled: boolean;
  readonly liveTradingEnabled: boolean;
  readonly liveExecutionEnabled: boolean;
  readonly operatorArmed: boolean;
  readonly maximumGross: number;
  readonly cryptoGrossCap: 2;
  readonly totalGrossCap: 2.5;
  readonly maximumPositions: 1;
  readonly historicalSelectorParity: false;
  readonly brkEnabled: false;
}

export function resolveQuality102CausalV1Runtime(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ResolvedQuality102CausalV1Runtime {
  const bool = (name: string) => /^(1|true|yes|on)$/i.test(String(env[name] || ""));
  const rawMode = String(env.QUALITY102_CAUSAL_V1_MODE || "SHADOW").toUpperCase();
  const mode: Quality102CausalV1Mode = rawMode === "LIVE" || rawMode === "PAPER" ? rawMode : "SHADOW";
  const requestedGross = Number(env.QUALITY102_CAUSAL_V1_MAX_GROSS ?? QUALITY102_CAUSAL_V1.maximumGross);
  return {
    strategyId: QUALITY102_CAUSAL_V1.strategyId,
    mode,
    enabled: bool("QUALITY102_CAUSAL_V1_ENABLED"),
    liveTradingEnabled: bool("QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED"),
    liveExecutionEnabled: bool("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED"),
    operatorArmed: bool("QUALITY102_CAUSAL_V1_OPERATOR_ARMED"),
    maximumGross: Math.min(0.5, Math.max(0, Number.isFinite(requestedGross) ? requestedGross : 0.5)),
    cryptoGrossCap: 2,
    totalGrossCap: 2.5,
    maximumPositions: 1,
    historicalSelectorParity: false,
    brkEnabled: false,
  } as const;
}
