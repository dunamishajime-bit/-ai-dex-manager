import assert from 'node:assert/strict';
import { diagnoseEvidence, tokenSimilarity } from './lib/diagnostics.mjs';

const bnb = diagnoseEvidence({
  strategyId: 'TEST_BNB', pair: 'BNB',
  development: { trades: 8, returnPct: 1, pf: 1.3, maxDDPct: -2 },
  validation: { trades: 0, returnPct: 0, pf: 0, maxDDPct: 0 },
  validationStress: { pf: 0 },
});
assert.equal(bnb.dominantCause.code, 'TRADE_STARVATION');
assert.ok(bnb.causes.some((x) => x.code === 'BNB_CONSENSUS_STARVATION'));

const btc = diagnoseEvidence({
  strategyId: 'TEST_BTC', pair: 'BTC',
  development: { trades: 20, returnPct: 2, pf: 1.4, maxDDPct: -3 },
  validation: { trades: 10, returnPct: 0.5, pf: 1.25, maxDDPct: -2, falseStartRatePct: 20, pfWithoutBest: 1.1 },
  validationStress: { pf: 1.05 },
  waveDiagnostics: { validation: { captureRatePct: 40, medianWaveMfeCapturedPct: 8 } },
});
assert.ok(btc.causes.some((x) => x.code === 'BTC_OWNERSHIP_LEAK'));

assert.ok(tokenSimilarity('relative impulse scout breadth extension', 'relative impulse scout then breadth extension') > 0.6);
assert.ok(tokenSimilarity('relative impulse scout', 'volatility shock event expiry') < 0.35);

console.log('DISDEX_RESEARCH_COMMANDER_SELFTEST_PASS');
