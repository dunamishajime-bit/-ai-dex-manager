import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  parseRunnerPinManifest,
  RUNNER_PIN_IDS,
} from "../lib/server/runner-pin-manifest";

const fixturePath=path.resolve("config/production-runner-pins-DD1296_FINAL_ALLIN_10BPS.json");

test("production runner manifest v2 is complete and mixed-SHA safe",()=>{
  const doc=parseRunnerPinManifest(JSON.parse(fs.readFileSync(fixturePath,"utf8")));
  assert.equal(doc.schema,"disdex-runner-pin-manifest/v2");
  assert.equal(doc.target,"professional-dismanager.net");
  assert.equal(doc.operatorTarget,"DD1296_FINAL_ALLIN_10BPS");
  assert.deepEqual(Object.keys(doc.runners).sort(),[...RUNNER_PIN_IDS].sort());
  assert.equal(doc.runners.V52.sha,"4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81");
  assert.equal(doc.runners.QUALITY102_CAUSAL_V1.sha,"ef1ab178e26a7bf5bddb6473467765edba242e1d");
  assert.equal(doc.runners.V12_V4.sha,"53a0be396719f0284af4e11b35c66a4ac7d58f79");
  assert.notEqual(doc.runners.V52.sha,doc.runners.FET_BRK48_RESIDUAL.sha);
  for(const id of RUNNER_PIN_IDS){
    const p=doc.runners[id];
    assert.equal(p.releaseRoot,`/home/deploy/disdex-trading/releases/${p.sha}`);
    assert.match(p.serviceUnit,new RegExp("@"+p.sha+"\\.service$"));
    assert.match(p.healthPath,/^\/var\/lib\/disdex\//);
    assert.match(p.tickPath,/^\/var\/lib\/disdex\/runner-health\/ticks\//);
  }
});

test("manifest rejects wrong SHA/root/unit and missing evidence fields",()=>{
  const base=JSON.parse(fs.readFileSync(fixturePath,"utf8"));
  for(const mutate of [
    (x:any)=>{x.runners.V52.sha="a".repeat(39)},
    (x:any)=>{x.runners.V52.releaseRoot="/home/deploy/disdex-trading/releases/"+"a".repeat(40)},
    (x:any)=>{x.runners.V52.serviceUnit="disdex-v52-aster-only@"+"a".repeat(40)+".service"},
    (x:any)=>{delete x.runners.V52.tickPath},
    (x:any)=>{x.runners.EXTRA={...x.runners.V52}},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>parseRunnerPinManifest(copy));
  }
});
