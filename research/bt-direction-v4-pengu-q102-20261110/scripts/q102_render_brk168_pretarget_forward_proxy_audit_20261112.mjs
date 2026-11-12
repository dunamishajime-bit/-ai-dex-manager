import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PIN=ROOT+"/pinned-source/Q102";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250301_20251001/IDLE_ALL_BINANCE_PROXY";
const FWD=ROOT+"/FORWARD_HOLDOUT_20261001_20261108";
const OUT=ROOT+"/DIRECTION_RESEARCH_20261109/Q102_RENDER_BRK168_PRETARGET_FORWARD_20261112";
fs.mkdirSync(OUT,{recursive:true});
const KEY="RENDER|BRK168_H12_V1.2",SYM="RENDERUSDT";
const H=3600000,M5=300000,COST=.003;
const PRE_BEGIN=Date.parse("2025-03-22T00:00:00Z"),PRE_END=Date.parse("2025-10-01T00:00:00Z");
const FWD_BEGIN=Date.parse("2026-10-01T00:00:00Z"),FWD_END=Date.parse("2026-11-08T20:00:00Z");
const TRAIN_END=Date.parse("2025-07-01T00:00:00Z"),VALID_END=Date.parse("2025-09-01T00:00:00Z");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");

const {generateQuality102CausalV4S34Candidates}=await import(pathToFileURL(PIN+"/lib/disdex-quality102-causal-v4-s34.ts").href);
const {evaluateQuality102CausalV4ImprovementGate}=await import(pathToFileURL(PIN+"/lib/disdex-quality102-causal-selector.ts").href);

function readGz(p,kind){
 const b=fs.readFileSync(p);
 const raw=zlib.gunzipSync(b).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
 const rows=raw.map(x=>kind==="h1"
   ? {timestampMs:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],quoteVolume:+x[7],baseVolume:+x[5]}
   : {t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4]});
 return {rows,hash:sha(b),path:p};
}
function assertContinuous(rows,step,label,timeKey){
 for(let i=1;i<rows.length;i++) if(rows[i][timeKey]!==rows[i-1][timeKey]+step) throw Error(label+"_GAP_"+i);
}
function generate(h1,begin,end){
 const out=[];
 const start=Math.max(begin,h1[0].timestampMs+337*H);
 for(let t=start;t<end;t+=H){
   if(new Date(t).getUTCHours()%4!==1)continue;
   const i=(t-h1[0].timestampMs)/H;
   if(!Number.isInteger(i)||i<337||i>=h1.length)continue;
   const row=h1[i],prior=h1.slice(Math.max(0,i-450),i);
   let cs=[];
   try{cs=generateQuality102CausalV4S34Candidates({symbol:SYM,rows:prior,entryOpen:{timestampMs:t,open:row.open}})}catch{continue}
   for(const c of cs){
     if(c.key!==KEY)continue;
     const g=evaluateQuality102CausalV4ImprovementGate({family:c.family,side:c.side,ret14:c.ret14});
     out.push({...c,entryOpen:row.open,improvementAccepted:g.accepted,improvementReason:g.reason??null});
   }
 }
 return out;
}
function model(c,m5map,flip=false){
 const side=flip?-c.side:c.side, ep=c.entryOpen, stop=ep*(side===1?1-c.hardStop:1+c.hardStop), deadline=c.entryTs+c.maxHoldHours*H;
 const eb=m5map.get(c.entryTs);
 if(!eb||Math.abs(eb.o-ep)>Math.max(1e-10,ep*1e-9))return {unresolved:"M5_ENTRY_MISSING_OR_OPEN_MISMATCH"};
 for(let t=c.entryTs;t<=deadline;t+=M5){
   const b=m5map.get(t); if(!b)return {unresolved:"M5_EXIT_PATH_GAP",gapTs:t};
   if(t>=deadline){
     const raw=side===1?b.o/ep-1:ep/b.o-1;
     return {exitTs:t,exitPrice:b.o,exitReason:"TIME",rawReturn:raw,net30:raw-COST};
   }
   if(side===1&&b.l<=stop){
     const px=Math.min(b.o,stop),raw=px/ep-1;
     return {exitTs:t+M5,exitPrice:px,exitReason:"HARD_STOP",rawReturn:raw,net30:raw-COST};
   }
   if(side===-1&&b.h>=stop){
     const px=Math.max(b.o,stop),raw=ep/px-1;
     return {exitTs:t+M5,exitPrice:px,exitReason:"HARD_STOP",rawReturn:raw,net30:raw-COST};
   }
 }
 return {unresolved:"NO_EXIT"};
}
function metrics(xs,key="native"){
 const vals=xs.filter(x=>!x[key].unresolved).map(x=>x[key].net30);
 const gp=vals.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-vals.filter(x=>x<=0).reduce((a,b)=>a+b,0);
 return {n:vals.length,wins:vals.filter(x=>x>0).length,losses:vals.filter(x=>x<=0).length,
   wr:vals.length?vals.filter(x=>x>0).length/vals.length:null,
   mean:vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null,
   sum:vals.reduce((a,b)=>a+b,0),pf:gl?gp/gl:(gp?999:null),
   unresolved:xs.filter(x=>x[key].unresolved).length};
}
function rowsFor(label,h1src,m5src,begin,end){
 const h1=h1src.rows,m5=m5src.rows; assertContinuous(h1,H,label+"_H1","timestampMs");assertContinuous(m5,M5,label+"_M5","t");
 const map=new Map(m5.map(x=>[x.t,x]));
 const cs=generate(h1,begin,end);
 const accepted=cs.filter(c=>c.improvementAccepted);
 return accepted.map((c,i)=>({id:label+"_"+String(i+1).padStart(4,"0"),period:label,key:c.key,symbol:c.symbol,
   entryTs:c.entryTs,side:c.side===1?"LONG":"SHORT",entryOpen:c.entryOpen,hardStop:c.hardStop,maxHoldHours:c.maxHoldHours,
   ret14:c.ret14,strength:c.strength,margin:c.margin,native:model(c,map,false),opposite:model(c,map,true)}));
}

const preH1=readGz(PRE+"/"+SYM+"-1h-20250301-20251001.jsonl.gz","h1");
const preM5=readGz(PRE+"/"+SYM+"-5m-20250301-20251001.jsonl.gz","m5");
const fwdBase=readGz(ROOT+"/aster-public-v3-h1/"+SYM+"-1h-20250924-20261001.jsonl.gz","h1");
const fwdH=readGz(FWD+"/aster-h1/"+SYM+"-1h-20261001-20261108T20.jsonl.gz","h1");
const fwdM=readGz(FWD+"/aster-m5/"+SYM+"-5m-20261001-20261108T20.jsonl.gz","m5");
const fwdCombined={rows:[...fwdBase.rows,...fwdH.rows],hash:null,path:"ASTER_MAIN_PLUS_FORWARD"};
for(let i=1;i<fwdCombined.rows.length;i++){
 if(fwdCombined.rows[i].timestampMs===fwdCombined.rows[i-1].timestampMs){fwdCombined.rows.splice(i,1);i--;}
}
const pre=rowsFor("PRETARGET_BINANCE_PROXY",preH1,preM5,PRE_BEGIN,PRE_END);
const fwd=rowsFor("FORWARD_ASTER",fwdCombined,fwdM,FWD_BEGIN,FWD_END);

const splits={
 train:pre.filter(x=>x.entryTs<TRAIN_END),
 validation:pre.filter(x=>x.entryTs>=TRAIN_END&&x.entryTs<VALID_END),
 prehold:pre.filter(x=>x.entryTs>=VALID_END),
 pretarget:pre,
 forward:fwd
};
const audit={};
for(const [k,v] of Object.entries(splits))audit[k]={native:metrics(v,"native"),opposite:metrics(v,"opposite")};
const body=[...pre,...fwd].map(x=>JSON.stringify(x)).join("\n")+((pre.length+fwd.length)?"\n":"");
fs.writeFileSync(OUT+"/q102-render-brk168-preatarget-forward-cases.jsonl",body);
const summary={
 status:"Q102_RENDER_BRK168_PRETARGET_BINANCE_PROXY_FORWARD_ASTER_CURRENT_PIN_DIRECTION_AUDIT",
 route:KEY,costBps:30,
 pin:"ef1ab178e26a7bf5bddb6473467765edba242e1d",
 audit,
 pretargetCandidateN:pre.length,forwardCandidateN:fwd.length,
 sources:{preH1:{path:preH1.path,sha256:preH1.hash},preM5:{path:preM5.path,sha256:preM5.hash},
   forwardWarmupH1:{path:fwdBase.path,sha256:fwdBase.hash},forwardH1:{path:fwdH.path,sha256:fwdH.hash},forwardM5:{path:fwdM.path,sha256:fwdM.hash}},
 outputSha256:sha(Buffer.from(body)),
 limitations:[
  "Pretarget uses Binance UM candles as a venue proxy because Aster early RENDER history is unavailable.",
  "Forward uses Aster public H1/M5.",
  "Route-level candidate quality only; global Q102 one-slot competition, owner occupancy, shared-risk flatten, funding and signed venue fills are not replayed.",
  "Opposite direction is a diagnostic shadow only and is not an adopted trading rule.",
  "M5 hard-stop model is gap-aware resident-stop approximation."
 ]
};
fs.writeFileSync(OUT+"/SUMMARY.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
