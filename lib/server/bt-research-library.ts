/**
 * Owner-authenticated, strictly read-only display of pre-generated, hashed
 * research replay files. Not a BT strategy engine, not a venue order feed.
 * Private research files must NEVER be placed under public/ or GitHub Pages.
 */
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {validateReplay,type Replay} from "@/lib/bt-verification/replay";

const INDEX_MAX_BYTES=256*1024;
const REPLAY_MAX_BYTES=30*1024*1024;
const FILE_ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}_REPLAY\.json$/;
const SHA=/^[a-f0-9]{64}$/;
export type ResearchLibraryEntry={
 id:string;
 sourceCase:string;
 bps:10|30;
 frames:number;
 modeledFills:number;
 btcCandles:number;
 bytes:number;
 sha256:string;
 sourceStatus:string;
 sourceMode:"RESEARCH_MODEL_NOT_VENUE_EXECUTION";
 grossCaps:{total:number;crypto:number;stock:number};
 initialJpy:number;
 finalEquityJpy:number;
 maxDdPct:number;
 winRatePct:number;
};
type SourceIndex={
 file:string;
 sourceCase:string;
 bps:number;
 frames:number;
 modeledFills:number;
 btcCandles:number;
 bytes:number;
 sha256:string;
 sourceStatus:string;
 sourceMode:string;
 sourceGrossCaps:{total:number;crypto:number;stock:number};
 modelSummary:{initialJpy:number;finalEquityJpy:number;maxDdPct:number;winRatePct:number;modelFills:number;costBps:number};
};
function absoluteRoot(){
 const raw=process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR?.trim();
 if(!raw||!path.isAbsolute(raw))throw Error("BT_RESEARCH_LIBRARY_NOT_CONFIGURED");
 const root=path.resolve(raw);
 if(root===path.parse(root).root||/[\\/](?:public|\.next|\.git|releases|runtime|secrets|credentials)$/i.test(root)) {
   throw Error("BT_RESEARCH_LIBRARY_PATH_UNSAFE");
 }
 return root;
}
function number(n:unknown,min=0,max=1e15):n is number {
 return typeof n==="number"&&Number.isFinite(n)&&n>=min&&n<=max;
}
function safeEntry(x:unknown):x is SourceIndex{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Partial<SourceIndex>;
 const caps=v.sourceGrossCaps,summary=v.modelSummary;
 return typeof v.file==="string"&&FILE_ID.test(v.file)&&!v.file.includes("..")&&
 typeof v.sourceCase==="string"&&v.sourceCase.length>0&&v.sourceCase.length<160&&
 (v.bps===10||v.bps===30)&&number(v.frames,1,50000)&&number(v.modeledFills,0,500000)&&
 number(v.btcCandles,1,20000)&&number(v.bytes,1,REPLAY_MAX_BYTES)&&
 typeof v.sha256==="string"&&SHA.test(v.sha256)&&
 typeof v.sourceStatus==="string"&&v.sourceStatus.length<320&&
 v.sourceMode==="RESEARCH_MODEL_NOT_VENUE_EXECUTION"&&
 !!caps&&number(caps.total,0.01,90)&&number(caps.crypto,0.01,90)&&number(caps.stock,0.01,90)&&
 !!summary&&number(summary.initialJpy,0.01)&&number(summary.finalEquityJpy,0)&&
 number(summary.winRatePct,0,100)&&number(summary.maxDdPct,-100,0)&&
 summary.modelFills===v.modeledFills&&summary.costBps===v.bps;
}
async function verifiedRoot(){
 const root=absoluteRoot();
 const stat=await fs.lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("BT_RESEARCH_LIBRARY_UNSAFE_ROOT");
 return root;
}
async function verifiedIndex():Promise<{root:string;entries:SourceIndex[]}>{
 const root=await verifiedRoot();
 const index=path.join(root,"INDEX.json");
 const stat=await fs.lstat(index);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>INDEX_MAX_BYTES)
   throw Error("BT_RESEARCH_INDEX_INVALID");
 const raw=await fs.readFile(index,"utf8");
 if(Buffer.byteLength(raw)>INDEX_MAX_BYTES)throw Error("BT_RESEARCH_INDEX_OVERSIZE");
 const data:unknown=JSON.parse(raw);
 if(!Array.isArray(data)||data.length>50||data.length<1||data.some(x=>!safeEntry(x)))
   throw Error("BT_RESEARCH_INDEX_SCHEMA_INVALID");
 const entries=data as SourceIndex[];
 const unique=new Set(entries.map(x=>x.file));
 if(unique.size!==entries.length)throw Error("BT_RESEARCH_INDEX_DUPLICATE");
 return {root,entries};
}
function toPublic(x:SourceIndex):ResearchLibraryEntry{
 return {id:x.file,sourceCase:x.sourceCase,bps:x.bps as 10|30,frames:x.frames,
  modeledFills:x.modeledFills,btcCandles:x.btcCandles,bytes:x.bytes,sha256:x.sha256,
  sourceStatus:x.sourceStatus,sourceMode:"RESEARCH_MODEL_NOT_VENUE_EXECUTION",
  grossCaps:{...x.sourceGrossCaps},initialJpy:x.modelSummary.initialJpy,
  finalEquityJpy:x.modelSummary.finalEquityJpy,maxDdPct:x.modelSummary.maxDdPct,
  winRatePct:x.modelSummary.winRatePct};
}
export async function listResearchReplays():Promise<ResearchLibraryEntry[]>{
 const {entries}=await verifiedIndex();
 return entries.map(toPublic).sort((a,b)=>a.sourceCase.localeCompare(b.sourceCase)||a.bps-b.bps);
}
export async function readResearchReplay(id:string):Promise<{entry:ResearchLibraryEntry;replay:Replay}|null>{
 if(!FILE_ID.test(id)||id.includes(".."))throw Error("BT_RESEARCH_INVALID_ID");
 const {root,entries}=await verifiedIndex();
 const item=entries.find(x=>x.file===id);
 if(!item)return null;
 const file=path.join(root,id);
 if(path.dirname(file)!==root)throw Error("BT_RESEARCH_PATH_ESCAPE");
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes||
    stat.size>REPLAY_MAX_BYTES)throw Error("BT_RESEARCH_FILE_SIZE_OR_LINK_INVALID");
 const payload=await fs.readFile(file);
 if(payload.byteLength!==item.bytes||
   createHash("sha256").update(payload).digest("hex")!==item.sha256)throw Error("BT_RESEARCH_SHA256_MISMATCH");
 const raw:unknown=JSON.parse(payload.toString("utf8"));
 if(!validateReplay(raw))throw Error("BT_RESEARCH_REPLAY_INVALID");
 if(raw.mode!=="EXTERNAL"||raw.source?.kind!=="RESEARCH_MODEL_RECONSTRUCTED"||
   raw.frames.length!==item.frames||
   raw.btcCandles?.length!==item.btcCandles||
   raw.researchSummary?.modelFills!==item.modeledFills||
   raw.researchSummary?.costBps!==item.bps||
   raw.researchSummary?.initialJpy!==item.modelSummary.initialJpy||
   raw.researchSummary?.finalEquityJpy!==item.modelSummary.finalEquityJpy||
   raw.researchSummary?.maxDdPct!==item.modelSummary.maxDdPct||
   raw.researchSummary?.winRatePct!==item.modelSummary.winRatePct||
   raw.limits.total!==item.sourceGrossCaps.total||
   raw.limits.crypto!==item.sourceGrossCaps.crypto||
   raw.limits.stock!==item.sourceGrossCaps.stock||
   raw.strategyCatalog?.reduce((n,s)=>n+s.trades,0)!==item.modeledFills){
     throw Error("BT_RESEARCH_INDEX_REPLAY_MISMATCH");
   }
 return {entry:toPublic(item),replay:raw};
}
