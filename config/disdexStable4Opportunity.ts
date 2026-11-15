export type DisDexStable4Mode = "OFF" | "SHADOW" | "LIVE";

const productionRisk = Object.freeze({ cryptoGrossCap: 3.0, stockGrossCap: 1.5, totalGrossCap: 3.5, sharedDailyLossPct: 7.5 });

export const DISDEX_STABLE4_OPPORTUNITY = Object.freeze({
  name: "STABLE4_OPPORTUNITY",
  researchBranch: "research/q102-hype-idle-reconstruction-20261114",
  productionRisk,
  portfolio: productionRisk,
  pengu: Object.freeze({
    shortV20Btc24hMax: -0.010836782776818987,
    shortV20Pengu72hMax: -0.05237466490617382,
    recoveryV8Btc24hMax: 0.011611625094354983,
  }),
  idle: Object.freeze({ taoRiskOffHours: 12, jupRel24Min: -0.04089204262472046, jupVolumeRatioMin: 1.2568362211142174, renderWait: true }),
  q102: Object.freeze({
    fetRet14Max: 0.048722800378429465, avaxGross: 0.75, avaxPredThreshold: 0.013, avaxAgreementMin: 0.65, avaxK: 40,
    avaxHardStop: 0.05, avaxTakeProfit: 0.03, avaxHoldHours: 24,
    recoveryPredWinMin: 0.60, recoveryPredEv30Min: 0.002, recoveryConfidenceMin: 0.45, recoveryAnalogsMin: 6,
    recoveryRouteCompletedMin: 6, recoveryRouteWinMin: 0.60, recoveryRecentWindows: [5, 6] as const,
    recoveryRecentMeanMin: 0.002, recoveryGrossCap: 1.0,
  }),
  hype: Object.freeze({ gross: 1.0, h12Max: 0.004297852251518686, h24Min: 0.02047426596091347, rel24Max: 0.026202553353817715, holdHours: 48, emergencyStopPct: 0.06, protectionTakeProfitPct: 1.0 }),
});

export function resolveDisDexStable4Mode(env: Partial<NodeJS.ProcessEnv> = process.env): DisDexStable4Mode {
  const raw = String(env.DISDEX_STABLE4_MODE || "OFF").trim().toUpperCase();
  if (raw === "LIVE" || raw === "SHADOW") return raw;
  return "OFF";
}
export function stable4Applies(mode: DisDexStable4Mode) { return mode === "LIVE"; }
export function stable4Observes(mode: DisDexStable4Mode) { return mode === "SHADOW" || mode === "LIVE"; }

export function assertStable4GlobalLiveAck(mode: DisDexStable4Mode, runtimeSha: string, env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (mode !== "LIVE") return;
  const ack = String(env.DISDEX_STABLE4_GLOBAL_LIVE_ACK || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/i.test(runtimeSha) || ack !== runtimeSha.toLowerCase()) throw new Error("DISDEX_STABLE4_GLOBAL_LIVE_ACK_MUST_MATCH_RUNTIME_SHA");
}
