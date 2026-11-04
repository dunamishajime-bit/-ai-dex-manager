/** Project observed counters only. Missing information is never zero evidence. */
export function runnerMutationTelemetry(result?: unknown) {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const counter = (key: string): number | null => {
    const value = record[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const ordersSent = counter('ordersSent');
  const cancelsSent = counter('cancelsSent');
  const positionChangesSent = counter('positionChangesSent');
  return {ordersSent, cancelsSent, positionChangesSent,
    mutationCountersKnown: ordersSent !== null && cancelsSent !== null && positionChangesSent !== null};
}
