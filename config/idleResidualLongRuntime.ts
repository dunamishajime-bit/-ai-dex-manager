import { resolve } from "node:path";
import { IDLE_RESIDUAL_LONG_POLICY } from "./idleResidualLongPolicy";

function bool(value: string | undefined, fallback = false) {
  if (value == null) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export type IdleResidualLongRuntime = ReturnType<typeof resolveIdleResidualLongRuntime>;

export function resolveIdleResidualLongRuntime(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const runtimeSha = String(env.DISDEX_RUNTIME_SHA || env.DISDEX_RELEASE_SHA || env.DISDEX_RUNTIME_COMMIT_SHA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(runtimeSha)) throw new Error("IDLE_RESIDUAL_RUNTIME_SHA_INVALID");
  return {
    enabled: bool(env.DISDEX_IDLE_RESIDUAL_LONG_ENABLED, false),
    operatorArmed: bool(env.DISDEX_IDLE_RESIDUAL_LONG_OPERATOR_ARMED, false),
    runtimeSha,
    statePath: resolve(env.DISDEX_IDLE_RESIDUAL_LONG_STATE_PATH || "/var/lib/disdex/idle-priority/residual-long-state.json"),
    parityCertificatePath: resolve(env.DISDEX_IDLE_RESIDUAL_LONG_PARITY_CERT_PATH || "/var/lib/disdex/shared/idle-residual-long-parity-cert.json"),
    maximumSlippageBps: Number(env.DISDEX_IDLE_RESIDUAL_LONG_MAX_SLIPPAGE_BPS || 20),
    policy: IDLE_RESIDUAL_LONG_POLICY,
  };
}
