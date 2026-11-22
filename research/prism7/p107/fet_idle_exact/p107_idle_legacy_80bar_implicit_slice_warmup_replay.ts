import * as fs from "node:fs";
import * as path from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {computeIdlePriorityFeatures,evaluateIdleGenericCandidate,evaluateIdlePriorityShort} from "./fet-idle-pin-source-7688ed7c/lib/idle-priority-short-signal";
import {IDLE_PRIORITY_SHORT_POLICY} from "./fet-idle-pin-source-7688ed7c/config/idlePriorityShortPolicy";
const root=process.argv[2],oldPath=process.argv[3],outFile=process.argv[4],H=3600000;
if(!root||!oldPath||!outFile)throw Error("ARGS_REQUIRED");
const START=Date.parse("2025-10-01T00:00:00Z"),END=Date.parse("2026-10-01T00:00:00Z");
const symbols=Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes) as Array<keyof typeof IDLE_PRIORITY_SHORT_POLICY.routes>;
type Bar={ts:number,open:number,high:number,low:number,close:number,quoteVolume:number};
const source:any={};const bySymbol:Record<string,{idx:Map<number,number>,rows:Bar[]}>= {};
for(const sym of [...symbols,"BTCUSDT"]){
 const map=new Map<number,Bar>(),files:any[]=[];
 for(const dirname of ["aster-public-v3-h1-early","aster-public-v3-h1"]){
  for(const name of fs.readdirSync(path.join(root,dirname)).filter(n=>n.startsWith(sym+"-1h-")&&n.endsWith(".jsonl.gz"))){
   const z=fs.readFileSync(path.join(root,dirname,name));
   files.push({path:dirname+"/"+name,sha256:createHash("sha256").update(z).digest("hex")});
   for(const line of gunzipSync(z).toString("utf8").split("\n"))if(line.trim()){
    const x=JSON.parse(line),t=Number(x[0]);
    const b:Bar={ts:t,open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),quoteVolume:Number(x[7])};
    if(map.has(t)&&JSON.stringify(map.get(t))!==JSON.stringify(b))throw Error("SOURCE_BAR_CONFLICT:"+sym);
    map.set(t,b);
   }
  }
 }
 if(!map.size)throw Error("SOURCE_MISSING:"+sym);
 const rows=[...map.values()].sort((a,b)=>a.ts-b.ts);
 for(let i=1;i<rows.length;i++)if(rows[i].ts-rows[i-1].ts!==H)throw Error("NON_HOURLY:"+sym);
 bySymbol[sym]={rows,idx:new Map(rows.map((x,i)=>[x.ts,i]))};
 source[sym]={first:rows[0].ts,last:rows.at(-1)!.ts,fileSources:files,bars:rows.length};
}
const old=fs.readFileSync(oldPath,"utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x));
const events:any[]=[],fail:Record<string,number>={},generic:any={};
for(const sym of symbols){
 let nextEligible=0;
 const rows=bySymbol[sym],btc=bySymbol.BTCUSDT;
 let countGeneric=0,blockedCooldown=0;
 for(let now=START;now<END;now+=H){
  if(now<nextEligible){blockedCooldown++;continue;}
  const i=rows.idx.get(now-H),j=btc.idx.get(now-H);
  if(i===undefined||j===undefined||i<80||j<80){fail[sym+":NO_REQUIRED_HISTORY"]=(fail[sym+":NO_REQUIRED_HISTORY"]||0)+1;continue;}
  try{
   const features=computeIdlePriorityFeatures(now,rows.rows.slice(Math.max(0,i-80),i+1),btc.rows.slice(Math.max(0,j-80),j+1));
   const candidate=evaluateIdleGenericCandidate(features);
   if(!candidate.accepted)continue;
   countGeneric++;
   nextEligible=now+12*H;
   const selected=evaluateIdlePriorityShort(sym,features,candidate);
   if(!selected.accepted)continue;
   const entry=rows.rows[i+1];
   if(!entry||entry.ts!==now)throw Error("NO_NEXT_OPEN");
   const policy=IDLE_PRIORITY_SHORT_POLICY.routes[sym];
   events.push({signalTs:features.signalTs,entryTs:now,symbol:sym,route:selected.route,side:"SHORT",requestedGross:policy.gross,holdHours:selected.holdHours,
    entryReferenceOpenPrice:entry.open,
    features:{ret12:features.ret12,ret24:features.ret24,btc24:features.btc24,rel24:features.rel24,atrRatio:features.atrRatio,volumeRatio:features.volumeRatio}});
  }catch(e:any){const k=sym+":"+String(e?.message||e);fail[k]=(fail[k]||0)+1;}
 }
 generic[sym]={acceptedBeforeRouteFilter:countGeneric,blockedBy12hGenericLifecycle:blockedCooldown};
}
const k=(e:any)=>[e.signalTs,e.entryTs,e.symbol,e.side,e.route].join("|");
const oldMap=new Map(old.map((x:any)=>[k(x),x])),newMap=new Map(events.map(x=>[k(x),x]));
const oldOnly=old.filter(x=>!newMap.has(k(x))),newOnly=events.filter(x=>!oldMap.has(k(x)));
const featuresDiff:any[]=[];
for(const e of events){
 const x=oldMap.get(k(e));if(!x)continue;
 for(const field of ["ret12","ret24","btc24","rel24","atrRatio","volumeRatio"]){
  if(Math.abs(e.features[field]-Number(x.features[field]))>1e-10)featuresDiff.push({key:k(e),feature:field,expected:x.features[field],source:e.features[field]});
 }
 if(Math.abs(e.entryReferenceOpenPrice-x.entryReferenceOpenPrice)>1e-10)featuresDiff.push({key:k(e),feature:"entryOpen"});
}
const out={schema:"p107-idle-priority-five-symbol-source-native-h1-one-year-183-entry-parity/v1",
 sourceSha:"7688ed7c93a1918d8b44837339b7da5584a868f5",start:START,end:END,sourceInputs:source,oldCount:old.length,nativeAcceptedCount:events.length,
 matched:events.length-newOnly.length,oldOnly:oldOnly.length,newOnly:newOnly.length,
 oldOnlySamples:oldOnly.slice(0,14),newOnlySamples:newOnly.slice(0,14),featureMismatchCount:featuresDiff.length,featureMismatchSamples:featuresDiff.slice(0,16),
 inputRejected:fail,genericCandidateLifecycle:generic,
 events,actualVenueFills:0,sharedPortfolioAdmissionTested:false,fullP107STABLE4Parity:false
};
fs.writeFileSync(outFile,JSON.stringify(out,null,2)+"\n");
console.log(JSON.stringify({old:old.length,current:events.length,oldOnly:oldOnly.length,newOnly:newOnly.length,featureDifferences:featuresDiff.length,generic,errors:Object.entries(fail).filter(x=>!x[0].includes("NO_REQUIRED_HISTORY")).slice(0,12),sampleNew:newOnly.slice(0,3)}));
