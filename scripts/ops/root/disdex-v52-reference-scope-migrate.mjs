import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const APPLY_ACK = "I_ACK_REAL_MONEY_LIVE_ACTIVATION";
const SHA = /^[0-9a-f]{40}$/;
const KILL_PATH = "/var/lib/disdex/shared/kill-switch.json";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

function isAllowlistedReferenceHold(value) {
  return value && typeof value === "object"
    && value.active === true
    && value.action === "HOLD_PROTECTED"
    && value.recoverable === true
    && value.operator === "disdex-v52-aster-only"
    && typeof value.reason === "string"
    && value.reason.startsWith("V52 recoverable tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=")
    && value.reason.includes('{"error":"stale_quote"');
}

async function regularRootFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error("V52_REFERENCE_SCOPE_KILL_FILE_NOT_ROOT_SECURE");
  }
}

async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.scope.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function archive(path, bytes, requestId) {
  const root = resolve(dirname(path), "recovery-archive");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const target = resolve(root, `${new Date().toISOString().replace(/[:.]/g, "-")}-${requestId}-v52-reference-scope-${digest}.json`);
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  await chmod(target, 0o600);
  return target;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verifyOnly = process.argv.includes("--verify-only");
  if (apply === verifyOnly) throw new Error("V52_REFERENCE_SCOPE_REQUIRES_EXACTLY_ONE_OF_APPLY_OR_VERIFY_ONLY");
  const sha = arg("--sha").trim().toLowerCase();
  if (!SHA.test(sha)) throw new Error("V52_REFERENCE_SCOPE_EXACT_SHA_REQUIRED");
  if (apply && arg("--ack") !== APPLY_ACK) throw new Error("V52_REFERENCE_SCOPE_APPLY_ACK_REQUIRED");
  const releaseRoot = resolve(arg("--release-root") || `/home/deploy/disdex-trading/releases/${sha}`);
  const marker = (await readFile(resolve(releaseRoot, ".disdex-release-sha"), "utf8")).trim().toLowerCase();
  if (marker !== sha) throw new Error("V52_REFERENCE_SCOPE_RELEASE_MARKER_MISMATCH");
  await regularRootFile(KILL_PATH);
  const before = await readFile(KILL_PATH);
  const parsed = JSON.parse(before.toString("utf8"));
  if (parsed.scope && parsed.scope !== "V52_REFERENCE_ONLY") throw new Error("V52_REFERENCE_SCOPE_EXISTING_SCOPE_CONFLICT");
  if (!isAllowlistedReferenceHold(parsed)) throw new Error("V52_REFERENCE_SCOPE_KILL_REASON_NOT_ALLOWLISTED");
  const requestId = `v52-reference-scope-${Date.now()}-${process.pid}`;
  if (verifyOnly) {
    console.log(JSON.stringify({ status: "V52_REFERENCE_SCOPE_VERIFY_PASS", sha, killSwitchActive: true, scope: parsed.scope || null, reason: parsed.reason, mutationCalls: 0, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    return;
  }
  const archivePath = await archive(KILL_PATH, before, requestId);
  await atomicJson(KILL_PATH, {
    ...parsed,
    scope: "V52_REFERENCE_ONLY",
    scopeReason: "US_EQUITY_REFERENCE_FEED_ONLY; crypto V4 shared risk remains independently gated",
    scopeChangedAt: new Date().toISOString(),
    scopeMigrationSha: sha,
    scopeRequestId: requestId,
  });
  const after = JSON.parse(await readFile(KILL_PATH, "utf8"));
  if (!isAllowlistedReferenceHold(after) || after.scope !== "V52_REFERENCE_ONLY") throw new Error("V52_REFERENCE_SCOPE_POSTCHECK_FAILED");
  console.log(JSON.stringify({ status: "V52_REFERENCE_SCOPE_APPLY_PASS", sha, killSwitchActive: true, scope: after.scope, archivePath, mutationCalls: 0, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "V52_REFERENCE_SCOPE_FAIL_CLOSED", reason: String(error?.message || error), mutationCalls: 0, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
  process.exitCode = 1;
});
