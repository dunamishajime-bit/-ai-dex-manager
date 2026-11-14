import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { generateQuality102CausalV4S34ShadowCandidates } from "../lib/disdex-quality102-causal-v4-s34";

type Row={timestampMs:number;open:number;high:number;low:number;close:number;quoteVolume:number;baseVolume?:number};
function load(path:string):Row[]{
 const raw=gunzipSync(readFileSync(path)).toString("utf8").trim().split(String.fromCharCode(10)).map((s)=>s.trim()).filter(Boolean).map(JSON.parse);
 return raw.map((z:any)=>({timestampMs:Number(z[0]),open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),quoteVolume:Number(z[5]),baseVolume:Number(z[5])}));
}
const root="C:/tmp/disdex-bt-20251001-20261001";
const a=[...load(root+"/aster-public-v3-h1/UNIUSDT-1h-20250924-20261001.jsonl.gz"),...load(root+"/FORWARD_HOLDOUT_20261001_20261108/aster-h1/UNIUSDT-1h-20261001-20261108T20.jsonl.gz")];
const by=new Map(a.map(x=>[x.timestampMs,x]));
const ts=[...by.keys()].sort((x,y)=>x-y);
const rows=ts.map(t=>by.get(t)!);
const start=Date.parse("2026-10-01T00:00:00Z"),end=Date.parse("2026-11-08T20:00:00Z"),H=3600000;
let hits:any[]=[];
for(let i=168;i<rows.length-25;i++){
 const entryTs=rows[i].timestampMs+H;
 if(entryTs<start||entryTs>=end)continue;
 const entry=rows[i+1];
 if(!entry||entry.timestampMs!==entryTs)continue;
 const hist=rows.slice(0,i+1);
 const cs=generateQuality102CausalV4S34ShadowCandidates({symbol:"UNIUSDT",rows:hist,entryOpen:{timestampMs:entryTs,open:entry.open}});
 const c=cs.find(x=>x.key==="UNI|MR72_Z1.5_H24");
 if(c){
  const ex=by.get(entryTs+24*H);
  if(!ex)continue;
  const signed=c.side>0?ex.open/entry.open-1:1-ex.open/entry.open;
  hits.push({entryTs,side:c.side,strength:c.strength,margin:c.margin,ret14:c.ret14,net30:signed-.003});
 }
}
console.log(JSON.stringify({count:hits.length,hits},null,2));