/** Build frozen runtime model input from the cited research tape. No network/orders. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {extractStable4StrategyEntryFeatures,type Stable4OpportunityLabel} from "../lib/stable4-opportunity-model";
const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
const sourcePath=join(root,"DIRECTION_RESEARCH_20261109/three_layer_layer1_all_candidates_20261114.jsonl"),raw=readFileSync(sourcePath);
const qPath=resolve("config/stable4/q102-online-recovery-seed-20261114.json"),qRaw=readFileSync(qPath),qSeed=JSON.parse(qRaw.toString("utf8"));
const source=raw.toString("utf8").trim().split(/\r?\n/).map(x=>JSON.parse(x)),coverage=1790812800000;
const identity=(x:any)=>JSON.stringify([x.entryTs,x.symbol,x.route,x.side]),qRows=new Map<string,any>(qSeed.rows.map((x:any)=>[identity(x),x]));
const seen=new Set<string>(),corrections:any[]=[],rows:Stable4OpportunityLabel[]=[];
for(const x of source){
 if(!Number.isSafeInteger(x.entryTs)||x.entryTs>=coverage)throw Error("CORPUS_ENTRY_COVERAGE_INVALID");
 const id=JSON.stringify([x.strategy,...JSON.parse(identity(x))]);if(seen.has(id))throw Error("CORPUS_DUPLICATE_OPPORTUNITY");seen.add(id);
 let exitTs=x.model?.exitTs,net30:number;
 const v=x.v??{},m=x.model??{},key=["rawReturn","grossReturn","gross_price_return","unit_price_return"].find(k=>typeof v[k]==="number");
 const rawReturn=key?v[key]:x.side==="LONG"?m.exitPrice/m.entryPrice-1:1-m.exitPrice/m.entryPrice;
 const funding=(x.funding??[]).reduce((s:number,r:any)=>s+(Array.isArray(r)&&typeof r[1]==="number"?r[1]:0),0);
 net30=rawReturn+funding-.003;
 if(x.strategy==="Q102"){
  const q=qRows.get(identity(x));if(!q)throw Error("CORPUS_Q102_LABEL_MISSING");
  if(exitTs!==q.exitTs||Math.abs(net30-q.net30)>1e-12){
   if(x.id!=="Q102P_00224"||x.symbol!=="SUIUSDT"||q.id!==x.id)throw Error("UNREVIEWED_Q102_LABEL_DIFFERENCE");
   corrections.push({id:x.id,oldExitTs:exitTs,exitTs:q.exitTs,oldNet30:net30,net30:q.net30,reason:"Previously reviewed terminal 72h knowledge timestamp and nine public funding settlements."});
  }
  exitTs=q.exitTs;net30=q.net30;
 }
 if(!Number.isSafeInteger(exitTs)||exitTs<=x.entryTs||!Number.isFinite(net30))throw Error("CORPUS_LABEL_INVALID");
 rows.push({id:x.id,strategy:x.strategy,entryTs:x.entryTs,exitTs,symbol:x.symbol,side:x.side,route:x.route,net30,features:extractStable4StrategyEntryFeatures(x.strategy,v)});
}
if(rows.length!==2892||corrections.length!==1)throw Error("CORPUS_EXPECTED_AUDITED_POPULATION_CHANGED");
const result={schema:"disdex-stable4-opportunity-corpus/v1",kind:"RESEARCH_SHADOW_LABELS_NOT_LIVE_FILLS",modelVersion:"STABLE4_CAUSAL_ENTRY_FEATURES_V1",candidateCoverageThrough:coverage,sourceSha256:createHash("sha256").update(raw).digest("hex"),q102SeedSha256:createHash("sha256").update(qRaw).digest("hex"),causalCorrections:{entryFeatures:"Explicit per-strategy schemas exclude exit_basis_bps and all other exit/outcome fields.",labels:corrections},rows};
const output=resolve("config/stable4/opportunity-corpus-seed-20261115.json");mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result)+"\n");
console.log(JSON.stringify({status:"FROZEN_RUNTIME_OPPORTUNITY_CORPUS_BUILT",output,rows:rows.length,labelCorrections:corrections.length,sha256:createHash("sha256").update(readFileSync(output)).digest("hex"),ordersSent:0}));
