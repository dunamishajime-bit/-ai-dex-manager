import fs from "fs";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

import { runLiveHybridAutotrade } from "@/lib/server/live-hybrid-autotrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCK_PATH = path.join(process.cwd(), "data", "auto-trade-run.lock");
const LOCK_TTL_MS = 15 * 60 * 1000;

function isAuthorized(req: NextRequest) {
    const configuredSecret = process.env.AUTO_TRADE_RUN_SECRET?.trim();
    if (!configuredSecret) {
        const host = (req.headers.get("host") || "").trim().toLowerCase();
        return (
            process.env.NODE_ENV !== "production"
            || host.startsWith("127.0.0.1:")
            || host.startsWith("localhost:")
            || host === "127.0.0.1"
            || host === "localhost"
        );
    }

    const bearer = req.headers.get("authorization") || "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
    return token === configuredSecret;
}

function acquireRunLock() {
    try {
        fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
        const fd = fs.openSync(LOCK_PATH, "wx");
        fs.writeFileSync(fd, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }), "utf8");
        return fd;
    } catch (error) {
        const lockError = error as NodeJS.ErrnoException;
        if (lockError?.code !== "EEXIST") {
            throw error;
        }

        try {
            const stat = fs.statSync(LOCK_PATH);
            const ageMs = Date.now() - stat.mtimeMs;
            if (ageMs > LOCK_TTL_MS) {
                fs.unlinkSync(LOCK_PATH);
                const fd = fs.openSync(LOCK_PATH, "wx");
                fs.writeFileSync(fd, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid, staleRecovered: true }), "utf8");
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
        if (fs.existsSync(LOCK_PATH)) {
            fs.unlinkSync(LOCK_PATH);
        }
    } catch {
        // ignore
    }
}

export async function POST(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const lockFd = acquireRunLock();
    if (lockFd === null) {
        return NextResponse.json(
            { ok: false, error: "Auto trade run already in progress." },
            { status: 409 },
        );
    }

    try {
        const summary = await runLiveHybridAutotrade();
        return NextResponse.json({ ok: true, summary });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "Failed to run auto trade loop.",
            },
            { status: 500 },
        );
    } finally {
        releaseRunLock(lockFd);
    }
}
