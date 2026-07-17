import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

const { isAutoTradePaused } = await import("@/lib/server/auto-trade-runtime-control");

const LOCK_PATH = path.join(process.cwd(), "data", "auto-trade-run.lock");
const LOCK_TTL_MS = Number(process.env.AUTO_TRADE_LOCK_TTL_MINUTES || 90) * 60 * 1000;

function cleanupOrphanLock() {
    try {
        const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as { pid?: number };
        const pid = Number(lock.pid || 0);
        if (!pid) return;
        try {
            process.kill(pid, 0);
        } catch {
            fs.unlinkSync(LOCK_PATH);
        }
    } catch {
        // Lock is absent or unreadable; normal acquisition handles it.
    }
}

function acquireRunLock() {
    cleanupOrphanLock();
    try {
        fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
        const fd = fs.openSync(LOCK_PATH, "wx");
        fs.writeFileSync(
            fd,
            JSON.stringify({
                startedAt: new Date().toISOString(),
                pid: process.pid,
                trigger: "scheduled_12h_worker",
            }),
            "utf8",
        );
        return fd;
    } catch (error) {
        const lockError = error as NodeJS.ErrnoException;
        if (lockError?.code !== "EEXIST") throw error;

        try {
            const stat = fs.statSync(LOCK_PATH);
            if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
                fs.unlinkSync(LOCK_PATH);
                const fd = fs.openSync(LOCK_PATH, "wx");
                fs.writeFileSync(
                    fd,
                    JSON.stringify({
                        startedAt: new Date().toISOString(),
                        pid: process.pid,
                        trigger: "scheduled_12h_worker",
                        staleRecovered: true,
                    }),
                    "utf8",
                );
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
    const runtime = isAutoTradePaused();
    if (runtime.paused) {
        console.log(JSON.stringify({ ok: true, skipped: true, reason: runtime.reason, paused: true }, null, 2));
        return;
    }

    const { runLiveHybridAutotrade } = await import("@/lib/server/live-hybrid-autotrade");
    const lockFd = acquireRunLock();
    if (lockFd === null) {
        console.log(JSON.stringify({ ok: false, skipped: true, reason: "12H auto trade worker is already running." }));
        return;
    }

    try {
        const summary = await runLiveHybridAutotrade(undefined, { trigger: "scheduled" });
        console.log(JSON.stringify({ ok: true, summary }, null, 2));
    } finally {
        releaseRunLock(lockFd);
    }
}

main().catch((error) => {
    console.error("[run-live-hybrid-once] failed:", error);
    process.exitCode = 1;
});
