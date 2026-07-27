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
  forbidMatch(path, text, /pull_request\s*:/, "VPS workflows must never run for pull_request events");
  forbidMatch(path, text, /issue_comment\s*:/, "VPS workflows must never accept issue comment commands");
}

const inspectWorkflow = read(".github/workflows/inspect-vps.yml");
requireMatch(".github/workflows/inspect-vps.yml", inspectWorkflow, /ops\/requests\/vps-inspection-request\.json/, "inspection request path trigger is missing");
requireMatch(".github/workflows/inspect-vps.yml", inspectWorkflow, /readOnly|read-only/i, "inspection must be documented as read-only");

const uiWorkflow = read(".github/workflows/deploy-ui-vps.yml");
requireMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /ops\/requests\/ui-deploy-request\.json/, "UI request path trigger is missing");
requireMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /vps-deploy-ui\.sh/, "fixed UI deployment script is missing");
requireMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /VPS_DEPLOYMENT_LAYOUT_MODE:\s*\$\{\{\s*vars\.VPS_DEPLOYMENT_LAYOUT_MODE\s*\}\}/, "reviewed deployment layout variable is required");
forbidMatch(".github/workflows/deploy-ui-vps.yml", uiWorkflow, /restart-trading|ops_restart_trading/, "UI workflow must not restart trading");

const tradingWorkflow = read(".github/workflows/deploy-trading-code-vps.yml");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /ops\/requests\/trading-code-deploy-request\.json/, "trading code request path trigger is missing");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /vps-deploy-trading-code\.sh/, "fixed trading staging script is missing");
requireMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /VPS_DEPLOYMENT_LAYOUT_MODE:\s*\$\{\{\s*vars\.VPS_DEPLOYMENT_LAYOUT_MODE\s*\}\}/, "reviewed deployment layout variable is required");
forbidMatch(".github/workflows/deploy-trading-code-vps.yml", tradingWorkflow, /ops_restart_trading|systemctl\s+restart|pm2\s+restart/, "trading code staging workflow must not restart trading");

const restartWorkflow = read(".github/workflows/restart-trading-approved.yml");
forbidMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /^\s+push\s*:/m, "restart workflow must be manual-only");
requireMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /environment:\s+trading-production/, "protected trading-production environment is required");
requireMatch(".github/workflows/restart-trading-approved.yml", restartWorkflow, /I_APPROVE_LIVE_TRADING_DAEMON_RESTART/, "explicit restart confirmation phrase is missing");

const shellPaths = [
  "scripts/ops/vps-common.sh",
  "scripts/ops/vps-deploy-ui.sh",
  "scripts/ops/vps-deploy-trading-code.sh",
  "scripts/ops/vps-restart-trading-approved.sh",
];
for (const path of shellPaths) {
  const text = read(path);
  requireMatch(path, text, /set -Eeuo pipefail/, "strict shell mode is required");
  forbidMatch(path, text, /\beval\b/, "eval is forbidden");
  forbidMatch(path, text, /\b(?:bash|sh)\s+-c\b/, "dynamic shell command execution is forbidden");
  forbidMatch(path, text, /(?:cat|source|\.)\s+[^\n]*\.env/, "scripts must not print or source .env files directly");
}

const tradingDeploy = read("scripts/ops/vps-deploy-trading-code.sh");
forbidMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /ops_restart_trading|systemctl\s+restart|pm2\s+restart/, "trading staging script must contain no restart operation");
requireMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /PASS_NO_ORDERS_SENT/, "no-order preflight proof is required");
requireMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /SERVICE_PID_AFTER.*SERVICE_PID_BEFORE|SERVICE_PID_BEFORE.*SERVICE_PID_AFTER/s, "PID preservation check is required");
requireMatch("scripts/ops/vps-deploy-trading-code.sh", tradingDeploy, /VPS_DEPLOYMENT_LAYOUT_MODE.*in-place-reviewed/s, "fail-closed deployment layout gate is required");

const uiDeploy = read("scripts/ops/vps-deploy-ui.sh");
forbidMatch("scripts/ops/vps-deploy-ui.sh", uiDeploy, /ops_restart_trading/, "UI deploy script must not call the trading restart helper");
requireMatch("scripts/ops/vps-deploy-ui.sh", uiDeploy, /ROLLBACK_ATTEMPTED/, "UI rollback reporting is required");
requireMatch("scripts/ops/vps-deploy-ui.sh", uiDeploy, /VPS_DEPLOYMENT_LAYOUT_MODE.*in-place-reviewed/s, "fail-closed deployment layout gate is required");

const inspection = read("scripts/ops/vps-inspection.mjs");
forbidMatch("scripts/ops/vps-inspection.mjs", inspection, /readFileSync\([^\n]*\.env/, "inspection must not read .env");
requireMatch("scripts/ops/vps-inspection.mjs", inspection, /secretsRead:\s*false/, "inspection must explicitly report that secrets were not read");
requireMatch("scripts/ops/vps-inspection.mjs", inspection, /servicesRestarted:\s*false/, "inspection must explicitly report zero restarts");

const layoutAddendum = read("docs/implementation/PLUS_VPS_RUNNER_LAYOUT_ADDENDUM.md");
requireMatch("docs/implementation/PLUS_VPS_RUNNER_LAYOUT_ADDENDUM.md", layoutAddendum, /VPS_DEPLOYMENT_LAYOUT_MODE/, "layout gate documentation is required");
requireMatch("docs/implementation/PLUS_VPS_RUNNER_LAYOUT_ADDENDUM.md", layoutAddendum, /atomic release|atomic releases/i, "safe alternative deployment guidance is required");

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
    tradingRestartDuringCodeStage: false,
    deploymentLayoutFailClosed: true,
    environmentApprovedRestartOnly: true,
  },
}, null, 2));
