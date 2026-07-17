import "dotenv/config";
import fs from "fs";
import path from "path";

import { runPenguStrongOverrideAutotrade } from "@/lib/server/live-hybrid-autotrade";

const LOCK_PATH = path.join(process.cwd(), "data", "pengu-strong-run.lock");
const LOCK_TTL_MS = 15 * 60 * 1000;

function acquireRunLock() {
    try {
        fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
        const fd = fs.openSync(LOCK_PATH, "wx");
        fs.writeFileSync(fd, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid, trigger: "pengu_15m_worker" }), "utf8");
        return fd;
    } catch (error) {
        const lockError = error as NodeJS.ErrnoException;
        if (lockError?.code !== "EEXIST") throw error;

        try {
            const stat = fs.statSync(LOCK_PATH);
            if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
                fs.unlinkSync(LOCK_PATH);
                const fd = fs.openSync(LOCK_PATH, "wx");
                fs.writeFileSync(fd, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid, trigger: "pengu_15m_worker", staleRecovered: true }), "utf8");
                return fd;
            }
        } catch {
            // fall through to active lock response
        }

        return null;
    }
}

function releaseRunLock(fd: number | null) {
    if (fd === null) return;
    try {
        fs.closeSync(fd);
    } catch {
        // ignore
    }
    try {
        if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
    } catch {
        // ignore
    }
}

async function main() {
    const lockFd = acquireRunLock();
    if (lockFd === null) {
        console.log(JSON.stringify({ ok: false, skipped: true, reason: "PENGU 15m strong override is already running." }));
        return;
    }

    try {
        const summary = await runPenguStrongOverrideAutotrade();
        console.log(JSON.stringify({ ok: true, summary }, null, 2));
    } finally {
        releaseRunLock(lockFd);
    }
}

main().catch((error) => {
    console.error("[run-pengu-strong-once] failed:", error);
    process.exitCode = 1;
});
