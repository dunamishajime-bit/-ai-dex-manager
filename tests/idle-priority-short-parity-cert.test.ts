import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIdleParityCertificate,
  IDLE_PARITY_CERT_SCHEMA,
  IDLE_PARITY_REPLAY_MODEL,
} from "../lib/idle-priority-short-parity-cert";

const sha="a".repeat(40);
const good={
  schema: IDLE_PARITY_CERT_SCHEMA,
  runtimeSha: sha,
  candidateStreamSha256:"09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb",
  genericCandidateSha256:"d32ed3a07a6338e8fae792ec6d9071ea27a1dee548eed6a3825dfbda3270019a",
  genericCandidateRows:393,
  genericSourceGapRows:2,
  genericLifecycleModel:"BASELINE_CONTINUOUS_IDLE__BREAKOUT_RELATIVE_MOMENTUM__12H_PER_SYMBOL",
  filteredSha256:"5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48",
  candidateRows:495,
  filteredRows:63,
  admittedRows:61,
  wins:48,
  losses:13,
  roundtripBps:10,
  replayModelVersion:IDLE_PARITY_REPLAY_MODEL,
  baselineTradeCount:1284,
  baselineRejectedRows:6,
  integratedTradeCount:1339,
  baselineJpy:141845207.7243423,
  finalJpy:214775230.26444945,
  profitFactor:2.046425970772986,
  maxDrawdownPct:-0.22840597480157931,
  idleProfitFactor:6.582814623608791,
  generatedAt:1,
} as const;

test("accepts coherent 10bps certificate",()=>{
  assert.equal(assertIdleParityCertificate(good,sha).integratedTradeCount,1339);
});

test("rejects historical mixed JPY268m certificate",()=>{
  assert.throws(()=>assertIdleParityCertificate({...good,finalJpy:268050000},sha),/FINAL_JPY_MISMATCH/);
});

test("rejects 8bps sensitivity as production parity certificate",()=>{
  assert.throws(()=>assertIdleParityCertificate({...good,roundtripBps:8} as any,sha),/COST_CASE_MISMATCH/);
});

test("rejects historical 1342 count",()=>{
  assert.throws(()=>assertIdleParityCertificate({...good,integratedTradeCount:1342} as any,sha),/TRADE_COUNTS_MISMATCH/);
});

test("rejects pre-v3 certificate",()=>{
  assert.throws(()=>assertIdleParityCertificate({...good,schema:"disdex-idle-priority-parity-cert/v2"} as any,sha),/SCHEMA_MISMATCH/);
});

test("rejects generic lifecycle proof drift",()=>{
  assert.throws(()=>assertIdleParityCertificate({...good,genericCandidateRows:392} as any,sha),/GENERIC_COUNTS_MISMATCH/);
  assert.throws(()=>assertIdleParityCertificate({...good,genericCandidateSha256:"0".repeat(64)} as any,sha),/GENERIC_SHA_MISMATCH/);
});
