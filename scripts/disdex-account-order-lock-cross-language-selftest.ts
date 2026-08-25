import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";

function sleep(ms: number) { return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)); }

function pythonAttempt(path: string, ownerId: string, holdSeconds: number) {
    const scripts = resolve(process.cwd(), "scripts");
    const code = [
        "import os,sys,time",
        `sys.path.insert(0, ${JSON.stringify(scripts)})`,
        "from disdex_account_order_lock import AccountOrderLock",
        `lock=AccountOrderLock(${JSON.stringify(path)}, 10000)`,
        `ok=lock.acquire(${JSON.stringify(ownerId)})`,
        "print('PY_ACQUIRED=' + ('true' if ok else 'false'), flush=True)",
        `time.sleep(${holdSeconds}) if ok else None`,
        "lock.release() if ok else None",
    ].join(";");
    return new Promise<string>((resolvePromise, reject) => {
        const child = spawn("/usr/bin/python3", ["-c", code], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                DISDEX_ACCOUNT_LOCK_ARBITRATION_MS: "800",
                DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS: "5000",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (codeValue) => {
            if (codeValue !== 0) reject(new Error(`python lock child failed (${codeValue}): ${stderr}`));
            else resolvePromise(stdout.trim());
        });
    });
}

async function main() {
    const root = await mkdtemp(join(tmpdir(), "disdex-cross-lock-"));
    const previousArbitration = process.env.DISDEX_ACCOUNT_LOCK_ARBITRATION_MS;
    const previousWaiterTtl = process.env.DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS;
    process.env.DISDEX_ACCOUNT_LOCK_ARBITRATION_MS = "800";
    process.env.DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS = "5000";
    try {
        // Python V52 P2 arrives first; Node V12 P4 arrives inside the same
        // arbitration window. P2 must win and Node must not create a lock.
        const p2Path = join(root, "p2-vs-p4.lock");
        const pythonP2 = pythonAttempt(p2Path, "V52:P2:live:900001:python", 0.5);
        await sleep(100);
        const nodeP4 = await new FileAccountOrderLock(p2Path, 10_000).acquire("V12_X1.00_ALL:P4:900002:node");
        const p2Output = await pythonP2;
        assert.match(p2Output, /PY_ACQUIRED=true/);
        assert.equal(nodeP4, null, "Python V52 P2 must beat Node V12 P4 in the same arbitration window");

        // Python P2 again arrives first, but a Node risk-reducing P1 waiter joins
        // inside the window. P1 must win even though it was registered later.
        const p1Path = join(root, "p1-vs-p2.lock");
        const pythonP2Again = pythonAttempt(p1Path, "V52:P2:live:900003:python", 0.0);
        await sleep(100);
        const nodeP1 = await new FileAccountOrderLock(p1Path, 10_000).acquire("V12_X1.00_ALL:P1:900004:node");
        const p1Output = await pythonP2Again;
        assert.match(p1Output, /PY_ACQUIRED=false/);
        assert.ok(nodeP1, "Node P1 reduce-only/protection work must beat Python V52 P2 despite later registration");
        await nodeP1.release();

        console.log("ACCOUNT_ORDER_LOCK_CROSS_LANGUAGE_PRIORITY_SELFTEST_PASS", JSON.stringify({ ordersSent: 0, exchangeCalls: 0 }));
    } finally {
        if (previousArbitration === undefined) delete process.env.DISDEX_ACCOUNT_LOCK_ARBITRATION_MS;
        else process.env.DISDEX_ACCOUNT_LOCK_ARBITRATION_MS = previousArbitration;
        if (previousWaiterTtl === undefined) delete process.env.DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS;
        else process.env.DISDEX_ACCOUNT_LOCK_WAITER_TTL_MS = previousWaiterTtl;
        await rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
