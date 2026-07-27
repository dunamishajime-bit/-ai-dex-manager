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

function absolute(name, requiredValue = true) {
  const raw = requiredValue ? required(name) : optional(name);
  if (!raw) return "";
  if (!raw.startsWith("/") || raw === "/") throw new Error(`${name} must be a non-root absolute path`);
  return resolve(raw);
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
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, "[REDACTED_LONG_VALUE]");
}

function hashFile(path) {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    const hash = createHash("sha256");
    hash.update(readFileSync(path));
    return hash.digest("hex");
  } catch {
    return null;
  }
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
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
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

function owner(path) {
  if (!path || !existsSync(path)) return null;
  const result = run("stat", ["-c", "%U:%G", path]);
  return result.ok ? result.stdout : null;
}

function realPath(path) {
  if (!path || (!existsSync(path) && !existsSync(resolve(path)))) return null;
  const result = run("readlink", ["-f", path]);
  return result.ok ? result.stdout : null;
}

function pathSnapshot(path) {
  if (!path) return { configured: false, path: null, exists: false };
  if (!existsSync(path) && !lstatSafe(path)) return { configured: true, path, exists: false };
  const stat = lstatSafe(path);
  return {
    configured: true,
    path,
    exists: Boolean(stat),
    type: stat?.isSymbolicLink() ? "symlink" : stat?.isDirectory() ? "directory" : stat?.isFile() ? "file" : "other",
    resolvedPath: realPath(path),
    owner: owner(path),
  };
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function gitSnapshot(appDir, targetCommit = "") {
  const result = {
    configured: Boolean(appDir),
    path: appDir || null,
    isGit: false,
    sha: "",
    branch: "",
    targetCommit,
    targetMatches: false,
    trackedClean: false,
    statusCount: 0,
    statusPreview: [],
    origin: "",
    owner: appDir ? owner(appDir) : null,
  };
  if (!appDir || !existsSync(appDir) || !existsSync(join(appDir, ".git"))) return result;
  const inside = run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: appDir });
  if (!inside.ok) return result;
  result.isGit = true;
  const sha = run("git", ["rev-parse", "HEAD"], { cwd: appDir });
  const branch = run("git", ["branch", "--show-current"], { cwd: appDir });
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: appDir });
  const trackedStatus = run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: appDir });
  const remote = run("git", ["remote", "get-url", "origin"], { cwd: appDir });
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  result.sha = sha.stdout;
  result.branch = branch.stdout || "DETACHED";
  result.targetMatches = Boolean(targetCommit && sha.stdout === targetCommit);
  result.trackedClean = trackedStatus.stdout.length === 0;
  result.statusCount = lines.length;
  result.statusPreview = lines.slice(0, 50).map(redact);
  result.origin = redact(remote.stdout);
  return result;
}

function releaseLinkSnapshot(linkPath) {
  const base = pathSnapshot(linkPath);
  const result = { ...base, validRelease: false, releaseSha: "", markerPath: null };
  if (!base.exists || base.type !== "symlink" || !base.resolvedPath) return result;
  const marker = join(base.resolvedPath, ".disdex-release-sha");
  result.markerPath = marker;
  try {
    const sha = readFileSync(marker, "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(sha)) {
      result.validRelease = true;
      result.releaseSha = sha;
    }
  } catch {
    // Report invalid release without exposing content.
  }
  return result;
}

function serviceSnapshot(manager, name, controlHelper = "") {
  const result = { configured: Boolean(manager && name), manager, name, state: "not-configured", pid: 0, workingDirectory: "", executable: "", args: [] };
  if (!manager || !name || !/^[A-Za-z0-9_.@:-]+$/.test(name)) return result;

  if (controlHelper) {
    const actionPrefix = manager === "pm2" ? "ui" : manager === "systemd" ? "trading" : "";
    if (!actionPrefix) return { ...result, configured: true, state: "unsupported-manager" };
    const state = run("sudo", ["-n", controlHelper, `${actionPrefix}-state`]);
    const pid = run("sudo", ["-n", controlHelper, `${actionPrefix}-pid`]);
    const cwd = run("sudo", ["-n", controlHelper, `${actionPrefix}-cwd`]);
    if (manager === "systemd") {
      const execStart = run("systemctl", ["show", name, "--property", "ExecStart", "--value"]);
      const envFiles = run("systemctl", ["show", name, "--property", "EnvironmentFiles", "--value"]);
      return {
        configured: true,
        manager,
        name,
        state: state.stdout || "unknown",
        pid: Number(pid.stdout || 0) || 0,
        workingDirectory: cwd.stdout,
        executable: redact(execStart.stdout).slice(0, 1200),
        environmentFilePathsOnly: redact(envFiles.stdout).slice(0, 1200),
        args: [],
      };
    }
    return {
      configured: true,
      manager,
      name,
      state: state.stdout || "unknown",
      pid: Number(pid.stdout || 0) || 0,
      workingDirectory: cwd.stdout,
      executable: "fixed-control-helper",
      interpreter: "",
      args: [],
    };
  }

  if (manager === "systemd") {
    const state = run("systemctl", ["is-active", name]);
    const pid = run("systemctl", ["show", name, "--property", "MainPID", "--value"]);
    const cwd = run("systemctl", ["show", name, "--property", "WorkingDirectory", "--value"]);
    const execStart = run("systemctl", ["show", name, "--property", "ExecStart", "--value"]);
    const envFiles = run("systemctl", ["show", name, "--property", "EnvironmentFiles", "--value"]);
    return {
      configured: true,
      manager,
      name,
      state: state.stdout || "unknown",
      pid: Number(pid.stdout || 0) || 0,
      workingDirectory: cwd.stdout,
      executable: redact(execStart.stdout).slice(0, 1200),
      environmentFilePathsOnly: redact(envFiles.stdout).slice(0, 1200),
      args: [],
    };
  }

  if (manager === "pm2") {
    const list = run("pm2", ["jlist"]);
    try {
      const rows = JSON.parse(list.stdout || "[]");
      const row = rows.find(item => item?.name === name);
      return {
        configured: true,
        manager,
        name,
        state: row?.pm2_env?.status || "not-found",
        pid: Number(row?.pid || 0) || 0,
        workingDirectory: String(row?.pm2_env?.pm_cwd || ""),
        executable: String(row?.pm2_env?.pm_exec_path || ""),
        interpreter: String(row?.pm2_env?.exec_interpreter || ""),
        args: Array.isArray(row?.pm2_env?.args) ? row.pm2_env.args.map(value => redact(String(value)).slice(0, 240)) : [],
      };
    } catch {
      return { ...result, configured: true, state: "unknown" };
    }
  }

  return { ...result, configured: true, state: "unsupported-manager" };
}

function pathsEquivalent(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return realPath(left) && realPath(left) === realPath(right);
}

function logSummary(manager, name, controlHelper = "") {
  if (!manager || !name || !/^[A-Za-z0-9_.@:-]+$/.test(name)) return { available: false, errorCount: 0, warningCount: 0, recent: [] };
  let result;
  if (controlHelper) {
    const action = manager === "pm2" ? "ui-log" : manager === "systemd" ? "trading-log" : "";
    if (!action) return { available: false, errorCount: 0, warningCount: 0, recent: [] };
    result = run("sudo", ["-n", controlHelper, action]);
  } else if (manager === "systemd") result = run("journalctl", ["-u", name, "--since", "2 hours ago", "--no-pager", "-n", "500"]);
  else if (manager === "pm2") result = run("pm2", ["logs", name, "--nostream", "--lines", "500"]);
  else return { available: false, errorCount: 0, warningCount: 0, recent: [] };
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
  if (!path) return { ok: false };
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

function importantHashes(appDir) {
  if (!appDir || !existsSync(appDir)) return {};
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
  const parsed = safeJson(join(opsStateDir, "trading-last-preflight.json"));
  return parsed.ok ? parsed.value : { available: false, reason: parsed.reason || "not-found" };
}

function markdown(report) {
  const findings = report.findings.length ? report.findings.map(item => `- ${item}`) : ["- No configured fail-closed condition was detected."];
  return [
    "# VPS inspection",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Profile: ${report.profile}`,
    `- Overall: **${report.overall}**`,
    `- Source Git SHA: \`${report.git.source.sha || "unknown"}\``,
    `- Legacy UI Git SHA: \`${report.git.legacyUi.sha || "not-git"}\``,
    `- Legacy trading Git SHA: \`${report.git.legacyTrading.sha || "not-git"}\``,
    `- UI current release SHA: \`${report.layout.uiCurrent.releaseSha || "not-migrated"}\``,
    `- Trading current release SHA: \`${report.layout.tradingCurrent.releaseSha || "not-migrated"}\``,
    `- Trading staged release SHA: \`${report.layout.tradingStaged.releaseSha || "none"}\``,
    `- UI service cwd: \`${report.services.ui.workingDirectory || "unknown"}\``,
    `- Trading service cwd: \`${report.services.trading.workingDirectory || "unknown"}\``,
    `- Atomic layout ready: ${report.layout.atomicReady}`,
    `- UI: ${report.services.ui.state} (PID ${report.services.ui.pid})`,
    `- Trading: ${report.services.trading.state} (PID ${report.services.trading.pid})`,
    `- UI HTTP: ${report.http.ui.status || "not configured"}`,
    `- API HTTP: ${report.http.api.status || "not configured"}`,
    `- Kill Switch active signal: ${report.runtime.killSwitchActive}`,
    `- Pending-order signals: ${report.runtime.pendingOrderSignals}`,
    `- Manual-review signals: ${report.runtime.manualReviewSignals}`,
    `- Runtime JSON parse failures: ${report.runtime.parseFailures}`,
    `- Last no-order preflight status: ${report.lastPreflight.status || report.lastPreflight.reason || "unknown"}`,
    "",
    "## Findings",
    ...findings,
    "",
    "## Recent sanitized service signals",
    "### UI",
    ...(report.logs.ui.recent.length ? report.logs.ui.recent.map(line => `- ${line}`) : ["- None"]),
    "### Trading",
    ...(report.logs.trading.recent.length ? report.logs.trading.recent.map(line => `- ${line}`) : ["- None"]),
    "",
  ].join("\n");
}

function main() {
  const sourceDir = absolute("VPS_SOURCE_REPO_DIR");
  const legacyUiDir = absolute("VPS_UI_APP_DIR", false);
  const legacyTradingDir = absolute("VPS_TRADING_APP_DIR", false);
  const uiCurrentLink = absolute("VPS_UI_CURRENT_LINK", false);
  const tradingCurrentLink = absolute("VPS_TRADING_CURRENT_LINK", false);
  const tradingStagedLink = absolute("VPS_TRADING_STAGED_LINK", false);
  const uiReleasesDir = absolute("VPS_UI_RELEASES_DIR", false);
  const tradingReleasesDir = absolute("VPS_TRADING_RELEASES_DIR", false);
  const reportDir = absolute("VPS_REPORT_DIR");
  const opsStateDir = absolute("VPS_OPS_STATE_DIR");
  const stateRoot = absolute("VPS_STATE_ROOT", false);
  const targetCommit = optional("TARGET_COMMIT");
  const profile = optional("VPS_INSPECTION_PROFILE", "basic");
  if (!existsSync(sourceDir) || !lstatSync(sourceDir).isDirectory()) throw new Error(`VPS_SOURCE_REPO_DIR does not exist: ${sourceDir}`);
  mkdirSync(reportDir, { recursive: true, mode: 0o700 });

  const uiManager = optional("VPS_UI_SERVICE_MANAGER", "systemd");
  const tradingManager = optional("VPS_TRADING_SERVICE_MANAGER", "systemd");
  const uiName = optional("VPS_UI_SERVICE");
  const tradingName = optional("VPS_TRADING_SERVICE");
  const controlHelper = absolute("VPS_CONTROL_HELPER", false);
  const services = {
    ui: serviceSnapshot(uiManager, uiName, controlHelper),
    trading: serviceSnapshot(tradingManager, tradingName, controlHelper),
  };
  const layout = {
    mode: optional("VPS_DEPLOYMENT_LAYOUT_MODE", "unconfigured"),
    source: pathSnapshot(sourceDir),
    legacyUi: pathSnapshot(legacyUiDir),
    legacyTrading: pathSnapshot(legacyTradingDir),
    uiReleases: pathSnapshot(uiReleasesDir),
    tradingReleases: pathSnapshot(tradingReleasesDir),
    uiCurrent: releaseLinkSnapshot(uiCurrentLink),
    tradingCurrent: releaseLinkSnapshot(tradingCurrentLink),
    tradingStaged: releaseLinkSnapshot(tradingStagedLink),
    uiServiceUsesCurrent: pathsEquivalent(services.ui.workingDirectory, uiCurrentLink),
    tradingServiceUsesCurrent: pathsEquivalent(services.trading.workingDirectory, tradingCurrentLink),
    atomicReady: false,
  };
  layout.atomicReady = Boolean(
    layout.mode === "split-atomic-v2" &&
    layout.uiCurrent.validRelease &&
    layout.tradingCurrent.validRelease &&
    layout.uiServiceUsesCurrent &&
    layout.tradingServiceUsesCurrent,
  );

  const report = {
    schemaVersion: 2,
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
      filesystem: filesystemSnapshot(sourceDir),
    },
    git: {
      source: gitSnapshot(sourceDir, targetCommit),
      legacyUi: gitSnapshot(legacyUiDir),
      legacyTrading: gitSnapshot(legacyTradingDir),
    },
    layout,
    importantFileSha256: {
      source: importantHashes(sourceDir),
      legacyUi: importantHashes(legacyUiDir),
      legacyTrading: importantHashes(legacyTradingDir),
      uiCurrent: importantHashes(layout.uiCurrent.resolvedPath),
      tradingCurrent: importantHashes(layout.tradingCurrent.resolvedPath),
      tradingStaged: importantHashes(layout.tradingStaged.resolvedPath),
    },
    services,
    http: {
      ui: httpSnapshot(optional("VPS_UI_HEALTH_URL")),
      api: httpSnapshot(optional("VPS_API_HEALTH_URL")),
      trading: httpSnapshot(optional("VPS_TRADING_HEALTH_URL")),
    },
    logs: {
      ui: logSummary(uiManager, uiName, controlHelper),
      trading: logSummary(tradingManager, tradingName, controlHelper),
    },
    runtime: summarizeState(stateRoot),
    lastPreflight: lastPreflight(opsStateDir),
    executionProvenance: {
      uiExactShaProven: layout.uiCurrent.validRelease && layout.uiServiceUsesCurrent,
      uiSha: layout.uiCurrent.validRelease ? layout.uiCurrent.releaseSha : "unknown-build-provenance",
      tradingExactShaProven: layout.tradingCurrent.validRelease && layout.tradingServiceUsesCurrent,
      tradingSha: layout.tradingCurrent.validRelease ? layout.tradingCurrent.releaseSha : "unverifiable-legacy-directory",
    },
    findings: [],
  };

  if (!report.git.source.isGit) report.findings.push("VPS_SOURCE_REPO_DIR is not a Git checkout.");
  else if (!report.git.source.trackedClean) report.findings.push("Tracked files are modified in the source Git checkout.");
  if (targetCommit && !report.git.source.targetMatches) report.findings.push("The source Git SHA does not match the requested workflow SHA.");
  if (!report.services.ui.configured || !["active", "online"].includes(report.services.ui.state)) report.findings.push("The configured UI service is not healthy.");
  if (!report.services.trading.configured || !["active", "online"].includes(report.services.trading.state)) report.findings.push("The configured trading service is not healthy.");
  if (!report.http.ui.configured || !report.http.ui.ok) report.findings.push("The configured UI health endpoint is not returning HTTP 2xx.");
  if (!report.http.api.configured || !report.http.api.ok) report.findings.push("The configured API health endpoint is not returning HTTP 2xx.");
  if (report.http.trading.configured && !report.http.trading.ok) report.findings.push("The configured trading health endpoint is not returning HTTP 2xx.");
  if (!layout.uiCurrent.validRelease) report.findings.push("UI is not yet attached to a release containing an exact-SHA marker.");
  if (!layout.tradingCurrent.validRelease) report.findings.push("Trading is not yet attached to a release containing an exact-SHA marker.");
  if (layout.uiCurrent.validRelease && !layout.uiServiceUsesCurrent) report.findings.push("UI service working directory does not use VPS_UI_CURRENT_LINK.");
  if (layout.tradingCurrent.validRelease && !layout.tradingServiceUsesCurrent) report.findings.push("Trading service working directory does not use VPS_TRADING_CURRENT_LINK.");
  if (!report.executionProvenance.uiExactShaProven) report.findings.push("The running UI build cannot be proven to match an exact Git SHA.");
  if (!report.executionProvenance.tradingExactShaProven) report.findings.push("The running trading code cannot be proven to match an exact Git SHA.");
  if (report.runtime.parseFailures > 0) report.findings.push("One or more runtime JSON files could not be parsed; manual review is required.");
  if (report.runtime.killSwitchActive) report.findings.push("A Kill Switch signal is active. This inspection does not clear it.");
  if (report.runtime.pendingOrderSignals > 0) report.findings.push("Pending-order state was detected.");
  if (report.runtime.manualReviewSignals > 0) report.findings.push("Manual-review state was detected.");
  if (report.host.filesystem.ok && report.host.filesystem.usedPercent >= 90) report.findings.push("Filesystem usage is at or above 90%.");

  report.overall = report.findings.length === 0 ? "PASS" : "REVIEW_REQUIRED";
  writeFileSync(join(reportDir, "vps-inspection.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(reportDir, "vps-inspection.md"), `${markdown(report)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ overall: report.overall, reportDir, findingCount: report.findings.length, atomicReady: layout.atomicReady })}\n`);

  if (optional("VPS_STRICT_INSPECTION", "true") === "true" && report.findings.length > 0) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ overall: "FAILED", message: redact(error instanceof Error ? error.message : String(error)), ordersSent: false, servicesRestarted: false, secretsRead: false }));
  process.exitCode = 1;
}
