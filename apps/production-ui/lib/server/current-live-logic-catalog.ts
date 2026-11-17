import { execFile as execFileCallback } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SHA = /^[a-f0-9]{40}$/;
const SERVICE = /^disdex-[a-z0-9-]+@[a-f0-9]{40}\.service$/;
const MANIFEST = "/etc/disdex/runner-pins.json";
const KILL = "/var/lib/disdex/shared/kill-switch.json";

export const LOGIC_ROLES = {
  V12_V4: { title: "V4", description: "V12 / V4：入口・出口判定", href: "/decision-status/v12", heartbeat: "/var/lib/disdex/runner-health/heartbeats/v12-v4.json" },
  QUALITY102_CAUSAL_V1: { title: "Q102", description: "Causal Quality102：通貨・Family・Side選択", href: "/decision-status/q102", heartbeat: "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json" },
  PENGU_V8: { title: "PENGU", description: "PENGU V2・SHORT・Recovery V8", href: "/decision-status/pengu", heartbeat: "/var/lib/disdex/runner-health/heartbeats/pengu-v8.json" },
  FET_BRK48_RESIDUAL: { title: "FET", description: "FET BRK48 Residual", href: "/decision-status/fet", heartbeat: "/var/lib/disdex/fet-brk48-residual/state.json" },
  HYPE_TREND_LONG: { title: "HYPE", description: "HYPE Trend Long（H48証明書を照合）", href: "/decision-status/hype", heartbeat: "/var/lib/disdex/runner-health/heartbeats/hype-trend-long.json" },
  IDLE_PRIORITY_SHORT: { title: "IDLE", description: "IDLE Priority Short", href: "/decision-status/idle-priority", heartbeat: "/var/lib/disdex/runner-health/heartbeats/idle-priority-short.json" },
  V52: { title: "V52", description: "V52：basis・net-edge判定", href: "/decision-status/v52", heartbeat: "/var/lib/disdex/runner-health/heartbeats/v52.json" },
  SHARED_CRYPTO_RISK: { title: "Shared Risk", description: "暗号資産・日次損失の共通管理", href: "/decision-status", heartbeat: "" },
  MARGIN_GUARD: { title: "Margin Guard", description: "証拠金と口座保護", href: "/decision-status", heartbeat: "" },
} as const;

export type LogicRole = keyof typeof LOGIC_ROLES;
export type LogicRow = {
  id: LogicRole;
  title: string;
  description: string;
  href: string;
  pinSha: string;
  serviceUnit: string;
  serviceState: "RUNNING" | "STOPPED" | "UNVERIFIED" | "SHA_MISMATCH";
  mainPid: number | null;
  heartbeatSha?: string;
  heartbeatAt?: number;
  heartbeatFresh: boolean;
  safetyState?: string;
  healthReason?: string;
  decisionDetail?: string;
  mismatchReason?: string;
  policy?: string;
};
export type LogicSnapshot = {
  ok: true; readOnly: true; tradingMutation: 0; checkedAt: string;
  source: "ROOT_RUNNER_PIN_MANIFEST_AND_SYSTEMD";
  safety: { holdActive: boolean | null; action?: string; scope?: string; reason?: string };
  rows: LogicRow[];
};
type ManifestRow = { sha?: unknown; serviceUnit?: unknown; releaseRoot?: unknown };
type SystemctlResult = { stdout: string; stderr: string };

function safeText(value: unknown, max = 180): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}
function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
export function validateManifestRole(role: LogicRole, value: unknown): { sha: string; serviceUnit: string; releaseRoot: string } {
  if (!value || typeof value !== "object") throw new Error("LIVE_LOGIC_PIN_MISSING:" + role);
  const row = value as ManifestRow;
  const sha = safeText(row.sha);
  const unit = safeText(row.serviceUnit, 180);
  const releaseRoot = safeText(row.releaseRoot, 240);
  if (!sha || !SHA.test(sha) || !unit || !SERVICE.test(unit) ||
      !unit.endsWith("@" + sha + ".service") ||
      releaseRoot !== "/home/deploy/disdex-trading/releases/" + sha) {
    throw new Error("LIVE_LOGIC_PIN_INVALID:" + role);
  }
  return { sha, serviceUnit: unit, releaseRoot };
}
export function parseSystemdShow(output: string) {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx > 0) values[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return {
    active: values.ActiveState === "active",
    pid: /^\d+$/.test(values.MainPID || "") ? Number(values.MainPID) : 0,
    workingDirectory: values.WorkingDirectory || "",
  };
}
function lastDecision(raw: Record<string, unknown>): string | undefined {
  const direct = safeText(raw.lastEvaluationReason) || safeText(raw.tickReason) ||
    safeText(raw.lastDecisionReason) || safeText(raw.lastReason);
  if (direct) return direct;
  for (const key of ["v12v4", "quality102", "idle"]) {
    const nested = raw[key];
    if (nested && typeof nested === "object") {
      const state = nested as Record<string, unknown>;
      const reason = safeText(state.reason) || safeText(state.lastReason) ||
        safeText(state.decisionReason) || safeText(state.blockReason);
      if (reason) return reason;
    }
  }
  return undefined;
}
export async function buildLiveLogicSnapshot(options: {
  readText?: (path: string) => Promise<string>;
  showService?: (unit: string) => Promise<SystemctlResult>;
  readProcessCwd?: (pid: number) => Promise<string>;
  now?: () => number;
} = {}): Promise<LogicSnapshot> {
  const readText = options.readText || ((path: string) => readFile(path, "utf8"));
  const showService = options.showService || (async (unit: string) => {
    const output = await execFile("/usr/bin/systemctl", [
      "show", unit, "--property=ActiveState", "--property=MainPID", "--property=WorkingDirectory",
    ], { timeout: 4000, maxBuffer: 16384 });
    return { stdout: output.stdout, stderr: output.stderr };
  });
  const readProcessCwd = options.readProcessCwd || ((pid: number) => readlink("/proc/" + pid + "/cwd"));
  const now = options.now?.() ?? Date.now();
  const manifest = JSON.parse(await readText(MANIFEST)) as Record<string, unknown>;
  if (manifest.schema !== "disdex-runner-pin-manifest/v1" ||
      manifest.target !== "professional-dismanager.net" ||
      !manifest.runners || typeof manifest.runners !== "object") {
    throw new Error("LIVE_LOGIC_PIN_MANIFEST_UNVERIFIED");
  }
  const pins = manifest.runners as Record<string, unknown>;
  const rows = await Promise.all((Object.keys(LOGIC_ROLES) as LogicRole[]).map(async (id) => {
    const config = LOGIC_ROLES[id];
    const pin = validateManifestRole(id, pins[id]);
    let serviceState: LogicRow["serviceState"] = "UNVERIFIED";
    let mainPid: number | null = null;
    let mismatchReason: string | undefined;
    try {
      const service = parseSystemdShow((await showService(pin.serviceUnit)).stdout);
      mainPid = service.pid > 0 ? service.pid : null;
      if (!service.active || !mainPid) serviceState = "STOPPED";
      else if (service.workingDirectory !== pin.releaseRoot) {
        serviceState = "SHA_MISMATCH";
        mismatchReason = "systemd作業ディレクトリと正式pinが異なります";
      } else {
        serviceState = "RUNNING";
        try {
          if (await readProcessCwd(mainPid) !== pin.releaseRoot) {
            serviceState = "SHA_MISMATCH";
            mismatchReason = "実PIDの作業ディレクトリと正式pinが異なります";
          }
        } catch {
          mismatchReason = "実PIDの作業ディレクトリは未検証";
        }
      }
    } catch {
      mismatchReason = "systemdの状態が取得できません";
    }
    let heartbeatSha: string | undefined;
    let heartbeatAt: number | undefined;
    let safetyState: string | undefined;
    let healthReason: string | undefined;
    let decisionDetail: string | undefined;
    if (config.heartbeat) {
      try {
        const raw = JSON.parse(await readText(config.heartbeat)) as Record<string, unknown>;
        heartbeatSha = safeText(raw.runtimeSha) || safeText(raw.runtimeCommitSha);
        heartbeatAt = positive(raw.heartbeatAt) || positive(raw.updatedAt);
        safetyState = safeText(raw.safetyState, 80);
        healthReason = safeText(raw.healthReason);
        decisionDetail = lastDecision(raw);
        if (heartbeatSha && heartbeatSha !== pin.sha) {
          mismatchReason = "heartbeat SHA不一致: " + heartbeatSha.slice(0, 12);
        }
      } catch {
        mismatchReason ||= "heartbeat未取得";
      }
    }
    let policy: string | undefined;
    if (id === "HYPE_TREND_LONG") {
      try {
        const file = "/etc/disdex/stable4/h48-time-only/" + pin.sha + ".json";
        const cert = JSON.parse(await readText(file)) as Record<string, unknown>;
        if (cert.approvedSha === pin.sha && cert.policy === "H48_TIME_ONLY" &&
            cert.operatorAcknowledgement === "H48_TIME_ONLY") {
          policy = "H48_TIME_ONLY／48時間時間決済／常駐STOP・TPなし";
        }
      } catch { /* 未検証のポリシーを表示しない */ }
    }
    return {
      id, title: config.title, description: config.description, href: config.href,
      pinSha: pin.sha, serviceUnit: pin.serviceUnit, serviceState, mainPid,
      heartbeatSha, heartbeatAt,
      heartbeatFresh: heartbeatAt != null && now - heartbeatAt <= 300000 && heartbeatAt <= now + 30000,
      safetyState, healthReason, decisionDetail, mismatchReason, policy,
    };
  }));
  let safety: LogicSnapshot["safety"] = { holdActive: null };
  try {
    const raw = JSON.parse(await readText(KILL)) as Record<string, unknown>;
    safety = {
      holdActive: typeof raw.active === "boolean" ? raw.active : null,
      action: safeText(raw.action, 50), scope: safeText(raw.scope, 50),
      reason: safeText(raw.reason, 130),
    };
  } catch { /* Kill Switch未取得時はUNKNOWNのまま */ }
  return {
    ok: true, readOnly: true, tradingMutation: 0,
    checkedAt: new Date(now).toISOString(), source: "ROOT_RUNNER_PIN_MANIFEST_AND_SYSTEMD",
    safety, rows,
  };
}
