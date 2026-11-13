import { HYPE_ZEC_LONG_POLICY } from "./hypeZecLongPolicy";
import { HYPE_TREND_LONG_POLICY } from "./hypeTrendLongPolicy";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "./integratedProductionRiskPolicy";
import { DISDEX_STABLE4_OPPORTUNITY, assertStable4GlobalLiveAck, resolveDisDexStable4Mode, type DisDexStable4Mode } from "./disdexStable4Opportunity";

export type HypeZecLongMode = "LIVE" | "SHADOW" | "PAPER";

export interface HypeZecLongRuntime {
  mode: HypeZecLongMode;
  enabled: boolean;
  liveExecutionEnabled: boolean;
  productionConfigLiveEnabled: boolean;
  operatorArmed: boolean;
  runtimeSha: string;
  statePath: string;
  pendingExposurePath: string;
  sharedRiskPath: string;
  maximumGross: number;
  maximumReductionFraction: number;
  hypeRiskPct: number;
  zecRiskPct: number;
  maximumEntryDelayMs: number;
  maximumSlippageBps: number;
  feeBpsPerSide: number;
  fundingBps: number;
  cryptoGrossCap: number;
  totalGrossCap: number;
  signalMode: "LEGACY" | "TREND" | "STABLE4";
  stable4Mode?: DisDexStable4Mode;
  symbols: ReadonlyArray<"HYPEUSDT" | "ZECUSDT">;
}

function bool(value: unknown, fallback = false) {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mode(value: unknown): HypeZecLongMode {
  const normalized = String(value || "SHADOW").trim().toUpperCase();
  return normalized === "LIVE" || normalized === "PAPER" ? normalized : "SHADOW";
}

function signalMode(value: unknown): "LEGACY" | "TREND" | "STABLE4" {
  const normalized=String(value || "LEGACY").trim().toUpperCase();
  return normalized==="STABLE4"?"STABLE4":normalized==="TREND"?"TREND":"LEGACY";
}

function symbols(value: unknown): ReadonlyArray<"HYPEUSDT" | "ZECUSDT"> {
  const parsed = String(value || "HYPEUSDT,ZECUSDT")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is "HYPEUSDT" | "ZECUSDT" => item === "HYPEUSDT" || item === "ZECUSDT");
  return parsed.length > 0 ? [...new Set(parsed)] : ["HYPEUSDT", "ZECUSDT"];
}

export function resolveHypeZecLongRuntime(env: NodeJS.ProcessEnv = process.env): HypeZecLongRuntime {
  const resolvedSignalMode = signalMode(env.DISDEX_HYPE_ZEC_SIGNAL_MODE);
  const stable4Mode = resolveDisDexStable4Mode(env);
  return {
    mode: mode(env.DISDEX_HYPE_ZEC_MODE),
    enabled: bool(env.DISDEX_HYPE_ZEC_ENABLED, false),
    liveExecutionEnabled: bool(env.DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED, false),
    productionConfigLiveEnabled: bool(env.DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED, false),
    operatorArmed: bool(env.DISDEX_HYPE_ZEC_OPERATOR_ARMED, false),
    runtimeSha: String(env.DISDEX_HYPE_ZEC_RUNTIME_SHA || env.DISDEX_RELEASE_SHA || env.DISDEX_RUNTIME_COMMIT_SHA || "").trim().toLowerCase(),
    statePath: String(env.DISDEX_HYPE_ZEC_STATE_PATH || "/var/lib/disdex/hype-zec-long/runner.json"),
    pendingExposurePath: String(env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH || "/var/lib/disdex/shared/pending-exposure.json"),
    sharedRiskPath: String(env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json"),
    maximumGross: Math.max(0, number(env.DISDEX_HYPE_ZEC_MAX_GROSS,
      resolvedSignalMode === "STABLE4" ? DISDEX_STABLE4_OPPORTUNITY.hype.gross
      : resolvedSignalMode === "TREND" ? HYPE_TREND_LONG_POLICY.maximumGross
      : HYPE_ZEC_LONG_POLICY.HYPE_LONG.maximumGross)),
    maximumReductionFraction: HYPE_ZEC_LONG_POLICY.HYPE_LONG.maximumReductionFraction,
    hypeRiskPct: HYPE_ZEC_LONG_POLICY.HYPE_LONG.riskPct,
    zecRiskPct: HYPE_ZEC_LONG_POLICY.ZEC_LONG.riskPct,
    maximumEntryDelayMs: Math.max(1_000, number(env.DISDEX_HYPE_ZEC_MAX_ENTRY_DELAY_MS, 20 * 60_000)),
    maximumSlippageBps: Math.max(0, number(env.DISDEX_HYPE_ZEC_MAX_SLIPPAGE_BPS, 20)),
    feeBpsPerSide: Math.max(0, number(env.DISDEX_HYPE_ZEC_FEE_BPS_PER_SIDE, 4)),
    fundingBps: Math.max(0, number(env.DISDEX_HYPE_ZEC_FUNDING_BPS, 2)),
    cryptoGrossCap: stable4Mode === "LIVE"
      ? DISDEX_STABLE4_OPPORTUNITY.portfolio.cryptoGrossCap
      : INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
    totalGrossCap: stable4Mode === "LIVE"
      ? DISDEX_STABLE4_OPPORTUNITY.portfolio.totalGrossCap
      : INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
    signalMode: resolvedSignalMode,
    stable4Mode,
    symbols: symbols(env.DISDEX_HYPE_ZEC_SYMBOLS || (resolvedSignalMode === "STABLE4" ? "HYPEUSDT" : undefined)),
  };
}

export function assertHypeZecLiveGate(runtime: HypeZecLongRuntime) {
  if (runtime.mode !== "LIVE") return;
  if (!runtime.enabled || !runtime.liveExecutionEnabled || !runtime.productionConfigLiveEnabled || !runtime.operatorArmed) {
    throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:HYPE_ZEC_LONG");
  }
  if (!/^[0-9a-f]{40}$/i.test(runtime.runtimeSha)) throw new Error("HYPE_ZEC_RUNTIME_SHA_REQUIRED");
  const expectedGross = runtime.signalMode === "STABLE4" ? DISDEX_STABLE4_OPPORTUNITY.hype.gross
    : runtime.signalMode === "TREND" ? HYPE_TREND_LONG_POLICY.maximumGross
    : INTEGRATED_PRODUCTION_RISK_POLICY.hypeZecMaximumGross;
  if ((runtime.signalMode === "TREND" || runtime.signalMode === "STABLE4") && (runtime.symbols.length !== 1 || runtime.symbols[0] !== "HYPEUSDT")) throw new Error("HYPE_TREND_SYMBOL_SCOPE_MISMATCH");
  if (runtime.signalMode === "STABLE4") {
    if (runtime.stable4Mode !== "LIVE") throw new Error("HYPE_STABLE4_REQUIRES_STABLE4_LIVE_MODE");
    assertStable4GlobalLiveAck(runtime.stable4Mode,runtime.runtimeSha);
  }
  if (Math.abs(runtime.maximumGross - expectedGross) > 1e-9) throw new Error("HYPE_ZEC_GROSS_CONTRACT_MISMATCH");
  if (Math.abs(runtime.maximumReductionFraction - 0.5) > 1e-9) throw new Error("HYPE_ZEC_REDUCTION_CONTRACT_MISMATCH");
  if (Math.abs(runtime.hypeRiskPct - 5.0) > 1e-9 || Math.abs(runtime.zecRiskPct - 4.5) > 1e-9) throw new Error("HYPE_ZEC_RISK_CONTRACT_MISMATCH");
}
