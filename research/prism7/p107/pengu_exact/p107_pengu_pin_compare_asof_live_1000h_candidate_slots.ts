import * as fs from "node:fs";
import * as path from "node:path";
import {gunzipSync} from "node:zlib";
import {buildPenguDualLsV2Signal} from "./pengu-pin-source-1657e173/lib/pengu-dual-ls-v2";
const root=process.argv[2],bulk=JSON.parse(fs.readFileSync(process.argv[3],"utf8")),out=process.argv[4],H=3600000;
type C={openTime:number,open:number,high:number,low:number,close:number,volume:number,closeTime:number};
const data:Record<string,C[]>={};
for(const sym of ["PENGUUSDT","BTCUSDT"]){
 const m=new Map<number,C>();
 for(const folder of ["aster-public-v3-h1-early","aster-public-v3-h1"]){
  for(const file of fs.readdirSync(path.join(root,folder)).filter(n=>n.startsWith(sym+"-1h-")&&n.endsWith(".jsonl.gz"))){
   const text=gunzipSync(fs.readFileSync(path.join(root,folder,file))).toString("utf8");
   for(const l of text.split("\n"))if(l.trim()){
    const v=JSON.parse(l),ts=Number(v[0]);
    m.set(ts,{openTime:ts,open:Number(v[1]),high:Number(v[2]),low:Number(v[3]),close:Number(v[4]),volume:Number(v[5]),closeTime:Number(v[6])});
   }
  }
 }
 data[sym]=[...m.values()].sort((a,b)=>a.openTime-b.openTime);
}
const events:any[]=[];
for(const e of bulk.bulkNativeCandidateEvents){
 const now=e.signalTs+H;
 const recent:Record<string,C[]>={};
 for(const sym of ["PENGUUSDT","BTCUSDT"]){
  const filtered=data[sym].filter(x=>x.closeTime<now).slice(-1000);
  if(filtered.length!==1000)throw Error("NOT_ENOUGH_REAL_H1");
  recent[sym]=filtered;
 }
 const x=buildPenguDualLsV2Signal({pengu1h:recent.PENGUUSDT,btc1h:recent.BTCUSDT,penguFunding:[]},undefined,now,0,{recoveryV8Enabled:true,v64DynamicLongEnabled:true});
 const route=x.side===-1?"SHORT_V20":x.side===1?(x.entryVersion==="RECOVERY_V8"?"RECOVERY_V8":"LONG_V64"):"NO_SIGNAL";
 events.push({signalTs:e.signalTs,bulkRoute:e.route,asofRoute:route,asofSide:x.side,asofEntryTs:x.entryTs,asofEntryVersion:x.entryVersion,asofReason:x.reason,bothEqual:route===e.route&&x.entryTs===e.entryTs});
}
const mismatched=events.filter(x=>!x.bothEqual);
const result={schema:"p107-pengu-117-bulk-candidates-vs-1000h-native-live-provider-asof/v1",pin:"1657e173d250ad58f53e62f7bb0a3428fb405496",providerLimit:1000,sourceCandidates:events.length,asofMatches:events.length-mismatched.length,asofMismatches:mismatched.length,mismatched,actualFills:0,allHourSourceScan:false,fullPortfolioBT:false,events};
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({sourceCandidates:events.length,asofMatches:result.asofMatches,asofMismatches:result.asofMismatches,examples:mismatched.slice(0,8)}));
