/** Exact root-pinned IDLE owner identity for cross-runner preemption.
 *
 * Never infer ownership from a persistent state file. The caller V52 SHA is
 * separate and must not be used to validate the IDLE state.
 */
export function resolveIdleResidualOwnerShaForPreemption(
  env: { DISDEX_IDLE_PRIORITY_RUNTIME_SHA?: string },
): string {
  const owner = String(env.DISDEX_IDLE_PRIORITY_RUNTIME_SHA || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(owner)) {
    throw new Error("IDLE_RESIDUAL_PREEMPT_OWNER_SHA_REQUIRED");
  }
  return owner;
}
