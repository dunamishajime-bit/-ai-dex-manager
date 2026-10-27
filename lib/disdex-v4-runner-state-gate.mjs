/**
 * Keep the monitor's V4 order permission bound to the runner-owned state.
 * A certified/live process may still be fail-closed for an active safety
 * decision; certification alone must never turn that state into ALLOWED.
 */
export function resolveV4RunnerStateBlockReason(runner, state) {
    if (runner?.key !== "V12_V4") return "";
    const status = String(state?.status || "").trim().toLowerCase();
    const safetyState = String(state?.safetyState || "").trim().toUpperCase();
    if (status !== "blocked" && safetyState !== "BLOCKED") return "";
    const reason = String(state?.reason || "V12_V4 runner state reports blocked").trim();
    return `V12_V4 runner state blocks new orders: ${reason}`;
}
