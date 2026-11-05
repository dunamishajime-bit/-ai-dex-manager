import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";

export const RENDER_ADVERSE_BAR_MS = 300_000;
export const RENDER_ADVERSE_EXIT_REASON = "RENDER_LEGACY_NEGATIVE1_WATCH2H_MFE_LT_025";

type PositionIdentity = { symbol: string; route: string; side: string; entryTs: number; entryPrice: number };
export type RenderAdverseState = {
  nextBarTs: number;
  watchStartedAt: number | null;
  maxFavorablePct: number;
  entryPrice: number;
  completed: boolean;
};

export function startRenderAdverse(position: PositionIdentity): RenderAdverseState | undefined {
  if (position.symbol !== "RENDERUSDT" || position.route !== "IDLE_RENDER_RELATIVE_SHORT" || position.side !== "SHORT") return;
  if (!Number.isSafeInteger(position.entryTs) || position.entryTs <= 0 ||
      !Number.isFinite(position.entryPrice) || position.entryPrice <= 0) throw Error("RENDER_ADVERSE_ENTRY_INVALID");
  return { nextBarTs: Math.ceil(position.entryTs / RENDER_ADVERSE_BAR_MS) * RENDER_ADVERSE_BAR_MS,
    watchStartedAt: null, maxFavorablePct: 0, entryPrice: position.entryPrice, completed: false };
}

export function validateRenderAdverse(position: PositionIdentity, state: RenderAdverseState) {
  const initial = startRenderAdverse(position);
  if (!initial || !state || state.entryPrice !== initial.entryPrice ||
      !Number.isSafeInteger(state.nextBarTs) || state.nextBarTs < initial.nextBarTs ||
      state.nextBarTs % RENDER_ADVERSE_BAR_MS !== 0 ||
      !Number.isFinite(state.maxFavorablePct) || state.maxFavorablePct < 0 || state.maxFavorablePct >= 100 ||
      typeof state.completed !== "boolean" ||
      (state.watchStartedAt !== null && (!Number.isSafeInteger(state.watchStartedAt) ||
        state.watchStartedAt % RENDER_ADVERSE_BAR_MS !== 0 || state.watchStartedAt <= initial.nextBarTs ||
        state.watchStartedAt > state.nextBarTs)) ||
      (state.completed && (state.watchStartedAt === null || state.nextBarTs - state.watchStartedAt < 7_200_000 ||
        state.maxFavorablePct >= 0.25))) throw Error("RENDER_ADVERSE_STATE_INVALID");
}

export function advanceRenderAdverse(state: RenderAdverseState, bar: ConfirmedFiveMinuteBar, now: number): RenderAdverseState {
  const closeTs = bar.timestampMs + RENDER_ADVERSE_BAR_MS;
  if (bar.timestampMs !== state.nextBarTs || !Number.isFinite(now) || closeTs > now ||
      ![bar.open, bar.high, bar.low, bar.close].every(price => Number.isFinite(price) && price > 0) ||
      bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
    throw Error("RENDER_ADVERSE_UNCONFIRMED_OR_GAP");
  }
  if (state.completed) return { ...state, nextBarTs: closeTs };
  const adverse = bar.close >= state.entryPrice * 1.01;
  const watchStartedAt = state.watchStartedAt ?? (adverse ? closeTs : null);
  const maxFavorablePct = Math.max(state.maxFavorablePct, (1 - bar.low / state.entryPrice) * 100);
  const ready = watchStartedAt !== null && closeTs - watchStartedAt >= 7_200_000;
  return {
    ...state, nextBarTs: closeTs, maxFavorablePct,
    watchStartedAt: ready && !adverse ? null : watchStartedAt,
    completed: ready && adverse && maxFavorablePct < 0.25 - 1e-10,
  };
}
