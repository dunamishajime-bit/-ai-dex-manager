export function isIntentionallyDisabledV52State(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const positions = state.positions;
  return state.strategyId === "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96"
    && state.mode === "DISABLED"
    && state.status === "intentional-stop"
    && state.ordersAllowed === false
    && state.newOrdersAllowed === false
    && state.orderEnabled === false
    && state.disabledReason === "LIMITED_OVERLAY_SCOPE_V52_PEER_DISABLED"
    && positions && typeof positions === "object" && !Array.isArray(positions)
    && Object.keys(positions).length === 0
    && (state.pending ?? null) === null
    && (state.manualReview ?? null) === null;
}
