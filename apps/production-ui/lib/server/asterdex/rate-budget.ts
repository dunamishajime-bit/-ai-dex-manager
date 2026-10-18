import {
  deferAsterGlobalRateBudget,
  reserveAsterGlobalRateSlot,
} from "../../../../../lib/disdex-aster-global-rate-budget";
import type { AsterRatePriority } from "../../../../../lib/disdex-aster-rate-budget-policy";

const DEFAULT_RATE_BUDGET_PATH = "/var/lib/disdex/shared/aster-rate-budget.json";

function numericEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function productionUiRateBudgetPath() {
  return process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH?.trim() || DEFAULT_RATE_BUDGET_PATH;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * UI is a read-only observer, but it shares the same Aster IP and account as
 * the trading daemons. Every request must reserve from the same budget so a
 * browser refresh cannot bypass the trading-side protection queue.
 */
export async function waitForProductionUiAsterRateSlot(
  weight: number,
  priority: AsterRatePriority,
) {
  const slot = await reserveAsterGlobalRateSlot({
    path: productionUiRateBudgetPath(),
    minIntervalMs: numericEnv("DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS", 50, 1, 1_000),
    maxQueueMs: numericEnv("DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS", 5_000, 1, 30_000),
    weight,
    priority,
  });
  if (slot.waitMs > 0) await sleep(slot.waitMs);
  return slot;
}

export async function deferProductionUiAsterRateBudget(
  status: 418 | 429,
  cooldownMs: number,
) {
  return deferAsterGlobalRateBudget({
    path: productionUiRateBudgetPath(),
    status,
    cooldownMs: Math.max(0, Math.min(300_000, Math.floor(cooldownMs))),
  });
}
