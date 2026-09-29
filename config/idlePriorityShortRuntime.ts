import { resolve } from "node:path";
import { IDLE_PRIORITY_SHORT_POLICY } from "./idlePriorityShortPolicy";

export type IdlePriorityMode="SHADOW"|"LIVE";
function bool(v:string|undefined,d=false){if(v==null)return d;return /^(1|true|yes|on)$/i.test(v);}
export function resolveIdlePriorityShortRuntime(){
 const mode=(String(process.env.DISDEX_IDLE_PRIORITY_MODE||"SHADOW").toUpperCase()==="LIVE"?"LIVE":"SHADOW") as IdlePriorityMode;
 const enabled=bool(process.env.DISDEX_IDLE_PRIORITY_ENABLED,false);
 const runtimeSha=String(process.env.DISDEX_RUNTIME_SHA||process.env.GIT_COMMIT||"").trim().toLowerCase();
 if(!/^[0-9a-f]{40}$/.test(runtimeSha)) throw new Error("IDLE_RUNTIME_SHA_INVALID");
 if(mode==="LIVE" && (!enabled || !bool(process.env.DISDEX_IDLE_PRIORITY_OPERATOR_ARMED,false))) throw new Error("IDLE_LIVE_NOT_OPERATOR_ARMED");
 return {
  mode,enabled,runtimeSha,
  parityCertificatePath:resolve(process.env.DISDEX_IDLE_PRIORITY_PARITY_CERT_PATH||"/var/lib/disdex/shared/idle-priority-parity-cert.json"),
  statePath:resolve(process.env.DISDEX_IDLE_PRIORITY_STATE_PATH||"/var/lib/disdex/idle-priority/state.json"),
  decisionPath:resolve(process.env.DISDEX_IDLE_PRIORITY_DECISION_PATH||"/var/lib/disdex/idle-priority/decision.json"),
  policy:IDLE_PRIORITY_SHORT_POLICY
 };
}
