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
// Advisory only: this root-owned lease is not an authorization source for
// this monitor. An absent deployment directory means the feature is not yet
// staged; an installed directory with no matching lease is BLOCKED.
export async function inspectRootRefreshLease({
  sha, directory = "/var/lib/disdex/unified-deploy/refresh-leases/v4",
  now = Date.now(), warningWindowMs = 12 * 60 * 60 * 1000, requiredUid = 0,
}) {
  if (!SHA.test(String(sha || "")) || !Number.isFinite(now)
      || !Number.isFinite(warningWindowMs) || warningWindowMs < 0
      || warningWindowMs > 24 * 60 * 60 * 1000) {
    throw Error("V4_REFRESH_LEASE_MONITOR_INPUT_INVALID");
  }
  let dir;
  try { dir = await lstat(directory); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== requiredUid || (dir.mode & 0o022)) {
    throw Error("V4_REFRESH_LEASE_DIRECTORY_UNTRUSTED");
  }
  const path = join(directory, sha + ".json");
  let file;
  try { file = await lstat(path); }
  catch (error) {
    if (error?.code === "ENOENT") throw Error("V4_REFRESH_LEASE_MISSING");
    throw error;
  }
  if (!file.isFile() || file.isSymbolicLink() || file.uid !== requiredUid || (file.mode & 0o077)) {
    throw Error("V4_REFRESH_LEASE_FILE_UNTRUSTED");
  }
  const raw = await readFile(path, "utf8");
  if (raw.length > 16384) throw Error("V4_REFRESH_LEASE_OVERSIZED");
  const lease = JSON.parse(raw);
  const approvedAt = lease?.approvedAt;
  const expiresAt = lease?.expiresAt;
  if (lease?.schema !== "disdex-v4-evidence-refresh-lease/v1"
      || lease?.scope !== "V4_EVIDENCE_REFRESH_ONLY"
      || lease?.approvedSha !== sha
      || lease?.approvedRunner !== "V12_V4"
      || JSON.stringify(lease?.approvedRunners) !== '["V12_V4"]'
      || lease?.approvedShaByRunner?.V12_V4 !== sha
      || lease?.deploymentTarget !== "professional-dismanager.net"
      || lease?.operatorTarget !== "DD1296_FINAL_ALLIN_10BPS"
      || lease?.ordersEnabled !== false
      || !((lease?.signatureVerified === true
            && lease?.authorizationMethod === "OWNER_SIGNED_TOKEN")
          || (lease?.route === "CODEX_SSH"
              && lease?.signatureVerified === false
              && lease?.authorizationMethod === "ROOT_SSH_SESSION"))
      || !/^[0-9a-f]{64}$/.test(String(lease?.approvalNonceDigest || ""))
      || !/^[0-9a-f]{64}$/.test(String(lease?.planSha256 || ""))
      || !Number.isInteger(approvedAt) || !Number.isInteger(expiresAt)
      || approvedAt * 1000 > now + 30000 || expiresAt <= approvedAt
      || expiresAt - approvedAt > 86400) {
    throw Error("V4_REFRESH_LEASE_METADATA_INVALID");
  }
  const remainingMs = expiresAt * 1000 - now;
  return {
    status: remainingMs < 0 ? "EXPIRED" : remainingMs <= warningWindowMs ? "EXPIRING_SOON" : "FRESH",
    earliestExpiryAt: new Date(expiresAt * 1000).toISOString(),
    remainingMs,
    expiringKeys: remainingMs <= warningWindowMs ? ["refreshLease"] : [],
    readOnly: true, authorizesTrading: false,
  };
}

export function combineV4EvidenceAndLease(evidence, lease) {
  if (!lease) return { ...evidence, lease: null };
  const order = { FRESH: 0, EXPIRING_SOON: 1, EXPIRED: 2, BLOCKED: 3 };
  if (!(evidence.status in order) || !(lease.status in order)) {
    throw Error("V4_REFRESH_LEASE_STATUS_INVALID");
  }
  const expiries = [evidence.earliestExpiryAt, lease.earliestExpiryAt]
    .map(value => Date.parse(String(value || ""))).filter(Number.isFinite);
  const remaining = [evidence.remainingMs, lease.remainingMs]
    .filter(value => typeof value === "number" && Number.isFinite(value));
  return {
    ...evidence,
    status: order[lease.status] > order[evidence.status] ? lease.status : evidence.status,
    earliestExpiryAt: expiries.length ? new Date(Math.min(...expiries)).toISOString() : undefined,
    remainingMs: remaining.length ? Math.min(...remaining) : null,
    lease,
  };
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
  const evidence = await inspectRootEvidenceFiles({sha, directory});
  const lease = await inspectRootRefreshLease({sha});
  const result = combineV4EvidenceAndLease(evidence, lease);
  console.log(JSON.stringify({
    status: "V4_EVIDENCE_" + result.status,
    earliestExpiryAt: result.earliestExpiryAt,
    remainingMs: result.remainingMs,
    expiringKeys: result.evidence
      .filter(e => e.refreshRequired || (e.remainingMs !== null && e.remainingMs <= result.warningWindowMs))
      .map(e => e.key).concat(result.lease?.expiringKeys || []),
    refreshLeaseStatus: result.lease?.status || "NOT_INSTALLED",
    requiredAction: result.status === "FRESH" ? "NONE" :
      result.lease && result.lease.status !== "FRESH" ? "OWNER_SIGNED_REFRESH_LEASE_RENEWAL_REQUIRED" :
      "ROOT_OPERATOR_REVALIDATE_FROM_SOURCE",
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
