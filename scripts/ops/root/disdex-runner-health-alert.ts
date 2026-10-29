import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  shouldTreatV52StopAsIntentional,
  type RunnerHealthStatus,
} from "../../../lib/server/runtime-alert-policy";
import {
  formatRunnerHealthEmail,
  markRunnerAlertAttempt,
  markRunnerAlertDelivered,
  observeRunnerStatus,
  type RunnerAlertRecord,
} from "../../../lib/server/runner-health-notification";
import {
  resolveRunnerServiceUnit,
  type AlertRunnerId,
} from "../../../lib/server/runner-service-resolution";

const ROOT = process.env.DISDEX_TRADING_ROOT || "/home/deploy/disdex-trading/current";
const STATE_PATH = process.env.DISDEX_ALERT_STATE_PATH || "/var/lib/disdex/runner-health/private/email-alert-state.json";
const HEALTH_ROOT = process.env.DISDEX_ALERT_HEALTH_ROOT || "/var/lib/disdex/runner-health";
const DEFAULT_RECIPIENT = "dunamis.hajime@gmail.com";

// No order, cancel, position, Kill Switch, or approval-gate mutation is
// performed by this monitor. It is observation and email notification only.

type RunnerId = AlertRunnerId;
type AlertState = { runners: Partial<Record<RunnerId, RunnerAlertRecord>> };

const runners: Array<{ id: RunnerId; label: string; unitEnv: string; intentionalStopPath?: string }> = [
  {
    id: "V12",
    label: "V12 X1.00 ALL",
    unitEnv: "DISDEX_ALERT_V12_SERVICE_UNIT",
  },
  {
    id: "PENGU_V8",
    label: "PENGU Dual LS V2 / Short V20 / Recovery V8",
    unitEnv: "DISDEX_ALERT_PENGU_V8_SERVICE_UNIT",
  },
  {
    id: "V52",
    label: "V52 Aster-only",
    unitEnv: "DISDEX_ALERT_V52_SERVICE_UNIT",
    intentionalStopPath: "/var/lib/disdex/runner-health/v52.intentional-stop",
  },
  {
    id: "FET_BRK48_RESIDUAL",
    label: "FET BRK48 Residual",
    unitEnv: "DISDEX_ALERT_FET_BRK48_SERVICE_UNIT",
  },
  {
    id: "QUALITY102_CAUSAL_V1",
    label: "Quality102 Causal V4",
    unitEnv: "DISDEX_ALERT_QUALITY102_SERVICE_UNIT",
  },
  {
    id: "HYPE_TREND_LONG",
    label: "HYPE Trend Long",
    unitEnv: "DISDEX_ALERT_HYPE_SERVICE_UNIT",
  },
  {
    id: "IDLE_PRIORITY_SHORT",
    label: "Idle Priority Short",
    unitEnv: "DISDEX_ALERT_IDLE_SERVICE_UNIT",
  },
  {
    id: "SHARED_CRYPTO_RISK",
    label: "共有Crypto Risk安全Gate",
    unitEnv: "DISDEX_ALERT_SHARED_CRYPTO_RISK_SERVICE_UNIT",
  },
  {
    id: "MARGIN_GUARD",
    label: "V12/PENGU/V52 Margin Guard安全Gate",
    unitEnv: "DISDEX_ALERT_MARGIN_GUARD_SERVICE_UNIT",
  },
];

function unitExists(unit: string) {
  if (!unit) return false;
  try {
    execFileSync("/usr/bin/systemctl", ["cat", unit], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function readCurrentReleaseSha() {
  try {
    return (await readFile(join(ROOT, ".disdex-release-sha"), "utf8")).trim();
  } catch {
    return undefined;
  }
}

function resolveServiceUnit(runner: typeof runners[number], currentReleaseSha: string | undefined) {
  const expectedShaOverride = runner.id === "V12"
    ? process.env.DISDEX_ALERT_V12_EXPECTED_SHA
    : undefined;
  const resolved = resolveRunnerServiceUnit(runner.id, currentReleaseSha, process.env[runner.unitEnv], expectedShaOverride);
  if (!resolved.unit) return resolved;
  if (!unitExists(resolved.unit)) {
    return {
      ...resolved,
      failClosed: true,
      detail: `${resolved.detail} がsystemdに存在しないためFail Closed`,
    } as const;
  }
  return resolved;
}

function runnerLabel(runner: typeof runners[number]) {
  if (runner.id === "V12" && process.env.DISDEX_ALERT_V12_SERVICE_UNIT?.trim().startsWith("disdex-v12-v4@")) {
    return "V12 V4";
  }
  return runner.label;
}

function serviceStatus(unit: string, conflict = false): { status: RunnerHealthStatus; detail: string } {
  if (conflict) return { status: "UNKNOWN", detail: "同一ロジックのactive serviceが複数あるためFail Closed" };
  if (!unit) return { status: "UNKNOWN", detail: "systemd service名が未設定" };
  try {
    const raw = execFileSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "SubState", "-p", "MainPID"], { encoding: "utf8" }).trim();
    const values = Object.fromEntries(raw.split(/\r?\n/)
      .map((line) => line.split("=", 2))
      .filter(([key, value]) => Boolean(key && value)));
    const activeState = values.ActiveState || "unknown";
    const subState = values.SubState || "unknown";
    const mainPid = values.MainPID || "0";
    const status: RunnerHealthStatus = activeState === "active"
      ? "ACTIVE"
      : activeState === "failed"
        ? "FAILED"
        : ["inactive", "deactivating", "dead"].includes(activeState)
          ? "INACTIVE"
          : "UNKNOWN";
    return { status, detail: `ActiveState=${activeState} / SubState=${subState} / MainPID=${mainPid}` };
  } catch (error) {
    return { status: "UNKNOWN", detail: `systemd状態取得失敗: ${error instanceof Error ? error.message : "不明なエラー"}` };
  }
}

async function readState(): Promise<AlertState> {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8")) as AlertState;
    return parsed && typeof parsed === "object" && parsed.runners ? parsed : { runners: {} };
  } catch {
    return { runners: {} };
  }
}

async function saveState(state: AlertState) {
  await mkdir(dirname(STATE_PATH), { recursive: true, mode: 0o700 });
  const temporaryPath = `${STATE_PATH}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, STATE_PATH);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await chmod(STATE_PATH, 0o600);
}

function heartbeatFileFor(runner: typeof runners[number], service: string) {
  if (runner.id === "V12") return service.startsWith("disdex-v12-v4@") ? "v12-v4.json" : "v12-x1-all.json";
  if (runner.id === "PENGU_V8") return "pengu-v8.json";
  if (runner.id === "V52") return "v52.json";
  if (runner.id === "QUALITY102_CAUSAL_V1") return "quality102-causal-v1.json";
  if (runner.id === "FET_BRK48_RESIDUAL") return "fet-brk48-residual.json";
  if (runner.id === "HYPE_TREND_LONG") return "hype-trend-long.json";
  if (runner.id === "IDLE_PRIORITY_SHORT") return "idle-priority-short.json";
  return `${runner.id.toLowerCase()}.json`;
}

async function readRunnerEvidence(runner: typeof runners[number], service: string) {
  const path = join(HEALTH_ROOT, "heartbeats", heartbeatFileFor(runner, service));
  try {
    const heartbeat = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return { present: true, path, heartbeat };
  } catch {
    return { present: false, path, heartbeat: null };
  }
}

function evidenceSha(unit: string, heartbeat: Record<string, unknown> | null) {
  return String(heartbeat?.expectedSha || unit.match(/@([0-9a-f]{40})\.service$/i)?.[1] || "UNKNOWN").toLowerCase();
}

function evidenceDetail(runner: typeof runners[number], observed: { service: string; detail: string }, evidence: Awaited<ReturnType<typeof readRunnerEvidence>>, now = Date.now()) {
  const heartbeat = evidence.heartbeat;
  const expectedSha = evidenceSha(observed.service, heartbeat);
  const actualSha = String(heartbeat?.runtimeSha || "UNKNOWN").toLowerCase();
  const heartbeatAt = Number(heartbeat?.heartbeatAt || 0);
  const lastTickAt = Number(heartbeat?.lastTickAt || 0);
  const heartbeatAgeMs = Number.isFinite(heartbeatAt) && heartbeatAt > 0 ? Math.max(0, now - heartbeatAt) : null;
  const tickAgeMs = Number.isFinite(lastTickAt) && lastTickAt > 0 ? Math.max(0, now - lastTickAt) : null;
  const serviceMismatch = Boolean(heartbeat?.serviceUnit && observed.service && heartbeat.serviceUnit !== observed.service);
  const reason = String(heartbeat?.healthReason || heartbeat?.tickReason || "").trim();
  return [
    observed.detail,
    `runner=${runner.id}`,
    `expectedSha=${expectedSha}`,
    `actualSha=${actualSha}`,
    `heartbeatAgeMs=${heartbeatAgeMs === null ? "UNKNOWN" : heartbeatAgeMs}`,
    `tickAgeMs=${tickAgeMs === null ? "UNKNOWN" : tickAgeMs}`,
    `serviceMismatch=${serviceMismatch}`,
    `evidence=${evidence.present ? "PRESENT" : "UNAVAILABLE"}`,
    ...(reason ? [`healthReason=${reason}`] : []),
  ].join("; ");
}

function statusForRunner(runner: typeof runners[number], currentReleaseSha: string | undefined, observedAt = new Date()) {
  const resolved = resolveServiceUnit(runner, currentReleaseSha);
  if (resolved.failClosed) {
    const service = serviceStatus(resolved.unit, true);
    return { ...service, service: resolved.unit, detail: resolved.detail };
  }
  if (runner.intentionalStopPath) {
    let markerPresent = false;
    try {
      execFileSync("/usr/bin/test", ["-f", runner.intentionalStopPath], { stdio: "ignore" });
      markerPresent = true;
    } catch {
      // The service is expected to be monitored when the intentional marker is absent.
    }
    if (shouldTreatV52StopAsIntentional(markerPresent, observedAt)) {
      return { status: "INTENTIONAL_STOP" as const, service: resolved.unit, detail: "V52市場時間外停止マーカーを確認" };
    }
  }
  const service = serviceStatus(resolved.unit, resolved.failClosed);
  return { ...service, service: resolved.unit, detail: `${resolved.detail}; ${service.detail}` };
}

function mailRecipient() {
  return process.env.DISDEX_ALERT_EMAIL_TO?.trim()
    || process.env.DISDEX_RUNNER_ALERT_EMAIL?.trim()
    || process.env.ALERT_EMAIL?.trim()
    || process.env.TRADE_FILL_NOTIFICATION_EMAIL?.trim()
    || DEFAULT_RECIPIENT;
}

async function sendAlert(subject: string, text: string) {
  const require = createRequire(import.meta.url);
  const nodemailer = require(join(ROOT, "node_modules", "nodemailer")) as { createTransport: (options: unknown) => { sendMail: (message: unknown) => Promise<unknown> } };
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const recipient = mailRecipient();
  if (gmailUser && gmailPassword) {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPassword } });
    await transporter.sendMail({ from: { name: "DisTERMINAL runner monitor", address: gmailUser }, to: recipient, subject, text });
    return "GMAIL";
  }

  const sendgridKey = process.env.SENDGRID_API_KEY?.trim();
  if (sendgridKey) {
    const sendgrid = require(join(ROOT, "node_modules", "@sendgrid", "mail")) as { setApiKey: (key: string) => void; send: (message: unknown) => Promise<unknown> };
    sendgrid.setApiKey(sendgridKey);
    await sendgrid.send({ to: recipient, from: process.env.SENDGRID_FROM_EMAIL?.trim() || recipient, subject, text });
    return "SENDGRID";
  }
  throw new Error("runner alert mail transport is not configured");
}

async function main() {
  const state = await readState();
  let deliveryFailure = false;
  const observedAt = new Date();
  const currentReleaseSha = await readCurrentReleaseSha();
  for (const runner of runners) {
    const observed = statusForRunner(runner, currentReleaseSha, observedAt);
    const evidence = await readRunnerEvidence(runner, observed.service);
    const combinedDetail = evidenceDetail(runner, observed, evidence, observedAt.getTime());
    const heartbeatBlocked = evidence.heartbeat?.safetyState === "BLOCKED"
      || (evidence.heartbeat?.evidenceMode === "tick-v1" && (!Number.isFinite(Number(evidence.heartbeat?.lastTickAt)) || Number(evidence.heartbeat?.lastTickAt) <= 0));
    const effectiveStatus: RunnerHealthStatus = heartbeatBlocked && observed.status === "ACTIVE" ? "UNKNOWN" : observed.status;
    const observation = observeRunnerStatus(state.runners[runner.id], effectiveStatus, observedAt);
    state.runners[runner.id] = observation.record;
    if (!observation.shouldSend || observation.transition === "NONE") continue;

    // Persist the attempt before delivery. A process crash after SMTP accepts
    // the message therefore cannot create a one-minute duplicate loop.
    state.runners[runner.id] = markRunnerAlertAttempt(observation.record, observedAt);
    await saveState(state);
    const mail = formatRunnerHealthEmail({
      runnerLabel: runnerLabel(runner),
      service: observed.service,
      status: effectiveStatus,
      previousStatus: observation.previousNotifiedStatus,
      transition: observation.transition,
      observedAt,
      detail: combinedDetail,
    });
    try {
      const provider = await sendAlert(mail.subject, mail.text);
      state.runners[runner.id] = markRunnerAlertDelivered(state.runners[runner.id], observed.status, observedAt);
      console.log(`DISDEX_RUNNER_HEALTH_ALERT runner=${runner.id} status=${observed.status} transition=${observation.transition} provider=${provider}`);
    } catch (error) {
      deliveryFailure = true;
      console.error(`DISDEX_RUNNER_HEALTH_ALERT_FAILED runner=${runner.id} status=${observed.status} transition=${observation.transition} reason=${error instanceof Error ? error.message : String(error)}`);
      // Keep lastAttemptAt so the same incident is retried only after the
      // bounded retry interval, never on every timer tick.
    }
  }
  await saveState(state);
  if (deliveryFailure) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(`DISDEX_RUNNER_HEALTH_ALERT_FATAL reason=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
