import * as fs from "node:fs";
import * as path from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {computeProductionH1Features} from "./v4-pin-source-e788abc8/lib/v12-v4-production-features";
const root=process.argv[2],oldPath=process.argv[3],outPath=process.argv[4],H=3600000;
if(!root||!oldPath||!outPath)throw Error("INPUT_REQUIRED");
const old=fs.readFileSync(oldPath,"utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x));
if(old.length!==1394)throw Error("EXPECTED_1394");
const symbols=[...new Set(old.map(x=>x.symbol).concat("BTCUSDT"))];
type H1Bar={openTs:number;open:number;high:number;low:number;close:number;quoteVolume:number};
const data:Record<string,{bars:H1Bar[],idx:Map<number,number>}>= {};
const sourceHash:any={};
for(const sym of symbols){
 const bars:H1Bar[]=[],hash:any[]=[];
 for(const dirname of ["aster-public-v3-h1-early","aster-public-v3-h1"]){
  for(const f of fs.readdirSync(path.join(root,dirname)).filter(x=>x.startsWith(sym+"-1h-")&&x.endsWith(".jsonl.gz"))){
   const bytes=fs.readFileSync(path.join(root,dirname,f));
   hash.push({path:dirname+"/"+f,sha256:createHash("sha256").update(bytes).digest("hex")});
   const content=gunzipSync(bytes).toString("utf8");
   for(const line of content.split("\n"))if(line.trim()){
    const x=JSON.parse(line);
    bars.push({openTs:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),quoteVolume:Number(x[7])});
   }
  }
 }
 bars.sort((a,b)=>a.openTs-b.openTs);
 const uniq:H1Bar[]=[];
 for(const z of bars)if(!uniq.length||uniq.at(-1)!.openTs!==z.openTs)uniq.push(z);
 const idx=new Map<number,number>(uniq.map((x,i)=>[x.openTs,i]));
 data[sym]={bars:uniq,idx};sourceHash[sym]=hash;
}
const matches:any[]=[],failures:any[]=[];
let maxAbsDelta=0;
for(const x of old){
 const ts=Number(x.entryTs),src=data[x.symbol],btc=data.BTCUSDT,a=src.idx.get(ts),b=btc.idx.get(ts);
 if(a===undefined||b===undefined||a<60||b<60){failures.push({id:x.id,reason:"INPUT_H1_WARMUP_NOT_AVAILABLE"});continue;}
 try{
  const n=computeProductionH1Features(x.symbol,x.side,ts,ts,src.bars.slice(a-60,a),btc.bars.slice(b-60,b));
  const delta=Math.abs(n.atr14-Number(x.entryAtr));
  maxAbsDelta=Math.max(maxAbsDelta,delta);
  if(delta>1e-9)failures.push({id:x.id,sourceATR:n.atr14,oldATR:x.entryAtr,delta});
  else matches.push({id:x.id,entryAtr:n.atr14,entryTs:ts,sourceSymbol:x.symbol});
 }catch(e:any){failures.push({id:x.id,error:String(e?.message||e)});}
}
const z={schema:"p107-v4-1394-source-native-entry-atr-price-path-proof/v1",pin:"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",oldEntryCount:old.length,exactSourceAtrMatches:matches.length,mismatches:failures,sourceMaxAbsAtrDelta:maxAbsDelta,sourceHashes:sourceHash,matches,fullyOrderAndExitProven:false};
fs.writeFileSync(outPath,JSON.stringify(z,null,2)+"\n");
console.log(JSON.stringify({old:old.length,matched:matches.length,mismatch:failures.length,maxAtrDelta:maxAbsDelta,examples:failures.slice(0,5)}));
