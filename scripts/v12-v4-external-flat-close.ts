import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, lstat } from "node:fs/promises";
import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { V4ExecutionStore } from "../lib/v12-v4-execution-store";
import { reconcileV4ExternalFlatClose } from "../lib/v12-v4-venue-exit";

const root = "/var/lib/disdex";
const path = root + "/v12-v4/orders.json";
const pendingPath = root + "/shared/pending-exposure.json";
const killPath = root + "/shared/kill-switch.json";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const endpoints = new Set(["time", "positionRisk", "openOrders", "order", "userTrades", "income"]);

function readOnlyFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    if ((init?.method ?? request?.method ?? "GET") !== "GET" || init?.body || request?.body ||
        url.origin !== "https://fapi.asterdex.com" || url.username || url.password || url.hash ||
        !url.pathname.startsWith("/fapi/v3/") || !endpoints.has(url.pathname.slice(9)))
        throw Error("V4_EXTERNAL_CLOSE_READ_ONLY_BOUNDARY");
    return fetch(input, { ...init, redirect: "error" });
}

function assertStopped(sha: string) {
    const pins = JSON.parse(execFileSync("/usr/bin/cat", ["/etc/disdex/runner-pins.json"], { encoding: "utf8" }));
    if (pins.runners?.V12_V4?.sha !== sha || pins.runners.V12_V4.serviceUnit !== `disdex-v12-v4@${sha}.service`)
        throw Error("V4_EXTERNAL_CLOSE_PIN_CHANGED");
    const writers = execFileSync("/usr/bin/systemctl", ["list-units", "--no-legend", "--plain", "--no-pager",
        "--state=active,activating,deactivating,reloading", "disdex-v12-v4@*.service"], { encoding: "utf8" });
    if (writers.trim()) throw Error("V4_EXTERNAL_CLOSE_WRITER_NOT_STOPPED");
}

async function main() {
    const [sha, mode, expected, extra] = process.argv.slice(2);
    if (!/^[0-9a-f]{40}$/.test(sha ?? "") || extra ||
        !((mode === "--preview" && !expected) || (mode === "--apply" && /^[0-9a-f]{64}$/.test(expected ?? ""))))
        throw Error("V4_EXTERNAL_CLOSE_ARGUMENTS_INVALID");
    if (!process.getuid?.() || process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH !== root + "/shared/aster-rate-budget.json")
        throw Error("V4_EXTERNAL_CLOSE_DEPLOY_IDENTITY_OR_RATE_BUDGET");
    assertStopped(sha);
    const store = new V4ExecutionStore(path, sha);
    const lock = new FileAccountOrderLock(root + "/shared/account-order.lock", 120_000, pendingPath);
    const lease = await lock.acquire("V12_V4_EXTERNAL_FLAT_CLOSE");
    if (!lease) throw Error("V4_EXTERNAL_CLOSE_ACCOUNT_LOCK_BUSY");
    try {
        const before = await readFile(path);
        if (expected && hash(before) !== expected) throw Error("V4_EXTERNAL_CLOSE_REVIEWED_HASH_MISMATCH");
        const doc = store.read(), stat = await lstat(path);
        if (stat.uid !== process.getuid() || stat.gid !== process.getgid() || (stat.mode & 0o777) !== 0o600)
            throw Error("V4_EXTERNAL_CLOSE_STATE_OWNER_MISMATCH");
        const kill = await readFile(killPath);
        const hold = JSON.parse(kill.toString("utf8"));
        if (hold.active !== true || hold.scope !== "GLOBAL" || hold.action !== "HOLD_PROTECTED")
            throw Error("V4_EXTERNAL_CLOSE_PROTECTED_HOLD_REQUIRED");
        const legs = Object.values(doc.state.legs).filter(row => row.qty > 0);
        const [leg] = legs;
        if (legs.length !== 1) throw Error("V4_EXTERNAL_CLOSE_OWNER_AMBIGUOUS");
        const stopId = doc.protections[leg.id]?.stopClientOrderId;
        if (!stopId) throw Error("V4_EXTERNAL_CLOSE_STOP_ID_REQUIRED");
        const startedAt = Date.now(), symbol = leg.candidate.symbol;
        if (startedAt - leg.entryTs > 86_400_000) throw Error("V4_EXTERNAL_CLOSE_HISTORY_WINDOW_TOO_LARGE");
        const client = new AsterV3Client({
            baseUrl: process.env.ASTER_FUTURES_BASE_URL, userAddress: process.env.ASTER_USER_ADDRESS,
            privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
            requestTimeoutMs: 10000, readOnlyRateLimitMaxRetries: 0, fetchImpl: readOnlyFetch,
        });
        if (!client.hasTradingCredentials()) throw Error("V4_EXTERNAL_CLOSE_CREDENTIALS_REQUIRED");
        const trades = await client.getUserTrades(symbol, { startTime: leg.entryTs, endTime: startedAt, limit: 1000 });
        if (trades.length !== 2) throw Error("V4_EXTERNAL_CLOSE_HISTORY_NOT_EXACT");
        const times = trades.map(t => Number(t.time));
        const funding = await client.getIncomeHistory({ symbol, incomeType: "FUNDING_FEE",
            startTime: Math.min(...times), endTime: Math.max(...times), limit: 1000 });
        const stop = await client.getOrder(symbol, stopId);
        const positions = await client.getPositions(), openOrders = await client.getOpenOrders();
        const pendingMeta = await lstat(pendingPath);
        if (!pendingMeta.isFile() || pendingMeta.isSymbolicLink()) throw Error("V4_EXTERNAL_CLOSE_PENDING_REQUIRED");
        const pending = await readPendingExposureRegistry(pendingPath);
        const observedAt = Date.now(), pendingCount = pending.entries.filter(row => row.status !== "RELEASED").length;
        if (observedAt - startedAt > 30000 || pending.updatedAt > observedAt ||
            observedAt - pending.updatedAt > 300000) throw Error("V4_EXTERNAL_CLOSE_EVIDENCE_STALE");
        const next = reconcileV4ExternalFlatClose(doc, { positions, openOrders, pendingCount, stop, trades, funding, observedAt });
        const checkBaseline = async () => {
            await lease.renew();
            assertStopped(sha);
            if (!(await readFile(path)).equals(before) || !(await readFile(killPath)).equals(kill) ||
                !(await lstat(pendingPath)).isFile() ||
                JSON.stringify(await readPendingExposureRegistry(pendingPath)) !== JSON.stringify(pending) ||
                Date.now() - startedAt > 30000)
                throw Error("V4_EXTERNAL_CLOSE_BASELINE_CHANGED");
        };
        await checkBaseline();
        let backupPath: string | undefined;
        if (mode === "--apply") {
            backupPath = path + ".external-close." + randomUUID() + ".bak";
            const backup = await open(backupPath, "wx", 0o600);
            try { await backup.writeFile(before); await backup.sync(); } finally { await backup.close(); }
            await checkBaseline();
            store.commit(doc.revision, next);
        }
        console.log(JSON.stringify({
            status: mode === "--apply" ? "V4_EXTERNAL_CLOSE_APPLIED" : "V4_EXTERNAL_CLOSE_PREVIEW",
            sha, symbol, priorSha256: hash(before), afterSha256: mode === "--apply" ? hash(await readFile(path)) : undefined,
            backupPath, pendingCount, remainingQty: next.state.legs[leg.id].qty,
            priorRevision: doc.revision, executionReviewPreserved: Boolean(next.state.executionReview),
            ordersSent: 0, cancelsSent: 0, positionChangesSent: 0,
        }));
    } finally { await lease.release(); }
}

main().catch(error => {
    const reason = String(error?.message ?? "").match(/\b(?:V4_EXTERNAL_CLOSE|ASTER)_[A-Z0-9_]+\b/)?.[0];
    console.error(JSON.stringify({ status: "V4_EXTERNAL_CLOSE_BLOCKED", reason: reason ?? "EVIDENCE_OR_STATE_ERROR" }));
    process.exitCode = 2;
});
