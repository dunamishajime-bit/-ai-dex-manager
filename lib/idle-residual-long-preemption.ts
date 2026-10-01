import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { DirectPosition, DirectTradeExecutor } from "./direct-trade-executor";
import type { V12AsterLiveAdapter } from "./v12-aster-live-adapter";
import { FileIdleResidualLongStateStore } from "./idle-residual-long-state";

const EPS = 1e-9;

function activePosition(positions: readonly DirectPosition[], symbol: string) {
  return positions.find((row) => row.symbol.toUpperCase() === symbol.toUpperCase() && Math.abs(row.quantity) > EPS);
}

export async function releaseIdleResidualLongForFormalEntry(input: {
  executor: DirectTradeExecutor;
  adapter: V12AsterLiveAdapter;
  lock: Pick<AccountLockHandle, "document">;
  positions: DirectPosition[];
  causeIdempotencyKey: string;
  expectedRuntimeSha: string;
  statePath?: string;
  enabled?: boolean;
  maxSlippageBps?: number;
  now?: () => number;
}) {
  if (input.enabled !== true) return { status: "not-needed" as const, message: "IDLE_RESIDUAL_PREEMPTION_DISABLED" };
  const sha = String(input.expectedRuntimeSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) return { status: "blocked" as const, message: "IDLE_RESIDUAL_PREEMPTION_SHA_REQUIRED" };
  const store = new FileIdleResidualLongStateStore(
    input.statePath || process.env.DISDEX_IDLE_RESIDUAL_LONG_STATE_PATH || "/var/lib/disdex/idle-priority/residual-long-state.json",
    sha,
  );
  const state = await store.load();
  if (state.manualReview) return { status: "blocked" as const, message: `IDLE_RESIDUAL_MANUAL_REVIEW:${state.manualReview}` };
  if (state.pending) return { status: "blocked" as const, message: "IDLE_RESIDUAL_PENDING_ORDER" };
  const owned = state.position;
  if (!owned) return { status: "not-needed" as const, message: "IDLE_RESIDUAL_NOT_ACTIVE" };
  const actual = activePosition(input.positions, owned.symbol);
  if (!actual) return { status: "blocked" as const, message: `IDLE_RESIDUAL_POSITION_MISSING:${owned.symbol}` };
  if (actual.quantity < 0 || actual.positionSide === "SHORT") return { status: "blocked" as const, message: `IDLE_RESIDUAL_POSITION_SIDE_MISMATCH:${owned.symbol}` };

  const quote = await input.executor.getMarketQuote(owned.symbol);
  const requestId = `res-pre-${input.causeIdempotencyKey}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 36);
  const result = await input.executor.executeMarket({
    requestId,
    clientOrderId: requestId,
    symbol: owned.symbol,
    side: "SELL",
    positionSide: "BOTH",
    quantity: Math.abs(actual.quantity),
    reduceOnly: true,
    expectedPrice: quote.bidPrice,
    maxSlippageBps: input.maxSlippageBps ?? 20,
    reason: "IDLE_RESIDUAL_LONG_FORMAL_PREEMPT",
  });
  if (result.status === "UNKNOWN" || result.executionUnknown) return { status: "blocked" as const, message: "IDLE_RESIDUAL_PREEMPTION_EXECUTION_UNKNOWN" };
  const after = await input.executor.getPositions();
  if (activePosition(after, owned.symbol)) return { status: "blocked" as const, message: `IDLE_RESIDUAL_PREEMPTION_POSITION_REMAINS:${owned.symbol}` };
  await input.adapter.cancel(owned.stopClientOrderId).catch(() => undefined);
  await input.adapter.cancel(owned.takeProfitClientOrderId).catch(() => undefined);
  state.position = null;
  state.lastDecision = {
    decisionTs: (input.now || Date.now)(),
    symbol: owned.symbol,
    route: owned.route,
    accepted: true,
    reason: `EXIT:FORMAL_PREEMPT:${input.causeIdempotencyKey}`,
  };
  await store.save(state);
  await input.lock.document();
  return { status: "reduced" as const, message: `IDLE_RESIDUAL_PREEMPTED:${owned.symbol}`, symbol: owned.symbol };
}
