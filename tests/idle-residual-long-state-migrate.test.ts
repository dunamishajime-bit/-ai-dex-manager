import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { emptyIdleResidualLongState } from "../lib/idle-residual-long-state";
import { migrateIdleResidualLongState } from "../scripts/disdex-idle-residual-long-state-migrate";

const FROM="a".repeat(40);
const TO="b".repeat(40);

test("flat residual state migrates SHA with exact backup and no exposure mutation", async () => {
  const root=await mkdtemp(join(tmpdir(),"idle-residual-migrate-"));
  try{
    const statePath=join(root,"state.json");
    const before=emptyIdleResidualLongState(FROM,123456789);
    before.lastDecision={decisionTs:123456789,accepted:false,reason:"NO_IDLE_RESIDUAL_LONG_SIGNAL"};
    await writeFile(statePath,JSON.stringify(before,null,2)+"\n");
    const original=await readFile(statePath);
    const result=await migrateIdleResidualLongState({statePath,toSha:TO,normalizeOwnership:false});
    assert.equal(result.status,"IDLE_RESIDUAL_STATE_SHA_MIGRATE_PASS");
    if(result.status!=="IDLE_RESIDUAL_STATE_SHA_MIGRATE_PASS")return;
    assert.ok((await readFile(result.backupPath)).equals(original));
    const after=JSON.parse(await readFile(statePath,"utf8"));
    assert.equal(after.runtimeSha,TO);
    assert.equal(after.position,null);
    assert.equal(after.pending,null);
    assert.equal(after.manualReview,null);
    assert.equal(after.lastDecision.reason,"NO_IDLE_RESIDUAL_LONG_SIGNAL");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("residual state migration refuses exposure, pending, and manual review", async () => {
  for(const mutate of [
    (s:any)=>{s.position={symbol:"DOGEUSDT",route:"DOGE_REL_VOL",side:"LONG",signalTs:1,entryTs:2,exitTs:3,entryPrice:1,quantity:1,gross:1,stopPrice:.9,takeProfitPrice:1.25,stopClientOrderId:"s",takeProfitClientOrderId:"t",protectionVerified:true};},
    (s:any)=>{s.pending={action:"ENTRY",phase:"planned",symbol:"DOGEUSDT",route:"DOGE_REL_VOL",clientOrderId:"c",idempotencyKey:"c",quantity:1,expectedPrice:1,signalTs:1,decisionTs:1,createdAt:1,updatedAt:1,reason:"test"};},
    (s:any)=>{s.manualReview="review";},
  ]){
    const root=await mkdtemp(join(tmpdir(),"idle-residual-migrate-block-"));
    try{
      const statePath=join(root,"state.json");
      const state:any=emptyIdleResidualLongState(FROM,Date.now());
      mutate(state);
      await writeFile(statePath,JSON.stringify(state,null,2)+"\n");
      await assert.rejects(
        migrateIdleResidualLongState({statePath,toSha:TO,normalizeOwnership:false}),
        /IDLE_RESIDUAL_STATE_SHA_MIGRATE_REVIEW_OR_EXPOSURE_PRESENT/,
      );
    }finally{await rm(root,{recursive:true,force:true});}
  }
});
