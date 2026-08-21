import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

import { loadAsterDexClientConfig } from "@/lib/server/asterdex/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const FALLBACK_RELEASE = "";
const V12_STATE_PATH = process.env.V12_X1_ALL_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json";
const SHARED_KILL_SWITCH_PATH = process.env.DISDEX_SHARED_KILL_SWITCH_FILE || "/home/deploy/ai-dex-manager-v96-paper/.runtime-state/disdex-v13d-v11eq-v96/kill-switch.json";
const V12_ENV_PATH = "/etc/disdex/disdex-v12-x1-all.env";

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

async function readEnv(path: string) {
  try {
    const text = await readFile(path, "utf8");
    return Object.fromEntries(
      text.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]] : [];
      }),
    );
  } catch {
    return {} as Record<string, string>;
  }
}

async function currentRelease() {
  try {
    const resolved = await readlink("/home/deploy/disdex-trading/current");
    return resolved.split(/[\\/]/).filter(Boolean).at(-1) || FALLBACK_RELEASE;
  } catch {
    return FALLBACK_RELEASE;
  }
}

async function serviceState(unit: string) {
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "show",
      unit,
      "-p",
      "LoadState",
      "-p",
      "ActiveState",
      "-p",
      "SubState",
      "-p",
      "MainPID",
      "--no-pager",
    ]);
    const values = Object.fromEntries(stdout.trim().split(/\r?\n/).map((line) => {
      const index = line.indexOf("=");
      return index >= 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ""];
    }));
    return {
      unit,
      loadState: values.LoadState || "unknown",
      activeState: values.ActiveState || "unknown",
      subState: values.SubState || "unknown",
      mainPid: Number(values.MainPID || 0),
      active: values.ActiveState === "active" && values.SubState === "running",
    };
  } catch {
    return { unit, loadState: "unknown", activeState: "unknown", subState: "unknown", mainPid: 0, active: false };
  }
}

function asBoolean(value: unknown) {
  return ["1", "true", "yes", "on", "live"].includes(String(value || "").trim().toLowerCase());
}

function maskAddress(value: string | undefined) {
  const address = value?.trim() || "";
  if (!address) return null;
  if (address.length <= 12) return `${address.slice(0, 4)}***${address.slice(-3)}`;
  return `${address.slice(0, 6)}***${address.slice(-4)}`;
}

export async function GET() {
  const [release, env, runnerState, sharedKill, asterConfig] = await Promise.all([
    currentRelease(),
    readEnv(V12_ENV_PATH),
    readJson(V12_STATE_PATH),
    readJson(SHARED_KILL_SWITCH_PATH),
    Promise.resolve(loadAsterDexClientConfig()),
  ]);

  const suffix = release || "unknown";
  const [v12Service, penguService, v52Service] = await Promise.all([
    serviceState(`disdex-v12-x1-all@${suffix}.service`),
    serviceState(`disdex-pengu-dual-ls-v2@${suffix}.service`),
    serviceState(`disdex-v52-aster-only@${suffix}.service`),
  ]);

  const runnerKillSwitch = runnerState?.killSwitch as { active?: boolean; reason?: string } | undefined;
  const sharedKillSwitch = sharedKill as { active?: boolean; reason?: string } | null;
  const killSwitch = runnerKillSwitch || sharedKillSwitch || null;
  const manualReview = typeof runnerState?.manualReview === "string" ? runnerState.manualReview : null;
  const v12Configured = env.V12_X1_ALL_MODE === "LIVE"
    && asBoolean(env.V12_X1_ALL_ENABLED)
    && asBoolean(env.V12_X1_ALL_LIVE_TRADING_ENABLED)
    && asBoolean(env.V12_X1_ALL_LIVE_EXECUTION_ENABLED);
  const v12Running = v12Service.active && v12Configured && killSwitch?.active !== true && !manualReview;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    release,
    ownerBinding: {
      connected: Boolean(asterConfig?.userAddress),
      walletAddress: maskAddress(asterConfig?.userAddress),
      venue: "AsterDEX",
      strategies: ["V12", "PENGU V2", "V52"],
    },
    v12: {
      status: v12Running ? "running" : "blocked",
      mode: env.V12_X1_ALL_MODE || "UNKNOWN",
      enabled: v12Configured,
      service: v12Service,
      activePositions: Array.isArray(runnerState?.activePositions) ? runnerState.activePositions : [],
      killSwitch,
      manualReview,
      reason: !v12Service.active ? "V12 service is not active." : manualReview || (killSwitch?.active ? String(killSwitch.reason || "Kill Switch active.") : null),
    },
    pengu: {
      status: penguService.active ? "running" : "blocked",
      service: penguService,
    },
    v52: {
      status: v52Service.active ? "running" : "blocked",
      service: v52Service,
    },
    status: v12Running && penguService.active && v52Service.active ? "running" : "blocked",
  });
}
