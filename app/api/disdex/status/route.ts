import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const SERVICE = "disdex-v96-v52-live.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { stdout } = await execFileAsync("systemctl", ["is-active", SERVICE], { timeout: 3000 });
    const active = stdout.trim() === "active";
    return NextResponse.json({ ok: true, service: SERVICE, active, mode: active ? "LIVE" : "STOPPED" });
  } catch {
    return NextResponse.json({ ok: true, service: SERVICE, active: false, mode: "STOPPED" });
  }
}
