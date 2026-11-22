/** Owner instruction 2026-11-23 JST: V4 NEW-ENTRY DD latch is 30%.
 * This is a peak-to-trough drawdown threshold for V4 entry admission and V4
 * offline certification, NOT a guarantee that portfolio max DD stays <=30%.
 * Existing open-position STOP/EXIT/reconciliation and other Runner DD limits
 * are unchanged. GLOBAL HOLD and LIVE order permissions remain independent.
 * Historical STABLE4 DD21 research evidence stays immutable.
 */
export const V12_V4_MAXIMUM_DRAWDOWN = 0.30;
