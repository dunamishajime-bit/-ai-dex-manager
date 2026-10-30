#!/usr/bin/env node
// Read-only expiry watcher. Cannot refresh proofs, send orders or restart V4.
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { EVIDENCE_KEYS, EVIDENCE_FILE_NAMES, inspectV4EvidenceExpiry } from "./disdex-v12-v4-evidence-preflight.mjs";

const SHA = /^[0-9a-f]{40}$/;
export async function inspectRootEvidenceFiles({
  sha, directory = "/etc/disdex/v12-v4-evidence", now = Date.now(),
  warningWindowMs = 12 * 60 * 60 * 1000, requiredUid = 0,
}) {
  if (!SHA.test(String(sha || ""))) throw Error("V4_EVIDENCE_SHA_INVALID");
  const payloads = {};
  for (const key of EVIDENCE_KEYS) {
    const file = join(directory, EVIDENCE_FILE_NAMES[key]);
    const s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.uid !== requiredUid || (s.mode & 0o022))
      throw Error("V4_EVIDENCE_FILE_UNTRUSTED:" + key);
    const raw = await readFile(file, "utf8");
    if (raw.length > 65536) throw Error("V4_EVIDENCE_OVERSIZED:" + key);
    payloads[key] = JSON.parse(raw);
  }
  return inspectV4EvidenceExpiry({sha, payloads, now, warningWindowMs});
}
function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw Error("V4_MONITOR_ARG_INVALID:" + name);
  return value;
}
async function main() {
  const sha = arg("--sha");
  const directory = arg("--evidence-root", "/etc/disdex/v12-v4-evidence");
  // CLI intentionally NEVER accepts an owner-UID override.
  const result = await inspectRootEvidenceFiles({sha, directory});
  console.log(JSON.stringify({
    status: "V4_EVIDENCE_" + result.status,
    earliestExpiryAt: result.earliestExpiryAt,
    remainingMs: result.remainingMs,
    expiringKeys: result.evidence
      .filter(e => e.refreshRequired || (e.remainingMs !== null && e.remainingMs <= result.warningWindowMs))
      .map(e => e.key),
    requiredAction: result.status === "FRESH" ? "NONE" : "ROOT_OPERATOR_REVALIDATE_FROM_SOURCE",
    readOnly: true, authorizesTrading: false,
  }));
  // Warning and expired fail only this independent monitoring unit.
  return result.status === "FRESH" ? 0 : result.status === "EXPIRING_SOON" ? 3 : 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({
      status: "V4_EVIDENCE_MONITOR_BLOCKED", reason: String(error?.message || error),
      readOnly: true, authorizesTrading: false,
    }));
    process.exitCode = 2;
  });
}
