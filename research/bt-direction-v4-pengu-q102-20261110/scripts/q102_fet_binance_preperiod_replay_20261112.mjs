import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250301_20251001/Q102_FET_BINANCE_PROXY";
const PIN=ROOT+"/pinned-source/Q102";
const OUT=PRE+"/q102-fet-pretarget-proxy-selected-exits.jsonl";
const H=3600000,M5=300000,BEGIN=Date.parse("2025-03-22T00:00:00Z"),END=Date.parse("2025-10-01T00:00:00Z");

const {generateQuality102CausalV4S34Candidates}=await import(pathToFileURL(PIN+"/lib/disdex-quality102-causal-v4-s34.ts").href);
const {evaluateQuality102CausalV4ImprovementGate}=await import(pathToFileURL(PIN+"/lib/disdex-quality102-causal-selector.ts").href);
const {q102ExhaustionReason,causalReturn}=await import(pathToFileURL(PIN+"/lib/dd1296-entry-policy.ts").href);

const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function load(iv){
 const p=PRE+"/FETUSDT-"+iv+"-20250301-20251001.jsonl.gz";
 const rows=zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map(z=>({
   ts:+z[0],o:+z[1],h:+z[2],l:+z[3],c:+z[4],qv:+z[7],bv:+z[5]
 }));
 return {p,rows,map:new Map(rows.map((x,i)=>[x.ts,i]))};
}
const h1=load("1h"),m5=load("5m");
for(let i=1;i<h1.rows.length;i++)if(h1.rows[i].ts-h1.rows[i-1].ts!==H)throw Error("H1_GAP");
for(let i=1;i<m5.rows.length;i++)if(m5.rows[i].ts-m5.rows[i-1].ts!==M5)throw Error("M5_GAP");

const layerRank={S3:1,S4:2},familyRank={BRK:1,PB:2,MR:3,REV:4};
const selected=[],rejected=[];
for(let t=BEGIN;t<END;t+=H){
 if(new Date(t).getUTCHours()%4!==1)continue;
 const i=h1.map.get(t);
 if(i===undefined||i<337)continue;
 const row=h1.rows[i];
 const prior=h1.rows.slice(Math.max(0,i-450),i).map(x=>({timestampMs:x.ts,open:x.o,high:x.h,low:x.l,close:x.c,quoteVolume:x.qv,baseVolume:x.bv}));
 let cs=[];
 try{cs=generateQuality102CausalV4S34Candidates({symbol:"FETUSDT",rows:prior,entryOpen:{timestampMs:t,open:row.o}})}catch(e){continue}
 if(!cs.length)continue;
 cs.sort((a,b)=>layerRank[a.layer]-layerRank[b.layer]||familyRank[a.family]-familyRank[b.family]||b.margin-a.margin||a.key.localeCompare(b.key));
 const c=cs[0];
 if(c.family==="BRK"&&c.side===-1){
   let ret72;
   try{ret72=causalReturn(prior,{timestampMs:t,open:row.o},72)}catch{}
   const reason=q102ExhaustionReason("FETUSDT",c.family,c.side,ret72);
   if(reason){rejected.push({entryTs:t,route:c.key,reason,ret72,ret14:c.ret14});continue;}
 }
 const imp=evaluateQuality102CausalV4ImprovementGate({family:c.family,side:c.side,ret14:c.ret14});
 if(!imp.accepted){rejected.push({entryTs:t,route:c.key,reason:imp.reason,ret14:c.ret14});continue;}
 selected.push({...c,entryPrice:row.o});
}
const grossMap={MR:{LONG:.75,SHORT:.75},BRK:{LONG:.75,SHORT:.75},PB:{LONG:2,SHORT:2.5},REV:{LONG:1.5,SHORT:1.25}};
const modeled=[],unresolved=[];
for(const c of selected){
 const side=c.side===1?"LONG":"SHORT",ep=c.entryPrice,stop=ep*(c.side===1?1-c.hardStop:1+c.hardStop),deadline=c.entryTs+c.maxHoldHours*H;
 const i=m5.map.get(c.entryTs);
 if(i===undefined||Math.abs(m5.rows[i].o-ep)>Math.max(1e-10,ep*1e-7)){unresolved.push({entryTs:c.entryTs,route:c.key,reason:"ENTRY_M5_MISMATCH"});continue;}
 let out;
 for(let j=i;j<m5.rows.length;j++){
   const b=m5.rows[j];
   if(b.ts>=deadline){out={exitTs:b.ts,exitPrice:b.o,exitReason:"TIME"};break;}
   if(c.side===1&&b.l<=stop){out={exitTs:b.ts+M5,exitPrice:Math.min(b.o,stop),exitReason:"HARD_STOP"};break;}
   if(c.side===-1&&b.h>=stop){out={exitTs:b.ts+M5,exitPrice:Math.max(b.o,stop),exitReason:"HARD_STOP"};break;}
 }
 if(!out||out.exitTs>END){unresolved.push({entryTs:c.entryTs,route:c.key,reason:"EXIT_UNRESOLVED"});continue;}
 const rawReturn=c.side===1?out.exitPrice/ep-1:ep/out.exitPrice-1;
 modeled.push({strategy:"Q102",symbol:"FETUSDT",side,family:c.family,layer:c.layer,route:c.key,entryTs:c.entryTs,entryPrice:ep,
   hardStop:c.hardStop,maxHoldHours:c.maxHoldHours,requestedGross:grossMap[c.family][side],ret14:c.ret14,strength:c.strength,margin:c.margin,...out,rawReturn,
   source:"BINANCE_UM_PRETARGET_PROXY_EXACT_PINNED_S34_SIGNAL"});
}
fs.writeFileSync(OUT,modeled.map(x=>JSON.stringify(x)).join("\n")+(modeled.length?"\n":""));
fs.writeFileSync(PRE+"/q102-fet-pretarget-proxy-rejected.jsonl",rejected.map(x=>JSON.stringify(x)).join("\n")+(rejected.length?"\n":""));
fs.writeFileSync(PRE+"/q102-fet-pretarget-proxy-unresolved.jsonl",unresolved.map(x=>JSON.stringify(x)).join("\n")+(unresolved.length?"\n":""));

function met(a,bps=30){
 const v=a.map(x=>x.rawReturn-bps/10000),gp=v.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-v.filter(x=>x<0).reduce((a,b)=>a+b,0);
 return {n:v.length,wr:v.length?v.filter(x=>x>0).length/v.length:null,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,
   sum:v.reduce((a,b)=>a+b,0),pf:gl?gp/gl:(gp?999:null)};
}
const byRoute={};
for(const route of [...new Set(modeled.map(x=>x.route))].sort())byRoute[route]=met(modeled.filter(x=>x.route===route));
const summary={status:"Q102_FET_BINANCE_PRETARGET_PROXY_EXACT_PINNED_S34",selected:selected.length,modeled:modeled.length,rejected:rejected.length,unresolved:unresolved.length,
  full30:met(modeled),byRoute30:byRoute,inputHashes:{h1:sha(h1.p),m5:sha(m5.p)},outputSha256:sha(OUT),
  limitations:["Binance UM proxy, not Aster.","FET-only local selection; does not model competition with other Q102 symbols at the same decision timestamp.","No portfolio occupancy/shared-gross admission."]};
fs.writeFileSync(PRE+"/Q102_FET_PRETARGET_PROXY_SUMMARY.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
