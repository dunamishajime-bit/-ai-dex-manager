import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";

export const IDLE_STATE_SCHEMA="disdex-idle-priority-state/v2" as const;
export type IdlePendingPhase="planned"|"submitted"|"manual_review";
export type IdlePendingAction="ENTRY"|"EXIT";

export type IdleOwnedPosition={
  symbol:IdlePrioritySymbol;
  route:string;
  side:"SHORT";
  signalTs:number;
  entryTs:number;
  exitTs:number;
  entryPrice:number;
  quantity:number;
  holdHours:12|24;
  gross:1;
  stopPrice:number;
  takeProfitPrice:number;
  stopClientOrderId:string;
  takeProfitClientOrderId:string;
  protectionVerified:true;
};

export type IdlePending={
  action:IdlePendingAction;
  phase:IdlePendingPhase;
  symbol:IdlePrioritySymbol;
  route:string;
  clientOrderId:string;
  idempotencyKey:string;
  quantity:number;
  expectedPrice:number;
  signalTs:number;
  decisionTs:number;
  holdHours:12|24;
  createdAt:number;
  updatedAt:number;
  reason:string;
  reservationId?:string;
};

export type IdleDecision={
  decisionTs:number;
  symbol?:IdlePrioritySymbol;
  route?:string;
  accepted:boolean;
  reason:string;
};

export type IdleState={
  schema:typeof IDLE_STATE_SCHEMA;
  runtimeSha:string;
  updatedAt:number;
  positions:IdleOwnedPosition[];
  manualReview:string|null;
  pending:IdlePending|null;
  lastDecision?:IdleDecision;
  lastAcceptedBySymbol:Partial<Record<IdlePrioritySymbol,number>>;
  failures:Array<{message:string;occurredAt:number}>;
};

const SYMBOLS=new Set(Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes));
function finitePositive(v:unknown){return Number.isFinite(Number(v))&&Number(v)>0;}
function validTs(v:unknown){return Number.isFinite(Number(v))&&Number(v)>0;}
function validSha(v:unknown){return /^[0-9a-f]{40}$/i.test(String(v||""));}
function validSymbol(v:unknown):v is IdlePrioritySymbol{return SYMBOLS.has(String(v));}
function routeFor(symbol:IdlePrioritySymbol){return IDLE_PRIORITY_SHORT_POLICY.routes[symbol].route;}
function holdFor(symbol:IdlePrioritySymbol){return IDLE_PRIORITY_SHORT_POLICY.routes[symbol].holdHours;}

export function emptyIdleState(runtimeSha:string,now=Date.now()):IdleState{
 if(!validSha(runtimeSha))throw new Error("IDLE_STATE_RUNTIME_SHA_INVALID");
 return {schema:IDLE_STATE_SCHEMA,runtimeSha:runtimeSha.toLowerCase(),updatedAt:now,positions:[],manualReview:null,pending:null,lastAcceptedBySymbol:{},failures:[]};
}

function validatePosition(p:IdleOwnedPosition){
 if(!p||!validSymbol(p.symbol)||p.side!=="SHORT"||p.route!==routeFor(p.symbol))throw new Error("IDLE_STATE_POSITION_INVALID");
 if(!validTs(p.signalTs)||!validTs(p.entryTs)||!validTs(p.exitTs)||p.exitTs<=p.entryTs)throw new Error("IDLE_STATE_POSITION_INVALID");
 if(!finitePositive(p.entryPrice)||!finitePositive(p.quantity)||p.gross!==1||p.holdHours!==holdFor(p.symbol))throw new Error("IDLE_STATE_POSITION_INVALID");
 if(p.exitTs!==p.entryTs+p.holdHours*3_600_000)throw new Error("IDLE_STATE_POSITION_INVALID");
 if(!finitePositive(p.stopPrice)||!finitePositive(p.takeProfitPrice)||p.stopPrice<=p.entryPrice||p.takeProfitPrice>=p.entryPrice)throw new Error("IDLE_STATE_POSITION_INVALID");
 if(!p.stopClientOrderId||!p.takeProfitClientOrderId||p.protectionVerified!==true)throw new Error("IDLE_STATE_POSITION_INVALID");
}

function validatePending(p:IdlePending){
 if(!p||!["ENTRY","EXIT"].includes(p.action)||!["planned","submitted","manual_review"].includes(p.phase))throw new Error("IDLE_STATE_PENDING_INVALID");
 if(!validSymbol(p.symbol)||p.route!==routeFor(p.symbol)||p.holdHours!==holdFor(p.symbol))throw new Error("IDLE_STATE_PENDING_INVALID");
 if(!p.clientOrderId||!p.idempotencyKey||!finitePositive(p.quantity)||!finitePositive(p.expectedPrice))throw new Error("IDLE_STATE_PENDING_INVALID");
 if(!validTs(p.signalTs)||!validTs(p.decisionTs)||!validTs(p.createdAt)||!validTs(p.updatedAt)||!p.reason)throw new Error("IDLE_STATE_PENDING_INVALID");
 if(p.reservationId!=null&&typeof p.reservationId!=="string")throw new Error("IDLE_STATE_PENDING_INVALID");
}

export function normalizeIdleState(raw:unknown,runtimeSha:string):IdleState{
 if(!raw||typeof raw!=="object")throw new Error("IDLE_STATE_MALFORMED");
 const x=raw as Partial<IdleState>;
 if(x.schema!==IDLE_STATE_SCHEMA)throw new Error("IDLE_STATE_SCHEMA_MISMATCH");
 if(!validSha(x.runtimeSha)||String(x.runtimeSha).toLowerCase()!==runtimeSha.toLowerCase())throw new Error("IDLE_STATE_RUNTIME_SHA_MISMATCH");
 if(!Array.isArray(x.positions))throw new Error("IDLE_STATE_POSITIONS_INVALID");
 x.positions.forEach((p)=>validatePosition(p));
 const positionSymbols=new Set<string>();
 for(const p of x.positions){if(positionSymbols.has(p.symbol))throw new Error("IDLE_STATE_DUPLICATE_SYMBOL_POSITION");positionSymbols.add(p.symbol);}
 if(x.pending!=null)validatePending(x.pending);
 if(x.manualReview!=null&&typeof x.manualReview!=="string")throw new Error("IDLE_STATE_MANUAL_REVIEW_INVALID");
 const cooldown=x.lastAcceptedBySymbol||{};
 for(const [symbol,ts] of Object.entries(cooldown)){if(!validSymbol(symbol)||!validTs(ts))throw new Error("IDLE_STATE_COOLDOWN_INVALID");}
 if(!Array.isArray(x.failures))throw new Error("IDLE_STATE_FAILURES_INVALID");
 const failures=x.failures.map((row)=>{if(!row||typeof row.message!=="string"||!row.message||!validTs(row.occurredAt))throw new Error("IDLE_STATE_FAILURES_INVALID");return {message:row.message,occurredAt:Number(row.occurredAt)};}).slice(-100);
 return {
  schema:IDLE_STATE_SCHEMA,
  runtimeSha:String(x.runtimeSha).toLowerCase(),
  updatedAt:Number(x.updatedAt),
  positions:x.positions,
  manualReview:x.manualReview??null,
  pending:x.pending??null,
  lastDecision:x.lastDecision,
  lastAcceptedBySymbol:{...cooldown},
  failures,
 };
}

async function safe(path:string){
 try{const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile())throw new Error("IDLE_STATE_PATH_UNSAFE");}
 catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
}
export async function readIdleState(path:string,runtimeSha:string){
 await safe(path);
 try{return normalizeIdleState(JSON.parse(await readFile(path,"utf8")),runtimeSha);}
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return emptyIdleState(runtimeSha);throw e;}
}
export async function writeIdleState(path:string,state:IdleState){
 await safe(path);
 const normalized=normalizeIdleState({...state,updatedAt:Date.now()},state.runtimeSha);
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const tmp=`${path}.${process.pid}.${Date.now()}.tmp`;
 try{
  await writeFile(tmp,JSON.stringify(normalized,null,2)+"\n",{mode:0o600});
  await rename(tmp,path);
  await chmod(path,0o600);
 }catch(e){await unlink(tmp).catch(()=>{});throw e;}
}

export class FileIdlePriorityShortStateStore {
  constructor(private readonly path:string, private readonly runtimeSha:string) {}
  load(){ return readIdleState(this.path,this.runtimeSha); }
  save(state:IdleState){ return writeIdleState(this.path,state); }
}
