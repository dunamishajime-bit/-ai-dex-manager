import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
test("terminal seed exposes the corrected H1 close only after 72h and includes all nine public funding settlements",()=>{
 const root=mkdtempSync(join(tmpdir(),"stable4-terminal-"));
 try{
  const seed=JSON.parse(readFileSync("config/stable4/q102-online-recovery-seed-20261114.json","utf8"));
  const row=seed.rows.find((x:any)=>x.id==="Q102P_00224");
  assert.equal(row.exitTs,row.entryTs+72*3600000);assert.ok(Math.abs(row.net30-.05809469343850867)<1e-14);
  const engine=new Stable4Q102OnlineEngine({mode:"LIVE",recoverySeedPath:"config/stable4/q102-online-recovery-seed-20261114.json",avaxSeedPath:"config/stable4/q102-avax-knn-seed-20261114.json",statePath:join(root,"state.json")});
  assert.equal((engine as any).allRecoveryRows(row.exitTs).some((x:any)=>x.id===row.id),false);
  assert.equal((engine as any).allRecoveryRows(row.exitTs+1).some((x:any)=>x.id===row.id),true);
  assert.equal(seed.causalCorrections.find((x:any)=>x.id===row.id).fundingRows,9);
 }finally{rmSync(root,{recursive:true,force:true});}
});
