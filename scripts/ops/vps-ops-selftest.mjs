#!/usr/bin/env node

import { readFileSync } from "node:fs";

const failures = [];

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    failures.push(`missing or unreadable file: ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function requireMatch(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${path}: ${message}`);
}

function forbidMatch(path, text, pattern, message) {
  if (pattern.test(text)) failures.push(`${path}: ${message}`);
}

const requests = [
  "ops/requests/vps-inspection-request.json",
  "ops/requests/ui-deploy-request.json",
  "ops/requests/trading-code-deploy-request.json",
];
for (const path of requests) {
  const text = read(path);
  try {
    const value = JSON.parse(text);
    if (value.schemaVersion !== 1) failures.push(`${path}: schemaVersion must be 1`);
    if (value.targetCommit !== "workflow-head") failures.push(`${path}: targetCommit must be workflow-head`);
    if (!/^[A-Za-z0-9._:-]{3,120}$/.test(String(value.requestId || ""))) failures.push(`${path}: invalid requestId`);
    if (path !== "ops/requests/vps-inspection-request.json" && value.enabled !== false) failures.push(`${path}: deployment request template must remain disabled`);
  } catch (error) {
    failures.push(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const workflowPaths = [
  ".github/workflows/inspect-vps.yml",
  ".github/workflows/deploy-ui-vps.yml",
  ".github/workflows/deploy-trading-code-vps.yml",
  ".github/workflows/restart-trading-approved.yml",
];
for (const path of workflowPaths) {
  const text = read(path);
  requireMatch(path, text, /runs-on:\s*\[self-hosted, linux, x64, disdex-vps\]/, "must use the repository-dedicated runner label");
  requireMatch(path, text, /permissions:\s*\n\s+contents:\s+read/, "must use read-only repository contents permission");
  requireMatch(path, text, /cancel-in-progress:\s+false/, "must not cancel an in-progress VPS operation");
  requireMatch(path, text, /VPS_SOURCE_REPO_DIR/, "split-layout source directory variable is missing");
  requireMatch(path, text, /VPS_CONTROL_HELPER/, "fixed privileged control helper variable is missing");
  forbidMatch(path, text, /pull_request\s*:/, "VPS workflows must never run for pull_request events");
  forbidMatch(path, text, /issue_comment\s*:/, "VPS workflows must never accept issue comment commands");
}

const inspectWorkflow = read(".github/workflows/inspect-vps.yml");
requireMatch(".github/workflows/inspect-vps.yml", inspectWorkflow, /ops\/requests\/vps-inspection-request\.json/, "inspection request path trigger is missing");
requireMatch(".github/workflows/inspect-vps.yml", inspectWorkflow, /read-only/i, "inspection must be documented as read-only");
requireMatch(".github/workflows/inspect-vps.yml", inspectWorkflow, /VPS_UI_APP_DIR/, "legacy UI path must be inspected");
requireMatch(".github/workflows/inspect-vps.yml", inspectWorkflow, /VPS_TRADING_APP_DIR/, "legacy trading path must be inspected");

const uiWorkflow = read(".github/workflows/deploy-ui-vps.yml");
requireMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /ops\/requests\/ui-deploy-request\.json/, "UI request path trigger is missing");
requireMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /vps-deploy-ui\.sh/, "fixed UI deployment script is missing");
requireMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /VPS_UI_CURRENT_LINK/, "UI current link variable is missing");
forbidMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /restart-trading|ops_restart_trading/, "UI workflow must not restart trading");

const tradingWorkflow = read(".github/workflows/deploy-trading-code-vps.yml");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /ops\/requests\/trading-code-deploy-request\.json/, "trading code request path trigger is missing");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /vps-deploy-trading-code\.sh/, "fixed trading staging script is missing");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /VPS_TRADING_STAGED_LINK/, "trading staged link variable is missing");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE/, "fixed authenticated preflight service is missing");
forbidMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /ops_restart_trading|systemctl\s+restart|pm2\s+restart/, "trading code staging workflow must not restart trading");

const restartWorkflow = read(".github/workflows/restart-trading-approved.yml");
forbidMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /^\s+push\s*:/m, "restart workflow must be manual-only");
requireMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /environment:\s+trading-production/, "protected trading-production environment is required");
requireMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /I_APPROVE_LIVE_TRADING_DAEMON_RESTART/, "explicit restart confirmation phrase is missing");
requireMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /VPS_TRADING_CURRENT_LINK/, "atomic trading current link is missing");

const shellPaths = [
  "scripts/ops/vps-common.sh",
  "scripts/ops/vps-deploy-ui.sh",
  "scripts/ops/vps-deploy-trading-code.sh",
  "scripts/ops/vps-restart-trading-approved.sh",
  "scripts/ops/root/disdex-vps-control",
];
for (const path of shellPaths) {
  const text = read(path);
  requireMatch(path, text, /set -Eeuo pipefail/, "strict shell mode is required");
  forbidMatch(path, text, /\beval\b/, "eval is forbidden");
  forbidMatch(path, text, /\b(?:bash|sh)\s+-c\b/, "dynamic shell command execution is forbidden");
  forbidMatch(path, text, /(?:cat|source|\.)\s+[^\n]*\.env/, "scripts must not print or source .env files directly");
  forbidMatch(path, text, /in-place-reviewed/, "legacy in-place deployment mode must not return");
}

const common = read("scripts/ops/vps-common.sh");
requireMatch("scripts/ops/vps-common.sh", common, /split-atomic-v2/, "split atomic layout gate is required");
requireMatch("scripts/ops/vps-common.sh", common, /\.disdex-release-sha/, "exact release marker is required");
requireMatch("scripts/ops/vps-common.sh", common, /mv -Tf/, "atomic symlink replacement is required");
requireMatch("scripts/ops/vps-common.sh", common, /ops_run_preflight_service/, "fixed systemd preflight helper is required");

const tradingDeploy = read("scripts/ops/vps-deploy-trading-code.sh");
forbidMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /ops_restart_trading|systemctl\s+restart|pm2\s+restart/, "trading staging script must contain no restart operation");
requireMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /PASS_NO_ORDERS_SENT/, "no-order preflight proof is required");
requireMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /SERVICE_PID_AFTER.*SERVICE_PID_BEFORE|SERVICE_PID_BEFORE.*SERVICE_PID_AFTER/s, "PID preservation check is required");
requireMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /VPS_TRADING_STAGED_LINK/, "staged link must be written");
forbidMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /ops_atomic_symlink\s+[^\n]*VPS_TRADING_CURRENT_LINK/, "staging must never change the live current link");

const uiDeploy = read("scripts/ops/vps-deploy-ui.sh");
forbidMatch("scripts/ops/vps-deploy-ui.sh", uiDeploy, /ops_restart_trading/, "UI deploy script must not call the trading restart helper");
requireMatch("scripts/ops/vps-deploy-ui.sh", uiDeploy, /VPS_UI_CURRENT_LINK/, "UI atomic current link is required");
requireMatch("scripts/ops/vps-deploy-ui.sh", uiDeploy, /ROLLBACK_ATTEMPTED/, "UI rollback reporting is required");

const restart = read("scripts/ops/vps-restart-trading-approved.sh");
requireMatch("scripts/ops/vps-restart-trading-approved.sh", restart, /ops_atomic_symlink\s+"\$STAGED_RELEASE"\s+"\$VPS_TRADING_CURRENT_LINK"/, "approved restart must atomically switch the live link");
requireMatch("scripts/ops/vps-restart-trading-approved.sh", restart, /ops_restart_trading/, "approved restart must be the only script that restarts trading");

const inspection = read("scripts/ops/vps-inspection.mjs");
forbidMatch("scripts/ops/vps-inspection.mjs", inspection, /readFileSync\([^\n]*\.env/, "inspection must not read .env");
requireMatch("scripts/ops/vps-inspection.mjs", inspection, /secretsRead:\s*false/, "inspection must explicitly report that secrets were not read");
requireMatch("scripts/ops/vps-inspection.mjs", inspection, /servicesRestarted:\s*false/, "inspection must explicitly report zero restarts");
requireMatch("scripts/ops/vps-inspection.mjs", inspection, /executionProvenance/, "inspection must report execution provenance");
requireMatch("scripts/ops/vps-inspection.mjs", inspection, /atomicReady/, "inspection must report atomic-layout readiness");

const controlHelper = read("scripts/ops/root/disdex-vps-control");
requireMatch("scripts/ops/root/disdex-vps-control", controlHelper, /UI_PROCESS="ai-dex-manager-ui"/, "UI process must be fixed in the installed helper");
requireMatch("scripts/ops/root/disdex-vps-control", controlHelper, /TRADING_SERVICE="disdex-v96-v52-live\.service"/, "trading service must be fixed in the installed helper");
requireMatch("scripts/ops/root/disdex-vps-control", controlHelper, /PREFLIGHT_PREFIX="disdex-v96-v52-preflight"/, "preflight template must be fixed in the installed helper");
requireMatch("scripts/ops/root/disdex-vps-control", controlHelper, /PM2_FIELD="\$field"\s+"\$NODE"\s+-e/, "PM2 JSON must be parsed with node -e so piped jlist data remains on stdin");
requireMatch("scripts/ops/root/disdex-vps-control", controlHelper, /process\.stdin\.setEncoding\("utf8"\)/, "PM2 JSON parser must consume piped UTF-8 stdin");
forbidMatch("scripts/ops/root/disdex-vps-control", controlHelper, /\|\s*"\$NODE"\s+-\s+[^\n]*<<['"]?NODE/, "node stdin must not be used for both script source and piped PM2 JSON");
forbidMatch("scripts/ops/root/disdex-vps-control", controlHelper, /\beval\b|\b(?:bash|sh)\s+-c\b/, "control helper must not execute dynamic shell text");

const preflightUnit = read("ops/systemd/disdex-v96-v52-preflight@.service");
requireMatch("ops/systemd/disdex-v96-v52-preflight@.service", preflightUnit, /WorkingDirectory=\/home\/deploy\/disdex-trading\/releases\/%i/, "preflight unit must run the exact release instance");
requireMatch("ops/systemd/disdex-v96-v52-preflight@.service", preflightUnit, /EnvironmentFile=\/etc\/disdex\/disdex-v13d-v11eq-v96\.env/, "primary environment file path is missing");
requireMatch("ops/systemd/disdex-v96-v52-preflight@.service", preflightUnit, /EnvironmentFile=\/etc\/disdex\/disdex-v96-v52-live-overrides\.env/, "override environment file path is missing");

if (failures.length > 0) {
  console.error(JSON.stringify({ status: "VPS_OPS_SELFTEST_FAILED", failureCount: failures.length, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "VPS_OPS_SELFTEST_PASS",
  workflows: workflowPaths.length,
  requestTemplates: requests.length,
  invariants: {
    pullRequestTriggers: false,
    arbitraryShellInputs: false,
    splitAtomicLayoutOnly: true,
    tradingRestartDuringCodeStage: false,
    environmentApprovedRestartOnly: true,
    exactReleaseMarkers: true,
  },
}, null, 2));
