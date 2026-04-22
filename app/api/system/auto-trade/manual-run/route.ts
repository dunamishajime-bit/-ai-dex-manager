import fs from "fs";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

import { runLiveHybridAutotrade } from "@/lib/server/live-hybrid-autotrade";

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
    if (lockError?.code !== "EEXIST") {
      throw error;
    }

    try {
      const stat = fs.statSync(LOCK_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > LOCK_TTL_MS) {
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
    return NextResponse.json({ ok: false, error: "ログイン状態を確認できないため、手動判定を実行できません。" }, { status: 401 });
  }

  const lockFd = acquireRunLock();
  if (lockFd === null) {
    return NextResponse.json(
      { ok: false, error: "自動売買判定がすでに実行中です。完了後にもう一度試してください。" },
      { status: 409 },
    );
  }

  try {
    const summary = await runLiveHybridAutotrade(undefined, { trigger: "manual" });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "手動トレード判定の実行中にエラーが発生しました。",
      },
      { status: 500 },
    );
  } finally {
    releaseRunLock(lockFd);
  }
}
