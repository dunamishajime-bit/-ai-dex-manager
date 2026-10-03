import { readFile, stat } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StrategySpec = {
  id: string;
  label: string;
  description: string;
  heartbeatPath: string;
  statePaths: Record<string, string>;
};

const STRATEGIES: StrategySpec[] = [
  {
    id: "v12",
    label: "V12",
    description: "Formal Rank1/2 + Rank3 residual / symbol cooldown",
    heartbeatPath: "/var/lib/disdex/runner-health/heartbeats/v12-x1-all.json",
    statePaths: {
      runner: "/var/lib/disdex/v12-x1-all/runner.json",
      decision: "/var/lib/disdex/v12-x1-all/decision-snapshot.json",
    },
  },
  {
    id: "pengu",
    label: "PENGU",
    description: "Dual LS V2 Final",
    heartbeatPath: "/var/lib/disdex/runner-health/heartbeats/pengu-v8.json",
    statePaths: {
      runner: "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json",
    },
  },
  {
    id: "q102",
    label: "Q102",
    description: "Causal V1 / Formal priority handoff",
    heartbeatPath: "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json",
    statePaths: {
      state: "/var/lib/disdex/quality102-causal-v1/state.json",
      decision: "/var/lib/disdex/quality102-causal-v1/decision-snapshot.json",
      ranking: "/var/lib/disdex/quality102-causal-v1/decision-ranking-snapshot.json",
    },
  },
  {
    id: "v52",
    label: "V52",
    description: "Aster-only stock runner",
    heartbeatPath: "/var/lib/disdex/runner-health/heartbeats/v52.json",
    statePaths: {
      runner: "/var/lib/disdex/v52-aster-only/runner-live.json",
    },
  },
  {
    id: "fet",
    label: "FET",
    description: "BRK48 Residual",
    heartbeatPath: "/var/lib/disdex/runner-health/heartbeats/fet-brk48-residual.json",
    statePaths: {
      state: "/var/lib/disdex/fet-brk48-residual/state.json",
    },
  },
  {
    id: "hype",
    label: "HYPE",
    description: "Trend Long sidecar",
    heartbeatPath: "/var/lib/disdex/runner-health/heartbeats/hype-trend-long.json",
    statePaths: {},
  },
];

function authorized(req: NextRequest) {
  return req.cookies.get("disdex_auth")?.value === "1";
}

async function readJson(path: string) {
  try {
    const [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { value: JSON.parse(raw), mtimeMs: info.mtimeMs };
  } catch {
    return { value: null, mtimeMs: null };
  }
}

async function readText(path: string) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

const SENSITIVE = /(secret|token|password|api.?key|private.?key|signature|credential)/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.test(key)) continue;
    out[key] = sanitize(item, depth + 1);
  }
  return out;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function stringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const releaseSha = await readText(
    process.env.DISDEX_RELEASE_SHA_PATH || "/home/deploy/disdex-trading/current/.disdex-release-sha",
  );

  const strategies = await Promise.all(
    STRATEGIES.map(async (spec) => {
      const heartbeatRead = await readJson(spec.heartbeatPath);
      const heartbeat = heartbeatRead.value as Record<string, unknown> | null;
      const stateEntries = await Promise.all(
        Object.entries(spec.statePaths).map(async ([name, statePath]) => [name, await readJson(statePath)] as const),
      );

      const states: Record<string, unknown> = {};
      const stateMtimes: Record<string, number | null> = {};
      let fallbackSha: string | null = null;
      let fallbackUpdated: number | null = null;

      for (const [name, read] of stateEntries) {
        states[name] = sanitize(read.value);
        stateMtimes[name] = read.mtimeMs;
        const row = read.value as Record<string, unknown> | null;
        fallbackSha ||= row ? stringValue(row.runtimeCommitSha, row.runtimeSha, row.expectedRuntimeSha) : null;
        fallbackUpdated ||= row
          ? firstNumber(row.updatedAt, row.timestamp, row.ts, row.decisionTs, row.referenceTs)
          : null;
        fallbackUpdated ||= read.mtimeMs;
      }

      const status = heartbeat
        ? stringValue(heartbeat.status, heartbeat.safetyState, heartbeat.mode, heartbeat.state) || "HEARTBEAT_PRESENT"
        : "NO_HEARTBEAT";
      const runtimeSha = heartbeat
        ? stringValue(heartbeat.runtimeSha, heartbeat.runtimeCommitSha, heartbeat.expectedSha, heartbeat.expectedRuntimeSha) || fallbackSha
        : fallbackSha;
      const updatedAt = heartbeat
        ? firstNumber(
            heartbeat.updatedAt,
            heartbeat.timestamp,
            heartbeat.ts,
            heartbeat.lastSuccessAt,
            heartbeat.lastHeartbeatAt,
            heartbeat.generatedAt,
            heartbeatRead.mtimeMs,
          ) || fallbackUpdated
        : fallbackUpdated;

      return {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        status,
        runtimeSha,
        updatedAt,
        heartbeat: sanitize(heartbeat),
        heartbeatMtimeMs: heartbeatRead.mtimeMs,
        states,
        stateMtimes,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    releaseSha,
    strategies,
    visibleStrategies: ["V12", "PENGU", "Q102", "V52", "FET", "HYPE", "IDLE_PRIORITY", "FORMAL_PRIORITY"],
    retiredUiStrategies: ["ZEC"],
    updatedAt: Date.now(),
  });
}
