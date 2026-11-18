// Synthetic, read-only diagnostic prototype. Not a trading authorization gate.
import assert from 'node:assert/strict';
import test from 'node:test';
const runners = ['V4','PENGU','Q102','FET','HYPE','V52','IDLE'];
function observe(previous, sample) {
  const global = sample.sharedHealth === 'HEALTHY' && sample.globalHold === false
    ? 'NO_SHARED_ALERT_REPORTED' : 'SHARED_ATTENTION';
  const observations = Object.fromEntries(runners.map(id => {
    const next = sample.runners?.[id];
    const prior = previous?.observations?.[id];
    const fresh = next && Number.isSafeInteger(next.sequence) && next.sequence >= 0 &&
      (!prior || next.sequence > prior.sequence);
    const healthy = fresh && next.status === 'HEALTHY';
    const streak = healthy ? (prior?.streak ?? 0) + 1 : 0;
    return [id, {
      sequence: fresh ? next.sequence : prior?.sequence ?? -1,
      streak,
      label: !fresh ? 'UNKNOWN' : !healthy ? 'ATTENTION' : streak >= 3 ? 'HEALTHY_OBSERVED' : 'VERIFYING',
    }];
  }));
  return {global, observations, diagnosticOnly: true};
}
function sample(sequence, overrides = {}, sharedHealth = 'HEALTHY', globalHold = false) {
  return {sharedHealth, globalHold, runners: Object.fromEntries(runners.map(id => [id,{sequence,status:overrides[id] ?? 'HEALTHY'}]))};
}
test('one fault is visible without mislabeling another runner', () => {
  const s = observe(observe(observe(null,sample(1)),sample(2)),sample(3,{IDLE:'FAULT'}));
  assert.equal(s.observations.IDLE.label,'ATTENTION');
  assert.equal(s.observations.V4.label,'HEALTHY_OBSERVED');
});
test('fresh consecutive observations detect recovery; repeat evidence does not count', () => {
  let s = observe(null,sample(1,{IDLE:'FAULT'}));
  s = observe(s,sample(2));
  s = observe(s,sample(2));
  assert.equal(s.observations.IDLE.label,'UNKNOWN');
  for (const n of [3,4,5]) s = observe(s,sample(n));
  assert.equal(s.observations.IDLE.label,'HEALTHY_OBSERVED');
});
test('global hold remains visible despite healthy observations', () => {
  const s = observe(null,sample(1,{},'HEALTHY',true));
  assert.equal(s.global,'SHARED_ATTENTION');
  assert.equal(s.diagnosticOnly,true);
});
test('missing shared or local evidence stays unknown or attention', () => {
  const s = observe(null,{runners:{}});
  assert.equal(s.global,'SHARED_ATTENTION');
  assert.ok(runners.every(id => s.observations[id].label === 'UNKNOWN'));
});
