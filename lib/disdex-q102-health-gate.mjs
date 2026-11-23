const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function environmentValue(environmentText, name) {
  const tokens = String(environmentText || '').trim().split(' ').filter(Boolean);
  for (const token of tokens) {
    const separator = token.indexOf('=');
    if (separator <= 0 || token.slice(0, separator) !== name) continue;
    const rawValue = token.slice(separator + 1);
    if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
      return rawValue.slice(1, -1).trim();
    }
    return rawValue.trim();
  }
  return '';
}

function enabled(value) {
  return TRUE_VALUES.has(String(value).toLowerCase());
}

/**
 * Resolve only the Q102 causal V1 operator gate from systemd's Environment
 * value. Historical selector parity is deliberately a separate, fail-closed
 * contract and can never arm the causal V1 runner.
 *
 * The function returns a fixed, non-secret reason or an empty string. It
 * never returns environment values because the input may contain credentials.
 */
export function resolveQuality102OperatorGateReason(environmentText) {
  const mode = environmentValue(environmentText, 'QUALITY102_CAUSAL_V1_MODE').toUpperCase();
  if (mode !== 'LIVE') {
    return 'QUALITY102_CAUSAL_V1_LIVE_GATE_INCOMPLETE:QUALITY102_CAUSAL_V1_MODE';
  }

  const historicalFlags = [
    'QUALITY102_LIVE_ENABLED',
    'QUALITY102_LIVE_SELECTOR_PARITY',
  ];
  if (historicalFlags.some((name) => !FALSE_VALUES.has(environmentValue(environmentText, name).toLowerCase()))) {
    return 'QUALITY102_HISTORICAL_SELECTOR_FLAG_MUST_REMAIN_FAIL_CLOSED';
  }

  const selectorMode = environmentValue(environmentText, 'QUALITY102_CAUSAL_V1_SELECTOR_MODE').toUpperCase();
  if (selectorMode !== 'CAUSAL_V4') {
    return 'QUALITY102_CAUSAL_V1_SELECTOR_MODE_ACK_REQUIRED';
  }

  const requiredGates = [
    'QUALITY102_CAUSAL_V1_ENABLED',
    'QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED',
    'QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED',
    'QUALITY102_CAUSAL_V1_OPERATOR_ARMED',
  ];
  const missingGate = requiredGates.find((name) => !enabled(environmentValue(environmentText, name)));
  return missingGate ? 'QUALITY102_CAUSAL_V1_LIVE_GATE_INCOMPLETE:' + missingGate : '';
}
