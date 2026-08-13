const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

export function normalizeEvidence(raw) {
  const dev = raw.development ?? raw.dev ?? {};
  const val = raw.validation ?? raw.val ?? {};
  const stress = raw.validationStress ?? raw.stress ?? {};
  const waves = raw.waveDiagnostics?.validation ?? raw.waveDiagnostics ?? {};
  return {
    id: raw.strategyId ?? raw.candidateId ?? raw.candidate ?? 'UNKNOWN',
    pair: raw.pair ?? raw.symbol ?? 'UNKNOWN',
    status: raw.status ?? 'UNKNOWN',
    dev: {
      returnPct: num(dev.returnPct), pf: num(dev.pf), dd: num(dev.maxDDPct), trades: num(dev.trades),
      pfWithoutBest: num(dev.pfWithoutBest), falseStartRatePct: num(dev.falseStartRatePct),
      bestSharePct: num(dev.bestSharePct), avgHoldingHours: num(dev.avgHoldingHours),
    },
    val: {
      returnPct: num(val.returnPct), pf: num(val.pf), dd: num(val.maxDDPct), trades: num(val.trades),
      pfWithoutBest: num(val.pfWithoutBest), falseStartRatePct: num(val.falseStartRatePct),
      bestSharePct: num(val.bestSharePct), avgHoldingHours: num(val.avgHoldingHours),
    },
    stressPf: num(stress.pf),
    captureRatePct: num(waves.captureRatePct),
    mfeCapturePct: num(waves.medianWaveMfeCapturedPct),
    entryDelayHours: num(waves.medianEntryDelayHours),
    givebackPct: num(waves.exitGivebackPct),
    failureTaxonomy: val.failureTaxonomy ?? waves.failureTaxonomy ?? {},
    folds: raw.walkForward ?? {},
    raw,
  };
}

const pairRole = {
  BTC: 'MAJOR_WAVE_OWNERSHIP',
  ETH: 'RELATIVE_LEADERSHIP_ACCELERATION',
  BNB: 'RELATIVE_IMPULSE_SCOUT',
  AVAX: 'VOLATILITY_EVENT_TRADER',
  SOL: 'V109_WRONG_WAVE_LOSS_CONTROLLER',
  LINK: 'V109_QUALITY_CASH_HORIZON_CONTROL',
};

export function diagnoseEvidence(raw) {
  const x = normalizeEvidence(raw);
  const causes = [];
  const add = (code, severity, evidence, action) => causes.push({ code, severity, evidence, action });
  const ft = x.failureTaxonomy ?? {};

  if (x.val.trades < 5) add('TRADE_STARVATION', 100, `Validation trades=${x.val.trades}`, 'Remove pre-entry AND/confirmation layers; use scout/early-loss-control without numeric threshold loosening.');
  if (x.dev.trades >= 8 && x.val.trades > 0 && x.dev.pf >= 1.2 && x.val.pf < 1) add('DEV_VAL_COLLAPSE', 95, `Dev PF=${x.dev.pf.toFixed(2)} -> Val PF=${x.val.pf.toFixed(2)}`, 'Change economic role/state transition rather than tuning the same signal family.');
  if (x.val.falseStartRatePct >= 50) add('FALSE_START_DOMINANT', 90, `False-start=${x.val.falseStartRatePct.toFixed(1)}%`, 'Enter smaller/earlier as scout and reject quickly on contradiction; do not add another confirmation gate.');
  if (num(ft.wrongCoreOwnership) >= Math.max(3, num(x.val.trades) * 0.35)) add('WRONG_CORE_OWNERSHIP', 88, `wrongCoreOwnership=${num(ft.wrongCoreOwnership)}`, 'Redefine Core acceptance from independent evidence; separate scout from ownership.');
  if (x.val.trades >= 5 && x.val.pfWithoutBest > 0 && x.val.pfWithoutBest < 1) add('BEST_TRADE_DEPENDENCE', 82, `PF without best=${x.val.pfWithoutBest.toFixed(2)}`, 'Require broad contribution; avoid promoting tiny-sample PF spikes.');
  if (x.stressPf > 0 && x.stressPf < 1) add('STRESS_EDGE_WEAK', 80, `Stress PF=${x.stressPf.toFixed(2)}`, 'Reduce turnover/cost exposure structurally; keep only higher-quality ownership periods.');
  if (x.pair === 'BTC' && x.captureRatePct < 25) add('BTC_WAVE_MISS', 78, `Major-wave capture=${x.captureRatePct.toFixed(1)}%`, 'Prioritize early scout/probe and accepted expansion; stop adding entry filters.');
  if (x.pair === 'BTC' && x.captureRatePct >= 25 && x.mfeCapturePct < 20) add('BTC_OWNERSHIP_LEAK', 86, `Capture=${x.captureRatePct.toFixed(1)}%, MFE captured=${x.mfeCapturePct.toFixed(1)}%`, 'Shift research from entry detection to staged Core/add and structural hold/exit.');
  if (x.pair === 'ETH' && x.val.pf < 1.2) add('ETH_STATIC_LEADERSHIP_LAG', 84, `Validation PF=${x.val.pf.toFixed(2)}`, 'Use ETH-vs-BTC leadership acceleration/transition derivative, not static relative-strength levels.');
  if (x.pair === 'BNB' && x.val.trades <= 5) add('BNB_CONSENSUS_STARVATION', 96, `Validation trades=${x.val.trades}`, 'Consensus must move from entry prerequisite to continuation evidence after a fresh relative-impulse scout.');
  if (x.pair === 'AVAX' && x.val.pf < 1) add('AVAX_ROLE_MISMATCH', 92, `Validation PF=${x.val.pf.toFixed(2)}`, 'Use short volatility-event ownership with expiry-to-cash; stop forcing multi-day wave Core behavior.');

  causes.sort((a, b) => b.severity - a.severity);
  return {
    candidateId: x.id,
    pair: x.pair,
    role: pairRole[x.pair] ?? 'PAIR_SPECIFIC',
    dominantCause: causes[0] ?? { code: 'NO_DOMINANT_CAUSE', severity: 0, evidence: 'No deterministic failure rule fired.', action: 'Inspect ledger before redesign.' },
    causes,
    metrics: x,
    antiOverfit: {
      redesignSource: 'Development/Validation only',
      confirmationHoldout: 'DO_NOT_USE_FOR_REDESIGN',
      denseSweepAllowed: false,
      minorThresholdVariantAllowed: false,
    },
  };
}

export function tokenSimilarity(a = '', b = '') {
  const A = new Set(a.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
