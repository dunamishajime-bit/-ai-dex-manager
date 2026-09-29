import { mkdir,readFile,rename,unlink,writeFile,lstat } from "node:fs/promises";
import { dirname } from "node:path";
export const IDLE_STATE_SCHEMA="disdex-idle-priority-state/v1" as const;
export type IdleOwnedPosition={symbol:string;route:string;side:"SHORT";entryTs:number;entryPrice:number;quantity:number;holdHours:number;protectionVerified:boolean};
export type IdleState={schema:typeof IDLE_STATE_SCHEMA;runtimeSha:string;updatedAt:number;positions:IdleOwnedPosition[];manualReview:boolean;pending?:{symbol:string;idempotencyKey:string;createdAt:number}|null};
export function emptyIdleState(runtimeSha:string,now=Date.now()):IdleState{return {schema:IDLE_STATE_SCHEMA,runtimeSha,updatedAt:now,positions:[],manualReview:false,pending:null};}
export function normalizeIdleState(raw:unknown,runtimeSha:string):IdleState{
 if(!raw||typeof raw!=="object")throw new Error("IDLE_STATE_MALFORMED");const x=raw as Partial<IdleState>;
 if(x.schema!==IDLE_STATE_SCHEMA)throw new Error("IDLE_STATE_SCHEMA_MISMATCH");
 if(String(x.runtimeSha||"").toLowerCase()!==runtimeSha.toLowerCase())throw new Error("IDLE_STATE_RUNTIME_SHA_MISMATCH");
 if(!Array.isArray(x.positions))throw new Error("IDLE_STATE_POSITIONS_INVALID");
 for(const p of x.positions){if(!p||p.side!=="SHORT"||!["TAOUSDT","TIAUSDT","DOTUSDT","JUPUSDT","RENDERUSDT"].includes(p.symbol)||!(p.quantity>0&&p.entryPrice>0&&p.entryTs>0)||![12,24].includes(p.holdHours)||p.protectionVerified!==true)throw new Error("IDLE_STATE_POSITION_INVALID");}
 return x as IdleState;
}
async function safe(path:string){try{const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile())throw new Error("IDLE_STATE_PATH_UNSAFE");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
export async function readIdleState(path:string,runtimeSha:string){await safe(path);try{return normalizeIdleState(JSON.parse(await readFile(path,"utf8")),runtimeSha);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return emptyIdleState(runtimeSha);throw e;}}
export async function writeIdleState(path:string,state:IdleState){await safe(path);await mkdir(dirname(path),{recursive:true});const tmp=`${path}.${process.pid}.${Date.now()}.tmp`;try{await writeFile(tmp,JSON.stringify(state,null,2)+"\n",{mode:0o600});await rename(tmp,path);}catch(e){await unlink(tmp).catch(()=>{});throw e;}}
