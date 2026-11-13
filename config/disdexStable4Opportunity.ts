export type DisDexStable4Mode = "OFF" | "SHADOW" | "LIVE";

export const DISDEX_STABLE4_OPPORTUNITY = Object.freeze({
  name: "STABLE4_OPPORTUNITY",
  portfolio: Object.freeze({
    cryptoGrossCap: 3.0,
    stockGrossCap: 1.5,
    totalGrossCap: 3.5,
  }),
  pengu: Object.freeze({
    shortV20Btc24hMax: -0.010836782776818987,
    shortV20Pengu72hMax: -0.05237466490617382,
  }),
  idle: Object.freeze({
    taoRiskOffHours: 12,
    renderWait: true,
  }),
  hype: Object.freeze({
    gross: 1.0,
    h12Max: 0.004297852251518686,
    h24Min: 0.02047426596091347,
    rel24Max: 0.026202553353817715,
    holdHours: 48,
    emergencyStopPct: 0.06,
    protectionTakeProfitPct: 1.0,
  }),
});

export function resolveDisDexStable4Mode(env: Partial<NodeJS.ProcessEnv> = process.env): DisDexStable4Mode {
  const raw = String(env.DISDEX_STABLE4_MODE || "OFF").trim().toUpperCase();
  if (raw === "LIVE" || raw === "SHADOW") return raw;
  return "OFF";
}

export function assertStable4GlobalLiveAck(mode: DisDexStable4Mode, runtimeSha: string, env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (mode !== "LIVE") return;
  const ack = String(env.DISDEX_STABLE4_GLOBAL_LIVE_ACK || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/i.test(runtimeSha) || ack !== runtimeSha.toLowerCase()) {
    throw new Error("DISDEX_STABLE4_GLOBAL_LIVE_ACK_MUST_MATCH_RUNTIME_SHA");
  }
}