import fs from "fs";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

import { isAutoTradePaused } from "@/lib/server/auto-trade-runtime-control";
import { runActiveAutoTrade } from "@/lib/server/auto-trade-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCK_PATH = path.join(process.cwd(), "data", "auto-trade-run.lock");
const LOCK_TTL_MS = 15 * 60 * 1000;

function isAuthorized(req: NextRequest) {
  return req.cookies.get("disdex_auth")?.value === "1";
}

function acquireRunLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(fd, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid, trigger: "manual" }), "utf8");
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
          JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid, trigger: "manual", staleRecovered: true }),
          "utf8",
        );
        return fd;
      }
    } catch {
      // fall through
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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "ログイン状態を確認してください。" },
      { status: 401 },
    );
  }

  const runtime = isAutoTradePaused();
  if (runtime.paused) {
    return NextResponse.json(
      { ok: false, error: runtime.reason, paused: true, runtimeControl: runtime.control },
      { status: 423 },
    );
  }

  const lockFd = acquireRunLock();
  if (lockFd === null) {
    return NextResponse.json(
      { ok: false, error: "自動売買はすでに実行中です。少し待ってから再実行してください。" },
      { status: 409 },
    );
  }

  try {
    const summary = await runActiveAutoTrade("manual");
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "手動トレード判定の実行に失敗しました。",
      },
      { status: 500 },
    );
  } finally {
    releaseRunLock(lockFd);
  }
}
