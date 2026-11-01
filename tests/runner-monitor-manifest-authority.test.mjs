import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveMonitorRunnerPins } from "../scripts/ops/root/disdex-runner-monitor-pins.mjs";

const ACTUAL_V52 = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81";
const STALE_V52 = "97830672e2f139b39f7194166d7dc8c36e8c8933";
const LEGACY = "7688ed7c93a1918d8b44837339b7da5584a868f5";
const V4 = "53a0be396719f0284af4e11b35c66a4ac7d58f79";
const Q102 = "ef1ab178e26a7bf5bddb6473467765edba242e1d";

const service = {
  V12_V4: "disdex-v12-v4",
  PENGU_V8: "disdex-pengu-dual-ls-v2",
  QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1",
  V52: "disdex-v52-aster-only",
  FET_BRK48_RESIDUAL: "disdex-fet-brk48",
  HYPE_TREND_LONG: "disdex-hype-long",
  IDLE_PRIORITY_SHORT: "disdex-idle-priority-short",
  SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk",
  MARGIN_GUARD: "disdex-v12-v52-margin-guard",
};
const owners = {
  V12_V4:"V4_PRIMARY",PENGU_V8:"PENGU_V8",QUALITY102_CAUSAL_V1:"Q102_PRIMARY",V52:"V52",
  FET_BRK48_RESIDUAL:"FET_BRK48_RESIDUAL",HYPE_TREND_LONG:"HYPE_TREND_LONG",
  IDLE_PRIORITY_SHORT:"IDLE_PRIORITY_SHORT",SHARED_CRYPTO_RISK:"SHARED_RISK",MARGIN_GUARD:"MARGIN_GUARD",
};
const file = {
  V12_V4:"v12-v4.json",PENGU_V8:"pengu-v8.json",QUALITY102_CAUSAL_V1:"quality102-causal-v1.json",V52:"v52.json",
  FET_BRK48_RESIDUAL:"fet-brk48-residual.json",HYPE_TREND_LONG:"hype-trend-long.json",
  IDLE_PRIORITY_SHORT:"idle-priority-short.json",SHARED_CRYPTO_RISK:"shared-crypto-risk.json",MARGIN_GUARD:"margin-guard.json",
};

function manifest() {
  const shas={V12_V4:V4,PENGU_V8:LEGACY,QUALITY102_CAUSAL_V1:Q102,V52:ACTUAL_V52,
    FET_BRK48_RESIDUAL:LEGACY,HYPE_TREND_LONG:LEGACY,IDLE_PRIORITY_SHORT:LEGACY,
    SHARED_CRYPTO_RISK:LEGACY,MARGIN_GUARD:LEGACY};
  const runners={};
  for(const [id,sha] of Object.entries(shas)) runners[id]={
    sha,
    releaseRoot:`/home/deploy/disdex-trading/releases/${sha}`,
    serviceUnit:`${service[id]}@${sha}.service`,
    evidenceMode:"legacy",
    stopOwner:owners[id],
    healthPath:`/var/lib/disdex/runner-health/heartbeats/${file[id]}`,
    tickPath:`/var/lib/disdex/runner-health/ticks/${id}.json`,
  };
  return {schema:"disdex-runner-pin-manifest/v2",target:"professional-dismanager.net",runners};
}

test("canonical v2 manifest overrides stale per-runner monitor env pins", async () => {
  const dir=await mkdtemp(join(tmpdir(),"disdex-monitor-pins-"));
  try {
    const path=join(dir,"runner-pins.json");
    await writeFile(path,JSON.stringify(manifest()),"utf8");
    const pins=resolveMonitorRunnerPins({
      DISDEX_RUNNER_PIN_MANIFEST_PATH:path,
      DISDEX_WATCHDOG_V52_EXPECTED_SHA:STALE_V52,
      DISDEX_WATCHDOG_V52_RELEASE_ROOT:`/home/deploy/disdex-trading/releases/${STALE_V52}`,
      DISDEX_WATCHDOG_V52_SERVICE_UNIT:`disdex-v52-aster-only@${STALE_V52}.service`,
    });
    assert.equal(pins.source,"manifest-v2");
    assert.equal(pins.runners.V52.expectedSha,ACTUAL_V52);
    assert.equal(pins.runners.V52.serviceUnit,`disdex-v52-aster-only@${ACTUAL_V52}.service`);
    assert.equal(pins.runners.V52.healthPath,"/var/lib/disdex/runner-health/heartbeats/v52.json");
    assert.equal(pins.runners.V52.tickPath,"/var/lib/disdex/runner-health/ticks/V52.json");
    assert.equal(pins.runners.SHARED_CRYPTO_RISK.expectedSha,LEGACY);
    assert.equal(pins.runners.MARGIN_GUARD.expectedSha,LEGACY);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("monitor manifest fails closed on wrong target and never falls back to stale env", async () => {
  const dir=await mkdtemp(join(tmpdir(),"disdex-monitor-pins-"));
  try {
    const path=join(dir,"runner-pins.json");
    const raw=manifest(); raw.target="wrong.example";
    await writeFile(path,JSON.stringify(raw),"utf8");
    assert.throws(()=>resolveMonitorRunnerPins({
      DISDEX_RUNNER_PIN_MANIFEST_PATH:path,
      DISDEX_WATCHDOG_V52_EXPECTED_SHA:STALE_V52,
    }),/RUNNER_MONITOR_TARGET_MISMATCH/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("monitor resolver explicitly returns legacy-env mode when no manifest path is supplied", () => {
  assert.deepEqual(resolveMonitorRunnerPins({}),{source:"legacy-env",runners:null,path:null});
});
