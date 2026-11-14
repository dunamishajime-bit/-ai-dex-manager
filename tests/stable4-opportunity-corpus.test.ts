import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {loadStable4OpportunityCorpus,mergeStable4OpportunityLabels,STABLE4_CORPUS_SEED_SHA256} from "../lib/stable4-opportunity-corpus";
const raw=readFileSync("config/stable4/opportunity-corpus-seed-20261115.json");
test("frozen corpus is bound to reviewed bytes and contains the complete audited population",()=>{
 const c=loadStable4OpportunityCorpus(raw,STABLE4_CORPUS_SEED_SHA256);
 assert.equal(c.rows.length,2892);assert.equal(c.candidateCoverageThrough,1790812800000);
 assert.equal(c.rows.find(x=>x.id==="Q102P_00224")!.exitTs,1790913600000);
 assert.ok(c.rows.every(x=>!("exit_basis_bps" in x.features)));
 assert.throws(()=>loadStable4OpportunityCorpus(Buffer.concat([raw,Buffer.from(" ")]),STABLE4_CORPUS_SEED_SHA256),/HASH/);
});
test("a matching hash alone cannot admit malformed or hindsight corpus contents",()=>{
 for(const mutate of [
  (x:any)=>x.rows.push(x.rows[0]),
  (x:any)=>x.rows[0].features.exit_basis_bps=1,
  (x:any)=>x.rows[0].net30="0.1",
  (x:any)=>x.rows[0].exitTs=x.rows[0].entryTs,
  (x:any)=>x.rows[0].strategy="UNKNOWN",
  (x:any)=>x.kind="LIVE_FILLS",
 ]){
  const value=JSON.parse(raw.toString());mutate(value);const changed=Buffer.from(JSON.stringify(value));
  assert.throws(()=>loadStable4OpportunityCorpus(changed,createHash("sha256").update(changed).digest("hex")),/CORPUS/);
 }
});
test("continuation merge is immutable, idempotent and rejects conflicting duplicate labels",()=>{
 const seed=loadStable4OpportunityCorpus(raw,STABLE4_CORPUS_SEED_SHA256).rows;
 const next={...seed[0],id:"continuation",entryTs:1794682800000,exitTs:1794686400000,features:{...seed[0].features}};
 const merged=mergeStable4OpportunityLabels(seed,[next,next]);
 assert.equal(merged.length,2893);assert.equal(seed.length,2892);
 assert.throws(()=>mergeStable4OpportunityLabels(seed,[{...seed[0],net30:seed[0].net30+.01}]),/CONFLICT/);
 assert.throws(()=>mergeStable4OpportunityLabels(seed,[{...next,features:{exit_basis_bps:2}}]),/FEATURE/);
});
