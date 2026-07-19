import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import {
  CURRENT_DISDEX_STRATEGY,
  type CurrentStrategyPosition,
  type CurrentStrategyStatusResponse,
} from "@/lib/current-strategy-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_FILE =
  process.env.DISDEX_V46_STATE_FILE ||
  "/home/deploy/ai-dex-manager-v46-live/.runtime-state/disdex-v46-live/runner-live.json";
const STATE_FRESHNESS_MS = 15 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positions(value: unknown): CurrentStrategyPosition[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const row = record(item);
    const symbol = stringValue(row.symbol);
    if (!symbol) return [];

    return [
      {
        symbol,
        quantity: finiteNumber(row.quantity) ?? 0,
        positionSide: stringValue(row.positionSide) || "BOTH",
        notionalUsd: finiteNumber(row.notionalUsd) ?? 0,
        entryPrice: finiteNumber(row.entryPrice) ?? 0,
        markPrice: finiteNumber(row.markPrice) ?? 0,
        updatedAt: finiteNumber(row.updatedAt) ?? 0,
      },
    ];
  });
}

function pendingUnknown(value: unknown, raw: Record<string, unknown>) {
  if (raw.pendingUnknown === true) return true;
  if (Array.isArray(value)) {
    return value.some((item) => record(item).status === "UNKNOWN");
  }
  return record(value).status === "UNKNOWN";
}

function fallback(): CurrentStrategyStatusResponse {
  return {
    ok: true,
    strategy: CURRENT_DISDEX_STRATEGY,
    runner: {
      mode: "LIVE",
      active: false,
      status: "unavailable",
      stateUpdatedAt: null,
      lastRunAt: null,
      recoveryStatus: "unavailable",
      recoveryReason: "V46 durable stateを取得できません。",
    },
    account: {
      walletBalance: null,
      availableBalance: null,
      equity: null,
      currentGross: null,
    },
    positions: [],
    safety: {
      openOrderCount: null,
      pendingUnknown: false,
      failures: [],
    },
    source: "unavailable",
    generatedAt: Date.now(),
  };
}

export async function GET() {
  try {
    const raw = record(JSON.parse(await readFile(STATE_FILE, "utf8")));
    const account = record(raw.accountSnapshot);
    const recovery = record(raw.recovery);
    const stateUpdatedAt = finiteNumber(raw.updatedAt);
    const lastRunAt = finiteNumber(raw.lastRunAt);
    const equity = finiteNumber(account.equity);
    const positionRows = positions(raw.positionsSnapshot);
    const grossNotional = positionRows.reduce((sum, position) => sum + Math.abs(position.notionalUsd), 0);
    const currentGross = equity && equity > 0 ? grossNotional / equity : null;
    const openOrderIds = Array.isArray(raw.lastOpenOrderClientOrderIds)
      ? raw.lastOpenOrderClientOrderIds.filter((value): value is string => typeof value === "string")
      : [];
    const age = stateUpdatedAt ? Math.max(0, Date.now() - stateUpdatedAt) : Number.POSITIVE_INFINITY;
    const active = age <= STATE_FRESHNESS_MS;

    const response: CurrentStrategyStatusResponse = {
      ok: true,
      strategy: CURRENT_DISDEX_STRATEGY,
      runner: {
        mode: "LIVE",
        active,
        status: active ? "active" : "stale",
        stateUpdatedAt,
        lastRunAt,
        recoveryStatus: stringValue(recovery.status) || "unknown",
        recoveryReason: stringValue(recovery.reason),
      },
      account: {
        walletBalance: finiteNumber(account.walletBalance),
        availableBalance: finiteNumber(account.availableBalance),
        equity,
        currentGross,
      },
      positions: positionRows,
      safety: {
        openOrderCount: openOrderIds.length,
        pendingUnknown: pendingUnknown(raw.pending, raw),
        failures: Array.isArray(raw.failures)
          ? raw.failures.filter((value): value is string => typeof value === "string").slice(-5)
          : [],
      },
      source: "v46-durable-state",
      generatedAt: Date.now(),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(fallback(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}

