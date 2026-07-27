#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MAX_FILES = 250;
const MAX_BYTES = 2 * 1024 * 1024;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`required environment variable is empty: ${name}`);
  return value;
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
    }
  }
  return files;
}

function inspectValue(value, keyPath, findings, counters) {
  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((item, index) => inspectValue(item, [...keyPath, String(index)], findings, counters));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = [...keyPath, key].join(".");

    if ((normalized.includes("killswitch") || normalized === "halted") && child === true) {
      counters.killSwitchSignals += 1;
      findings.push(`active Kill Switch signal at ${path}`);
    }

    if (normalized === "pendingorder" || normalized === "pendingorders") {
      const present = Array.isArray(child)
        ? child.length > 0
        : child && typeof child === "object"
          ? Object.keys(child).length > 0
          : Boolean(child);
      if (present) {
        counters.pendingOrderSignals += 1;
        findings.push(`pending-order signal at ${path}`);
      }
    }

    if (normalized.includes("manualreview") && child) {
      counters.manualReviewSignals += 1;
      findings.push(`manual-review signal at ${path}`);
    }

    if (normalized.includes("unknownorder") && child) {
      counters.unknownOrderSignals += 1;
      findings.push(`unknown-order signal at ${path}`);
    }

    if (normalized.includes("reconciliation") && typeof child === "string" && /fail|unknown|review/i.test(child)) {
      counters.reconciliationSignals += 1;
      findings.push(`reconciliation warning at ${path}`);
    }

    inspectValue(child, [...keyPath, key], findings, counters);
  }
}

function main() {
  const root = resolve(required("VPS_STATE_ROOT"));
  const output = resolve(required("VPS_GATE_REPORT"));
  if (!root.startsWith("/") || root === "/") throw new Error("VPS_STATE_ROOT must be a non-root absolute path");
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`runtime state root does not exist: ${root}`);

  const findings = [];
  const counters = {
    filesScanned: 0,
    parseFailures: 0,
    killSwitchSignals: 0,
    pendingOrderSignals: 0,
    manualReviewSignals: 0,
    unknownOrderSignals: 0,
    reconciliationSignals: 0,
  };

  for (const file of walk(root)) {
    counters.filesScanned += 1;
    try {
      const stat = statSync(file);
      if (stat.size > MAX_BYTES) {
        counters.parseFailures += 1;
        findings.push(`state file exceeds safe scan size: ${basename(file)}`);
        continue;
      }
      const value = JSON.parse(readFileSync(file, "utf8"));
      inspectValue(value, [basename(file)], findings, counters);
    } catch {
      counters.parseFailures += 1;
      findings.push(`state JSON could not be parsed: ${basename(file)}`);
    }
  }

  if (counters.filesScanned === 0) findings.push("no runtime JSON state files were found");
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: findings.length === 0 ? "PASS" : "BLOCKED",
    failClosed: true,
    runtimeStateEdited: false,
    ordersSent: false,
    ...counters,
    findings: findings.slice(0, 100),
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (findings.length > 0) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ status: "FAILED", failClosed: true, message: error instanceof Error ? error.message : String(error), runtimeStateEdited: false, ordersSent: false }));
  process.exitCode = 1;
}
