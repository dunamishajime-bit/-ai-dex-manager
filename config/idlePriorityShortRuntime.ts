import { resolve } from "node:path";
import { IDLE_PRIORITY_SHORT_POLICY } from "./idlePriorityShortPolicy";

export type IdlePriorityMode="SHADOW"|"LIVE";
export type IdlePriorityShortRuntime = ReturnType<typeof resolveIdlePriorityShortRuntime>;
function bool(v:string|undefined,d=false){if(v==null)return d;return /^(1|true|yes|on)$/i.test(v);}
export function resolveIdlePriorityShortRuntime(){
 const mode=(String(process.env.DISDEX_IDLE_PRIORITY_MODE||"SHADOW").toUpperCase()==="LIVE"?"LIVE":"SHADOW") as IdlePriorityMode;
 const enabled=bool(process.env.DISDEX_IDLE_PRIORITY_ENABLED,false);
 const runtimeSha=String(process.env.DISDEX_RUNTIME_SHA||process.env.GIT_COMMIT||"").trim().toLowerCase();
 if(!/^[0-9a-f]{40}$/.test(runtimeSha)) throw new Error("IDLE_RUNTIME_SHA_INVALID");
 if(mode==="LIVE" && (!enabled || !bool(process.env.DISDEX_IDLE_PRIORITY_OPERATOR_ARMED,false))) throw new Error("IDLE_LIVE_NOT_OPERATOR_ARMED");
 return {
  mode,enabled,runtimeSha,
  releaseRoot:resolve(process.env.DISDEX_RELEASE_ROOT||process.cwd()),
  parityCertificatePath:resolve(process.env.DISDEX_IDLE_PRIORITY_PARITY_CERT_PATH||"/var/lib/disdex/shared/idle-priority-parity-cert.json"),
  statePath:resolve(process.env.DISDEX_IDLE_PRIORITY_STATE_PATH||"/var/lib/disdex/idle-priority/state.json"),
  decisionPath:resolve(process.env.DISDEX_IDLE_PRIORITY_DECISION_PATH||"/var/lib/disdex/idle-priority/decision.json"),
  decisionDetailsPath:resolve(process.env.DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH||"/var/lib/disdex/idle-priority/decision-details.json"),
  v12DecisionPath:resolve(process.env.V12_DECISION_SNAPSHOT_PATH||"/var/lib/disdex/v12-x1-all/decision-snapshot.json"),
  q102DecisionPath:resolve(process.env.QUALITY102_CAUSAL_V1_DECISION_SNAPSHOT_PATH||"/var/lib/disdex/quality102-causal-v1/decision-snapshot.json"),
  penguStatePath:resolve(process.env.PENGU_DUAL_LS_V2_STATE_PATH||"/var/lib/disdex/pengu-dual-ls-v2/runner-live.json"),
  fetStatePath:resolve(process.env.FET_BRK48_STATE_PATH||"/var/lib/disdex/fet-brk48-residual/state.json"),
  v52StatePath:resolve(process.env.DISDEX_V52_ASTER_ONLY_STATE_PATH||"/var/lib/disdex/v52-aster-only/runner-live.json"),
  riskPath:resolve(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH||"/var/lib/disdex/shared/crypto-daily-risk.json"),
  marginPath:resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE||"/var/lib/disdex/shared/margin-risk/guard-live.json"),
  killSwitchPath:resolve(process.env.DISDEX_SHARED_KILL_SWITCH_FILE||"/var/lib/disdex/shared/kill-switch.json"),
  lockPath:resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH||"/var/lib/disdex/shared/account-order.lock"),
  pendingExposurePath:resolve(process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH||"/var/lib/disdex/shared/pending-exposure.json"),
  operatorActivationPath:resolve(process.env.DISDEX_OPERATOR_ACTIVATION_PATH||"/var/lib/disdex/shared/operator-activation/current.json"),
  baselineAdmissionMaxAgeMs:Number(process.env.DISDEX_IDLE_PRIORITY_BASELINE_MAX_AGE_MS||90_000),
  marginMaxAgeMs:Number(process.env.DISDEX_IDLE_PRIORITY_MARGIN_MAX_AGE_MS||90_000),
  maximumSlippageBps:Number(process.env.DISDEX_IDLE_PRIORITY_MAX_SLIPPAGE_BPS||20),
  pollMs:Number(process.env.DISDEX_IDLE_PRIORITY_POLL_MS||300_000),
  policy:IDLE_PRIORITY_SHORT_POLICY
 };
}
