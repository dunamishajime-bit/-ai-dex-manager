export type IndependentRunnerHealth = {
  status: string;
  orderPermission: { allowed: boolean; reason: string };
};

export type IndependentHypeIdleHealthEnvelope = {
  hype: IndependentRunnerHealth;
  idle: IndependentRunnerHealth;
};

/**
 * Keep runner health as a per-owner envelope. A degraded owner must not be
 * collapsed into a shared boolean that falsely disables an unrelated runner.
 */
export function buildIndependentHypeIdleHealthEnvelope(input: IndependentHypeIdleHealthEnvelope): IndependentHypeIdleHealthEnvelope {
  return {
    hype: { status: input.hype.status, orderPermission: { ...input.hype.orderPermission } },
    idle: { status: input.idle.status, orderPermission: { ...input.idle.orderPermission } },
  };
}
