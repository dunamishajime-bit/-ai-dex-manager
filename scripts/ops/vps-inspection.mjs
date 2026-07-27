#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_LOG_LINES = 20;
const MAX_STATE_FILES = 250;
const MAX_STATE_FILE_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`required environment variable is empty: ${name}`);
  return value;
}

function optional(name, fallback = "") {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function absolutePath(name) {
  const value = required(name);
  if (!value.startsWith("/") || value === "/") throw new Error(`${name} must be a non-root absolute path`);
  return resolve(value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeoutMs || COMMAND_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function redact(text) {
  return String(text || "")
    .replace(/(authorization|api[-_ ]?key|secret|token|password|private[-_ ]?key|signature)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[opsu]_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, "[REDACTED_32_BYTE_HEX]")
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, value => value.length > 80 ? "[REDACTED_LONG_VALUE]" : value);
}

function hashFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function safeJson(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_STATE_FILE_BYTES) return { ok: false, reason: "not-readable-size" };
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function walkJsonFiles(root) {
  if (!root || !existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_STATE_FILES) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_STATE_FILES) break;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path);
      }
    }
  }
  return files;
}

function summarizeState(root) {
  const summary = {
    configured: Boolean(root),
    exists: Boolean(root && existsSync(root)),
    jsonFilesScanned: 0,
    parseFailures: 0,
    killSwitchActive: false,
    killSwitchSignals: [],
    pendingOrderSignals: 0,
    manualReviewSignals: 0,
    manualReviewReasons: [],
    openOrderCountSignals: [],
    positionCountSignals: [],
    grossSignals: {},
  };
  if (!root || !existsSync(root)) return summary;

  const files = walkJsonFiles(root);
  summary.jsonFilesScanned = files.length;
  const reasonSet = new Set();
  const killSet = new Set();

  function inspect(value, keyPath = []) {
    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((item, index) => inspect(item, [...keyPath, String(index)]));
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = [...keyPath, key].join(".");

      if ((normalized.includes("killswitch") || normalized === "halted") && child === true) {
        summary.killSwitchActive = true;
        killSet.add(path);
      }
      if ((normalized === "pendingorder" || normalized === "pendingorders") && child) {
        if (Array.isArray(child)) summary.pendingOrderSignals += child.length;
        else if (typeof child === "object") summary.pendingOrderSignals += Object.keys(child).length > 0 ? 1 : 0;
        else summary.pendingOrderSignals += 1;
      }
      if (normalized.includes("manualreview") && child) {
        summary.manualReviewSignals += 1;
        if (typeof child === "string") reasonSet.add(redact(child).slice(0, 240));
      }
      if (normalized.includes("openorder") && typeof child === "number" && Number.isFinite(child)) {
        summary.openOrderCountSignals.push({ key: path, count: child });
      }
      if (normalized.includes("positioncount") && typeof child === "number" && Number.isFinite(child)) {
        summary.positionCountSignals.push({ key: path, count: child });
      }
      if (normalized.includes("gross") && typeof child === "number" && Number.isFinite(child)) {
        summary.grossSignals[path] = child;
      }
      inspect(child, [...keyPath, key]);
    }
  }

  for (const file of files) {
    const parsed = safeJson(file);
    if (!parsed.ok) {
      summary.parseFailures += 1;
      continue;
    }
    inspect(parsed.value, [basename(file)]);
  }

  summary.killSwitchSignals = [...killSet].slice(0, 30);
  summary.manualReviewReasons = [...reasonSet].slice(0, 30);
  summary.openOrderCountSignals = summary.openOrderCountSignals.slice(0, 30);
  summary.positionCountSignals = summary.positionCountSignals.slice(0, 30);
  return summary;
}

function serviceSnapshot(manager, name) {
  if (!manager || !name) return { configured: false, manager, name, state: "not-configured", pid: 0 };
  if (!/^[A-Za-z0-9_.@:-]+$/.test(name)) return { configured: true, manager, name: "invalid", state: "invalid-name", pid: 0 };

  if (manager === "systemd") {
    const state = run("systemctl", ["is-active", name]);
    const pid = run("systemctl", ["show", name, "--property", "MainPID", "--value"]);
    return { configured: true, manager, name, state: state.stdout || "unknown", pid: Number(pid.stdout || 0) || 0 };
  }
  if (manager === "pm2") {
    const list = run("pm2", ["jlist"]);
    try {
      const rows = JSON.parse(list.stdout || "[]");
      const row = rows.find(item => item?.name === name);
      return { configured: true, manager, name, state: row?.pm2_env?.status || "not-found", pid: Number(row?.pid || 0) || 0 };
    } catch {
      return { configured: true, manager, name, state: "unknown", pid: 0 };
    }
  }
  return { configured: true, manager, name, state: "unsupported-manager", pid: 0 };
}

function logSummary(manager, name) {
  if (!manager || !name || !/^[A-Za-z0-9_.@:-]+$/.test(name)) return { available: false, errorCount: 0, warningCount: 0, recent: [] };
  let result;
  if (manager === "systemd") {
    result = run("journalctl", ["-u", name, "--since", "2 hours ago", "--no-pager", "-n", "500"]);
  } else if (manager === "pm2") {
    result = run("pm2", ["logs", name, "--nostream", "--lines", "500"]);
  } else {
    return { available: false, errorCount: 0, warningCount: 0, recent: [] };
  }
  const lines = redact(`${result.stdout}\n${result.stderr}`).split(/\r?\n/).filter(Boolean);
  const relevant = lines.filter(line => /\b(error|fatal|warn(?:ing)?|exception|failed)\b/i.test(line));
  return {
    available: result.ok || lines.length > 0,
    errorCount: relevant.filter(line => /\b(error|fatal|exception|failed)\b/i.test(line)).length,
    warningCount: relevant.filter(line => /\bwarn(?:ing)?\b/i.test(line)).length,
    recent: relevant.slice(-MAX_LOG_LINES).map(line => line.slice(0, 800)),
  };
}

function httpSnapshot(url) {
  if (!url) return { configured: false, url: null, status: 0, ok: false };
  if (!/^https?:\/\//i.test(url)) return { configured: true, url: "invalid", status: 0, ok: false };
  const result = run("curl", ["--silent", "--show-error", "--location", "--max-time", "15", "--output", "/dev/null", "--write-out", "%{http_code}", url], { timeoutMs: 20_000 });
  const status = Number(result.stdout || 0) || 0;
  return { configured: true, url, status, ok: status >= 200 && status < 300, error: result.ok ? null : redact(result.stderr || result.error) };
}

function filesystemSnapshot(path) {
  const result = run("df", ["-Pk", path]);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { ok: false };
  const fields = lines.at(-1).trim().split(/\s+/);
  return {
    ok: true,
    totalKb: Number(fields[1] || 0),
    usedKb: Number(fields[2] || 0),
    availableKb: Number(fields[3] || 0),
    usedPercent: Number(String(fields[4] || "0").replace("%", "")),
    mount: fields[5] || "",
  };
}

function gitSnapshot(appDir, targetCommit) {
  const sha = run("git", ["rev-parse", "HEAD"], { cwd: appDir });
  const branch = run("git", ["branch", "--show-current"], { cwd: appDir });
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: appDir });
  const trackedStatus = run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: appDir });
  const remote = run("git", ["remote", "get-url", "origin"], { cwd: appDir });
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  return {
    sha: sha.stdout,
    branch: branch.stdout || "DETACHED",
    targetCommit,
    targetMatches: Boolean(targetCommit && sha.stdout === targetCommit),
    trackedClean: trackedStatus.stdout.length === 0,
    statusCount: lines.length,
    statusPreview: lines.slice(0, 50).map(redact),
    origin: redact(remote.stdout),
  };
}

function importantHashes(appDir) {
  const paths = [
    "package.json",
    "package-lock.json",
    "scripts/disdex-v13d-v11eq-v96-live-runner.ts",
    "scripts/disdex-v13d-v11eq-v96-live-preflight.ts",
    "scripts/disdex_v52_safe_runner.py",
    "scripts/disdex_v52_execution_safety_patch.py",
  ];
  return Object.fromEntries(paths.map(path => [path, hashFile(join(appDir, path))]));
}

function lastPreflight(opsStateDir) {
  const path = join(opsStateDir, "trading-last-preflight.json");
  const parsed = safeJson(path);
  return parsed.ok ? parsed.value : { available: false, reason: parsed.reason || "not-found" };
}

function markdown(report) {
  const lines = [
    `# VPS inspection`,
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Profile: ${report.profile}`,
    `- Overall: **${report.overall}**`,
    `- Deployed SHA: \`${report.git.sha || "unknown"}\``,
    `- Requested SHA: \`${report.git.targetCommit || "none"}\``,
    `- Tracked tree clean: ${report.git.trackedClean}`,
    `- UI: ${report.services.ui.state} (PID ${report.services.ui.pid})`,
    `- Trading: ${report.services.trading.state} (PID ${report.services.trading.pid})`,
    `- UI HTTP: ${report.http.ui.status || "not configured"}`,
    `- API HTTP: ${report.http.api.status || "not configured"}`,
    `- Kill Switch active signal: ${report.runtime.killSwitchActive}`,
    `- Pending-order signals: ${report.runtime.pendingOrderSignals}`,
    `- Manual-review signals: ${report.runtime.manualReviewSignals}`,
    `- Runtime JSON parse failures: ${report.runtime.parseFailures}`,
    `- Last no-order preflight status: ${report.lastPreflight.status || report.lastPreflight.reason || "unknown"}`,
    ``,
    `## Findings`,
    ...(report.findings.length ? report.findings.map(item => `- ${item}`) : ["- No configured fail-closed condition was detected."]),
    ``,
    `## Recent sanitized service signals`,
    `### UI`,
    ...(report.logs.ui.recent.length ? report.logs.ui.recent.map(line => `- ${line}`) : ["- None"]),
    `### Trading`,
    ...(report.logs.trading.recent.length ? report.logs.trading.recent.map(line => `- ${line}`) : ["- None"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const appDir = absolutePath("VPS_APP_DIR");
  const reportDir = absolutePath("VPS_REPORT_DIR");
  const opsStateDir = absolutePath("VPS_OPS_STATE_DIR");
  const stateRoot = optional("VPS_STATE_ROOT") ? resolve(optional("VPS_STATE_ROOT")) : "";
  const targetCommit = optional("TARGET_COMMIT");
  const profile = optional("VPS_INSPECTION_PROFILE", "basic");
  if (!existsSync(appDir) || !lstatSync(appDir).isDirectory()) throw new Error(`VPS_APP_DIR does not exist: ${appDir}`);
  mkdirSync(reportDir, { recursive: true, mode: 0o700 });

  const uiManager = optional("VPS_UI_SERVICE_MANAGER", "systemd");
  const tradingManager = optional("VPS_TRADING_SERVICE_MANAGER", "systemd");
  const uiName = optional("VPS_UI_SERVICE");
  const tradingName = optional("VPS_TRADING_SERVICE");

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile,
    readOnlyInspection: true,
    secretsRead: false,
    ordersSent: false,
    positionsChanged: false,
    servicesRestarted: false,
    runtimeStateEdited: false,
    host: {
      node: run("node", ["--version"]).stdout,
      npm: run("npm", ["--version"]).stdout,
      python: run("python3", ["--version"]).stdout || run("python3", ["--version"]).stderr,
      cpuCount: cpus().length,
      loadAverage: loadavg(),
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      filesystem: filesystemSnapshot(appDir),
    },
    git: gitSnapshot(appDir, targetCommit),
    importantFileSha256: importantHashes(appDir),
    services: {
      ui: serviceSnapshot(uiManager, uiName),
      trading: serviceSnapshot(tradingManager, tradingName),
    },
    http: {
      ui: httpSnapshot(optional("VPS_UI_HEALTH_URL")),
      api: httpSnapshot(optional("VPS_API_HEALTH_URL")),
    },
    logs: {
      ui: logSummary(uiManager, uiName),
      trading: logSummary(tradingManager, tradingName),
    },
    runtime: summarizeState(stateRoot),
    lastPreflight: lastPreflight(opsStateDir),
    findings: [],
  };

  if (!report.git.trackedClean) report.findings.push("Tracked files are modified on the deployed VPS checkout.");
  if (targetCommit && !report.git.targetMatches) report.findings.push("The deployed SHA does not match the requested GitHub SHA.");
  if (!report.services.ui.configured || !["active", "online"].includes(report.services.ui.state)) report.findings.push("The configured UI service is not healthy.");
  if (!report.services.trading.configured || !["active", "online"].includes(report.services.trading.state)) report.findings.push("The configured trading service is not healthy.");
  if (!report.http.ui.configured || !report.http.ui.ok) report.findings.push("The configured UI health endpoint is not returning HTTP 2xx.");
  if (!report.http.api.configured || !report.http.api.ok) report.findings.push("The configured API health endpoint is not returning HTTP 2xx.");
  if (report.runtime.parseFailures > 0) report.findings.push("One or more runtime JSON files could not be parsed; manual review is required.");
  if (report.runtime.killSwitchActive) report.findings.push("A Kill Switch signal is active. This inspection does not clear it.");
  if (report.runtime.pendingOrderSignals > 0) report.findings.push("Pending-order state was detected.");
  if (report.runtime.manualReviewSignals > 0) report.findings.push("Manual-review state was detected.");
  if (report.host.filesystem.ok && report.host.filesystem.usedPercent >= 90) report.findings.push("Filesystem usage is at or above 90%.");

  report.overall = report.findings.length === 0 ? "PASS" : "REVIEW_REQUIRED";
  writeFileSync(join(reportDir, "vps-inspection.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(reportDir, "vps-inspection.md"), markdown(report), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ overall: report.overall, reportDir, findingCount: report.findings.length })}\n`);

  if (optional("VPS_STRICT_INSPECTION", "true") === "true" && report.findings.length > 0) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ overall: "FAILED", message: redact(error instanceof Error ? error.message : String(error)), ordersSent: false, servicesRestarted: false }));
  process.exitCode = 1;
}
