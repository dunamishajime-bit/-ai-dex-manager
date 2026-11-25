/**
 * Owner HP observability only. Does not issue or certify trading permission.
 * Current pin + real systemd process + fresh runner-owned state are independent
 * of the historic /current release and old supervisor heartbeat.
 */
import { readFile, readlink, lstat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadReadOnlyRunnerPins } from "@/lib/server/read-only-runner-pin-telemetry";
import type { RunnerPin, RunnerPinId } from "@/lib/server/runner-pin-manifest";

const exec = promisify(execFile);
type Obj = Record<string, unknown>;
const MAX_AGE = 300_000;
const SHA = /^[0-9a-f]{40}$/;
const NUMERIC = [
  "CRYPTO_GROSS_CAP","STOCK_GROSS_CAP","TOTAL_GROSS_CAP","HYPE_LONG_MAX_GROSS",
  "V12_BASE_GROSS_CAP","V12_DYNAMIC_GROSS_CAP","PENGU_GROSS_CAP",
  "PENGU_DUAL_LS_V2_MAX_GROSS","QUALITY102_CAUSAL_V1_MAX_GROSS",
  "DISDEX_V52_STOCK_GROSS_CAP","DISDEX_V52_V11_GROSS_CAP",
  "DISDEX_V52_V50_GROSS_CAP","DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT",
];
const MODE_KEYS = [
  "V12_V4_OPERATION_MODE","PENGU_DUAL_LS_V2_MODE",
  "QUALITY102_CAUSAL_V1_MONITOR_ONLY","QUALITY102_CAUSAL_V1_SELECTOR_MODE",
  "DISDEX_V52_MONITOR_ONLY","DISDEX_HYPE_ZEC_MODE","DISDEX_IDLE_PRIORITY_MODE",
  "PENGU_DUAL_LS_V2_MONITOR_TICK_PATH","FET_BRK48_SHADOW_STATE_PATH",
  "DISDEX_Q102_RUNTIME_SHA","DISDEX_HYPE_ZEC_STATE_PATH","DISDEX_IDLE_PRIORITY_STATE_PATH",
];
const ALLOW = new Set([...NUMERIC,...MODE_KEYS]);
export function displayEnvironment(raw: Buffer): Record<string,string> {
  const out: Record<string,string> = {};
  for (const part of raw.toString("utf8").split("\0")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const key = part.slice(0,at), value = part.slice(at+1);
    if (!ALLOW.has(key)) continue;
    if (NUMERIC.includes(key) && (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) continue;
    out[key]=value;
  }
  return out;
}

export type PinnedDisplayObservation = {
  runtimeSha?: string; expectedSha: string; mainPid?: number; mode?: string;
  updatedAt?: number; matchesCurrent: boolean; liveEnabled: boolean;
  safetyState?: string; healthReason?: string; error?: string;
  monitorOnly: boolean; processActive: boolean;
  env: Record<string,string>; monitorState?: Obj;
};

export function monitorEvidencePath(id: RunnerPinId, pin: RunnerPin, env: Record<string,string>): string | undefined {
  if (!SHA.test(pin.sha)) return;
  const scope = "/var/lib/disdex/stable4-dd30-monitor/" + pin.sha;
  if (id==="V12_V4" && env.V12_V4_OPERATION_MODE==="MONITOR_ONLY") return "/var/lib/disdex/runner-health/ticks/v12-v4.json";
  if (id==="QUALITY102_CAUSAL_V1" && env.QUALITY102_CAUSAL_V1_MONITOR_ONLY==="true") return "/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json";
  if (id==="V52" && env.DISDEX_V52_MONITOR_ONLY==="true") return "/var/lib/disdex/runner-health/ticks/v52-monitor.json";
  if (id==="PENGU_V8" && env.PENGU_DUAL_LS_V2_MODE==="SHADOW" && env.PENGU_DUAL_LS_V2_MONITOR_TICK_PATH===scope+"/pengu/monitor-tick.json") return scope+"/pengu/monitor-tick.json";
  if (id==="FET_BRK48_RESIDUAL" && env.FET_BRK48_SHADOW_STATE_PATH===scope+"/fet/shadow.json" && env.DISDEX_Q102_RUNTIME_SHA===pin.sha) return scope+"/fet/shadow.json";
  if (id==="HYPE_TREND_LONG" && env.DISDEX_HYPE_ZEC_MODE==="SHADOW" && env.DISDEX_HYPE_ZEC_STATE_PATH===scope+"/hype/runner.json") return scope+"/hype/runner.json";
  if (id==="IDLE_PRIORITY_SHORT" && env.DISDEX_IDLE_PRIORITY_MODE==="SHADOW" && env.DISDEX_IDLE_PRIORITY_STATE_PATH===scope+"/idle/state.json") return scope+"/idle/state.json";
}

export function validateMonitorEvidence(id: RunnerPinId, pin: RunnerPin, pid: number, raw: Obj, now: number, servicePids: readonly number[] = [pid]) {
  const ts = Number(raw.updatedAt ?? raw.heartbeatAt ?? raw.tickCompletedAt);
  if (!Number.isFinite(ts) || ts > now + 10_000 || now-ts > MAX_AGE) throw new Error("PINNED_MONITOR_EVIDENCE_STALE");
  const actual = raw.runtimeSha ?? raw.runtimeCommitSha ?? raw.releaseSha;
  // FET shadow has no embedded SHA; its exact path was verified against the
  // running pin-scoped process environment before this function was called.
  if (id==="FET_BRK48_RESIDUAL") {
    if (raw.schema!=="fet-brk48-shadow/v1" || raw.mode!=="SHADOW" || (actual!==undefined && actual!==pin.sha))
      throw new Error("PINNED_FET_EVIDENCE_INVALID");
  } else if (actual!==pin.sha) throw new Error("PINNED_MONITOR_SHA_MISMATCH");
  if (raw.expectedSha!==undefined && raw.expectedSha!==pin.sha) throw new Error("PINNED_MONITOR_EXPECTED_SHA_MISMATCH");
  if (raw.serviceUnit!==undefined && raw.serviceUnit!==pin.serviceUnit) throw new Error("PINNED_MONITOR_UNIT_MISMATCH");
  if (raw.mainPid!==undefined && (!Number.isInteger(raw.mainPid) || !servicePids.includes(Number(raw.mainPid)))) throw new Error("PINNED_MONITOR_PID_MISMATCH");
  if (["V12_V4","QUALITY102_CAUSAL_V1","V52"].includes(id)) {
    const runnerId=id==="V52"?"V52_MONITOR":id;
    if(raw.schema!=="disdex-runner-tick/v1" || raw.runnerId!==runnerId || raw.expectedSha!==pin.sha ||
       raw.serviceUnit!==pin.serviceUnit || raw.workingDirectory!==pin.releaseRoot ||
       !Number.isInteger(raw.mainPid) || !servicePids.includes(Number(raw.mainPid)) ||
       raw.newOrdersAllowed!==false || raw.ordersSent!==0 || raw.cancelsSent!==0 || raw.positionChangesSent!==0)
      throw new Error("PINNED_MONITOR_TICK_INVALID");
    if(id!=="V12_V4" && (raw.mode!=="MONITOR_ONLY" || raw.status!=="observing")) throw new Error("PINNED_MONITOR_MODE_INVALID");
    if(id==="V12_V4" && raw.status!=="observing" && !(raw.status==="blocked" &&
       typeof raw.reason==="string" && raw.reason.startsWith("V4_MONITOR_ENTRY_SAFETY_BLOCKED:") &&
       raw.reason.includes("V4_KILL_SWITCH_ACTIVE"))) throw new Error("PINNED_V4_TICK_NOT_OBSERVING");
  }
  if (raw.workingDirectory!==undefined && raw.workingDirectory!==pin.releaseRoot) throw new Error("PINNED_MONITOR_CWD_MISMATCH");
  if (raw.newOrdersAllowed===true || raw.liveEnabled===true || raw.mode==="LIVE" ||
      ["ordersSent","cancelsSent","cancelSent","positionChangesSent"].some(k=>raw[k]!==undefined && raw[k]!==0 && raw[k]!==false))
    throw new Error("PINNED_MONITOR_NOT_READ_ONLY");
  return ts;
}

async function readObject(path: string): Promise<Obj> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error("PINNED_DISPLAY_STATE_INVALID");
  const raw = JSON.parse(await readFile(path,"utf8"));
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw new Error("PINNED_DISPLAY_STATE_INVALID");
  return raw;
}

export async function observePinnedDisplay(id: RunnerPinId, pin: RunnerPin, now=Date.now()): Promise<PinnedDisplayObservation> {
  const base: PinnedDisplayObservation = {expectedSha:pin.sha, matchesCurrent:false,liveEnabled:false,monitorOnly:false,processActive:false,env:{}};
  try {
    const marker=(await readFile(pin.releaseRoot+"/.disdex-release-sha","utf8")).trim();
    if (marker!==pin.sha) throw new Error("PINNED_DISPLAY_MARKER_MISMATCH");
    const {stdout}=await exec("systemctl",["show",pin.serviceUnit,"--no-pager","--property=ActiveState,SubState,MainPID,WorkingDirectory,ControlGroup"],{timeout:4000,maxBuffer:16384});
    const props=Object.fromEntries(stdout.split(/\r?\n/).filter(v=>v.includes("=")).map(v=>[v.slice(0,v.indexOf("=")),v.slice(v.indexOf("=")+1)]));
    const pid=Number(props.MainPID);
    if(props.ActiveState!=="active" || props.SubState!=="running" || !Number.isInteger(pid) || pid<=0) return {...base,safetyState:"STOPPED",healthReason:"Runner停止中（発注可否は未認証）"};
    if(props.WorkingDirectory!==pin.releaseRoot || await readlink("/proc/"+pid+"/cwd")!==pin.releaseRoot) throw new Error("PINNED_DISPLAY_PROCESS_MISMATCH");
    const env=displayEnvironment(await readFile("/proc/"+pid+"/environ"));
    const processBase={...base,runtimeSha:pin.sha,mainPid:pid,processActive:true,env};
    const path=monitorEvidencePath(id,pin,env);
    if (!path) return processBase;
    try {
      const raw=await readObject(path);
      // TSX starts a child Node process; a runner-owned tick can truthfully
      // name that child rather than systemd MainPID. Prove cgroup membership.
      let members=[pid];
      if (Number.isInteger(raw.mainPid) && raw.mainPid!==pid) {
        const cg=props.ControlGroup;
        if (!cg?.startsWith("/system.slice/") || !cg.endsWith("/"+pin.serviceUnit) || cg.split("/").includes("..")) throw new Error("PINNED_CGROUP_INVALID");
        const pids=(await readFile("/sys/fs/cgroup"+cg+"/cgroup.procs","utf8")).trim().split(/\s+/).map(Number);
        if (!pids.includes(pid) || !pids.includes(Number(raw.mainPid)) || await readlink("/proc/"+Number(raw.mainPid)+"/cwd")!==pin.releaseRoot) throw new Error("PINNED_CHILD_PID_MISMATCH");
        members=pids;
      }
      const updatedAt=validateMonitorEvidence(id,pin,pid,raw,now,members);
      const after=await exec("systemctl",["show",pin.serviceUnit,"--property=MainPID","--value"],{timeout:4000,maxBuffer:1024});
      if(Number(after.stdout.trim())!==pid) throw new Error("PINNED_PID_CHANGED");
      return {...processBase,monitorOnly:true,mode:"MONITOR_ONLY",matchesCurrent:true,updatedAt,
        monitorState:raw,safetyState:"MONITOR_ONLY",healthReason:"現行pin・実プロセス・監視データ一致。新規注文は未許可。"};
    } catch {
      return {...processBase,monitorOnly:true,mode:"MONITOR_ONLY",safetyState:"STALE",
        healthReason:"現行Runnerの監視証跡が未取得または不一致。新規注文は未許可。"};
    }
  } catch {
    return {...base,error:"PINNED_DISPLAY_PROCESS_UNVERIFIED",healthReason:"実Runnerプロセスを照合できません。"};
  }
}

export async function loadPinnedDisplayObservation(id: RunnerPinId, now=Date.now()) {
  const pins=await loadReadOnlyRunnerPins();
  return observePinnedDisplay(id,pins.runners[id],now);
}
