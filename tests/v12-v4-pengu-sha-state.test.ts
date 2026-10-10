import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FilePenguDualLsV2RunnerStateStore} from "../lib/pengu-dual-ls-v2-runner-state";
test("PENGU stable state output carries actual release SHA without altering LIVE positions",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-pengu-release-"));const path=join(dir,"runner-live.json");
 const sha="d".repeat(40),old=process.env.DISDEX_RELEASE_SHA;
 try{
  const store=new FilePenguDualLsV2RunnerStateStore(path,"LIVE");
  const state=await store.load();
  process.env.DISDEX_RELEASE_SHA=sha;
  await store.save(state);
  const saved=JSON.parse(readFileSync(path,"utf8"));
  assert.equal(saved.runtimeCommitSha,sha);
  assert.equal(saved.version,2);
  assert.equal(saved.strategyId,"PENGU_DUAL_LS_V2_FINAL");
  assert.equal(saved.mode,"LIVE");
  assert.equal(saved.position,undefined);
  assert.equal((await store.load()).runtimeCommitSha,sha);
 }finally{
  if(old===undefined)delete process.env.DISDEX_RELEASE_SHA;
  else process.env.DISDEX_RELEASE_SHA=old;
  rmSync(dir,{recursive:true,force:true});
 }
});
