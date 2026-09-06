import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { shouldTreatV52StopAsIntentional, type RunnerHealthStatus } from "../../../lib/server/runtime-alert-policy";
import {
  formatRunnerHealthEmail,
  markRunnerAlertAttempt,
  markRunnerAlertDelivered,
  observeRunnerStatus,
  type RunnerAlertRecord,
} from "../../../lib/server/runner-health-notification";

const ROOT = process.env.DISDEX_TRADING_ROOT || "/home/deploy/disdex-trading/current";
const STATE_PATH = process.env.DISDEX_ALERT_STATE_PATH || "/var/lib/disdex/runner-health/private/email-alert-state.json";
const DEFAULT_RECIPIENT = "dunamis.hajime@gmail.com";

// No order, cancel, position, Kill Switch, or approval-gate mutation is
// performed by this monitor. It is observation and email notification only.

type RunnerId = "V12" | "PENGU_V8" | "V52" | "QUALITY102_CAUSAL_V1";
type AlertState = { runners: Partial<Record<RunnerId, RunnerAlertRecord>> };

const runners: Array<{ id: RunnerId; label: string; unitEnv: string; defaultUnit: string; unitPattern: string; intentionalStopPath?: string }> = [
  {
    id: "V12",
    label: "V12 X1.00 ALL",
    unitEnv: "DISDEX_ALERT_V12_SERVICE_UNIT",
    defaultUnit: "disdex-v12-x1-all@f59347fad11553b833e75f6f35a0c545464fdf5f.service",
    unitPattern: "disdex-v12-x1-all@*.service",
  },
  {
    id: "PENGU_V8",
    label: "PENGU Dual LS V2 / Short V20 / Recovery V8",
    unitEnv: "DISDEX_ALERT_PENGU_V8_SERVICE_UNIT",
    defaultUnit: "disdex-pengu-dual-ls-v2-v20.service",
    unitPattern: "disdex-pengu-dual-ls-v2*.service",
  },
  {
    id: "V52",
    label: "V52 Aster-only",
    unitEnv: "DISDEX_ALERT_V52_SERVICE_UNIT",
    defaultUnit: "disdex-v52-aster-only@239982a73daed630a88b466404af43483aea8a10.service",
    unitPattern: "disdex-v52-aster-only@*.service",
    intentionalStopPath: "/var/lib/disdex/runner-health/v52.intentional-stop",
  },
  {
    id: "QUALITY102_CAUSAL_V1",
    label: "Quality102 Causal V4",
    unitEnv: "DISDEX_ALERT_QUALITY102_SERVICE_UNIT",
    defaultUnit: "disdex-quality102-causal-v1@f59347fad11553b833e75f6f35a0c545464fdf5f.service",
    unitPattern: "disdex-quality102-causal-v1@*.service",
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

function matchingUnits(pattern: string, activeOnly: boolean) {
  try {
    const args = ["list-units", "--all", "--type=service", "--plain", "--no-legend"];
    if (activeOnly) args.push("--state=active");
    args.push(pattern);
    const output = execFileSync("/usr/bin/systemctl", args, { encoding: "utf8" });
    return [...new Set(output.split(/\r?\n/)
      .map((line) => line.match(/([A-Za-z0-9@._:+-]+\.service)\b/)?.[1])
      .filter((unit): unit is string => Boolean(unit)))];
  } catch {
    return [];
  }
}

function resolveServiceUnit(runner: typeof runners[number]) {
  const active = matchingUnits(runner.unitPattern, true);
  if (active.length === 1) return { unit: active[0], detail: "active unitを動的解決" };
  if (active.length > 1) return { unit: active[0], detail: `同一ロジックのactive unitが複数あります: ${active.join(", ")}`, conflict: true };

  const configured = process.env[runner.unitEnv]?.trim();
  if (configured && unitExists(configured)) return { unit: configured, detail: "active unitなし・設定済みunitを確認" };

  const installed = matchingUnits(runner.unitPattern, false);
  if (installed.length === 1) return { unit: installed[0], detail: "active unitなし・installed unitを確認" };
  if (installed.length > 1) return { unit: installed[0], detail: `active unitなし・候補unitが複数あります: ${installed.join(", ")}`, conflict: true };
  return { unit: configured || runner.defaultUnit, detail: "対象unitを解決できません" };
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
  const temporaryPath = `${STATE_PATH}.tmp-${process.pid}`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, STATE_PATH);
  await chmod(STATE_PATH, 0o600);
}

function statusForRunner(runner: typeof runners[number], observedAt = new Date()) {
  const resolved = resolveServiceUnit(runner);
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
  const service = serviceStatus(resolved.unit, resolved.conflict);
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
  for (const runner of runners) {
    const observed = statusForRunner(runner, observedAt);
    const observation = observeRunnerStatus(state.runners[runner.id], observed.status, observedAt);
    state.runners[runner.id] = observation.record;
    if (!observation.shouldSend || observation.transition === "NONE") continue;

    // Persist the attempt before delivery. A process crash after SMTP accepts
    // the message therefore cannot create a one-minute duplicate loop.
    state.runners[runner.id] = markRunnerAlertAttempt(observation.record, observedAt);
    await saveState(state);
    const mail = formatRunnerHealthEmail({
      runnerLabel: runner.label,
      service: observed.service,
      status: observed.status,
      previousStatus: observation.previousNotifiedStatus,
      transition: observation.transition,
      observedAt,
      detail: observed.detail,
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
