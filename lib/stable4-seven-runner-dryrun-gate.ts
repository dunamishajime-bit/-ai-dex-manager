/** STABLE4 integration dry-run contract. No order or certificate authority. */
import {evaluateRunnerDdEntry,type RunnerDdState,type RunnerDdId} from "./disdex-runner-cumulative-dd";
import {evaluatePortfolioDdEntry,type PortfolioDdState} from "./stable4-portfolio-cumulative-dd";
const H=3600000,M=300000,EPS=1e-12;
export type Sleeve=RunnerDdId;
/** Exactly the five equity bases in pinned V52 source; Aster quotes them as XXXUSDT. */
export const STABLE4_V52_EQUITY_BASES=Object.freeze(["AMZN","META","MSFT","NVDA","TSLA"] as const);
const V52_BASES=new Set<string>(STABLE4_V52_EQUITY_BASES);
export const STABLE4_V52_MAX_SLOT_GROSS=2;
/** Accept stock internal base OR its Aster venue symbol; never accept other equities. */
export function stable4ValidResearchSymbol(sleeve:Sleeve,symbol:unknown):boolean{
 if(typeof symbol!=="string")return false;
 if(sleeve==="V52"){
  const underlying=symbol.endsWith("USDT")?symbol.slice(0,-4):symbol;
  return V52_BASES.has(underlying)&&(symbol===underlying||symbol===underlying+"USDT");
 }
 return /^(?=.{4,24}$)[A-Z0-9]{2,20}USDT$/.test(symbol);
}
/** Canonical Aster asset key ensures AMZN and AMZNUSDT share one owner slot. */
export function stable4ResearchVenueAsset(sleeve:Sleeve,symbol:string):string{
 return sleeve==="V52"&&!symbol.endsWith("USDT")?symbol+"USDT":symbol;
}
export type Proposed={id:string;sleeve:Sleeve;symbol:string;side:"LONG"|"SHORT";gross:number;route:string;entryTs:number};
export type OpenRisk={id:string;sleeve:Sleeve;symbol:string;route:string;gross:number;stock:boolean;status:"PENDING"|"OPEN"|"UNKNOWN"|"EXIT_PENDING"};
export type RiskInput={candidate:Proposed;open:readonly OpenRisk[];equityUsd:number;asof:number;releaseSha:string;ddState?:RunnerDdState;portfolioDdState?:PortfolioDdState;v4GrossCap?:number};
export type Decision={status:"ELIGIBLE_OFFLINE"|"BLOCKED";reason:string;orderAuthority:false;ddMax:number|undefined};
export function evaluateStable4DryEntry(x:RiskInput):Decision{
 const blocked=(reason:string,ddMax?:number):Decision=>({status:"BLOCKED",reason,orderAuthority:false,ddMax});
 const c=x.candidate;if(!c||!Number.isSafeInteger(x.asof)||!Number.isSafeInteger(c.entryTs)||c.entryTs<=0||c.entryTs>x.asof||x.asof-c.entryTs>15*60000||!Number.isFinite(c.gross)||c.gross<=0||!Number.isFinite(x.equityUsd)||x.equityUsd<=0||!/^([a-f0-9]{40})$/.test(x.releaseSha))return blocked("CANDIDATE_OR_PROOF_INVALID");
 if(!Array.isArray(x.open)||!["LONG","SHORT"].includes(c.side)||!stable4ValidResearchSymbol(c.sleeve,c.symbol)||!c.id||!c.route||!["V4","Q102","PENGU","FET","IDLE","HYPE","V52"].includes(c.sleeve)||(x.v4GrossCap!==undefined&&(!Number.isFinite(x.v4GrossCap)||x.v4GrossCap<=0)))return blocked("SOURCE_INVALID");
 // Never calculate available Gross from unverified owner/stock classifications.
 // Unknown positions, invalid ownership, zero-notional OPEN rows, or duplicate
 // reservation IDs can all understate risk. This is an offline-only gate.
 const ids=new Set<string>();
 for(const row of x.open){
  if(!row||typeof row.id!=="string"||!row.id||ids.has(row.id)||row.id===c.id||
    !["V4","Q102","PENGU","FET","IDLE","HYPE","V52"].includes(row.sleeve)||
    !stable4ValidResearchSymbol(row.sleeve,row.symbol)||typeof row.route!=="string"||!row.route||
    !Number.isFinite(row.gross)||row.gross<=0||
    (row.sleeve==="V52"&&row.gross>STABLE4_V52_MAX_SLOT_GROSS+EPS)||
    typeof row.stock!=="boolean"||row.stock!==(row.sleeve==="V52")||
    !["PENDING","OPEN","EXIT_PENDING"].includes(row.status))
    return blocked("OPEN_OWNER_EXPOSURE_UNVERIFIED");
  ids.add(row.id);
 }
 const portfolio=evaluatePortfolioDdEntry(x.portfolioDdState,x.asof,x.releaseSha,0.30);
 if(portfolio.status!=="ELIGIBLE_OFFLINE")return blocked(portfolio.reason);
 const dd=evaluateRunnerDdEntry(x.ddState,c.sleeve,x.asof,x.releaseSha,0.30);
 if(dd.status!=="ENTRY_ALLOWED_BY_THIS_DD_ONLY")return blocked(dd.reason,dd.runnerMaxDd);
 // Even fresh portfolio and seven-runner proofs cannot be mixed with an
 // unrelated equity denominator. A full account replay must use one mark.
 const coherent=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&
  Math.abs(a-b)<=Math.max(.01,1e-8*Math.max(Math.abs(a),Math.abs(b)));
 if(!coherent(x.equityUsd,x.portfolioDdState!.equity)||
    !coherent(x.equityUsd,x.ddState!.accountEquityUsd))
    return blocked("ACCOUNT_MTM_EQUITY_MISMATCH",dd.runnerMaxDd);
 const used=x.open.reduce((z,a)=>({crypto:z.crypto+(a.stock?0:a.gross),stock:z.stock+(a.stock?a.gross:0),v4:z.v4+(a.sleeve==="V4"?a.gross:0)}),{crypto:0,stock:0,v4:0});
 const stock=c.sleeve==="V52",crypto=used.crypto+(stock?0:c.gross),shares=used.stock+(stock?c.gross:0);
 if(crypto>3+EPS||shares>4+EPS||crypto+shares>4.25+EPS)return blocked("SHARED_GROSS_CAP",dd.runnerMaxDd);
 if(c.sleeve==="V4"&&used.v4+c.gross>(x.v4GrossCap??2)+EPS)return blocked("V4_GROSS_CAP",dd.runnerMaxDd);
 if(stock&&c.gross>STABLE4_V52_MAX_SLOT_GROSS+EPS)return blocked("V52_SLOT_GROSS_CAP",dd.runnerMaxDd);
 if(x.open.some(y=>stable4ResearchVenueAsset(y.sleeve,y.symbol)===stable4ResearchVenueAsset(c.sleeve,c.symbol)))return blocked("SAME_SYMBOL_OWNERSHIP_UNRESOLVED",dd.runnerMaxDd);
 if(c.route.startsWith("R21_")&&(c.sleeve!=="V4"||c.side!=="SHORT"||Math.abs(c.gross-.3)>EPS||x.open.some(y=>y.route.startsWith("R21_"))))return blocked("R21_SINGLE_SLOT_CONTRACT",dd.runnerMaxDd);
 return {status:"ELIGIBLE_OFFLINE",reason:"ALL_OBSERVED_RISK_CHECKS_WITHIN_LIMIT",orderAuthority:false,ddMax:dd.runnerMaxDd};
}
export type ClosedM5={ts:number;open:number;high:number;low:number;close:number};
export type R21Exit={kind:"STOP8"|"TP8"|"TIME"|"SOURCE_UNAVAILABLE";ts:number;price:number|null;orderAuthority:false};
export function evaluateR21ResearchExit(input:{route:"R21_OLD24"|"R21_NEW48";entryTs:number;entryPrice:number;asof:number;bars:readonly ClosedM5[]}):R21Exit{
 const {route,entryTs,entryPrice,asof,bars}=input;
 if(!(entryPrice>0)||!Number.isSafeInteger(entryTs)||entryTs%M!==0||asof<entryTs||!Number.isSafeInteger(asof))throw Error("R21_EXIT_CLOCK_OR_PRICE_INVALID");
 const horizon=route==="R21_OLD24"?24*H:48*H,expiry=entryTs+horizon,stop=entryPrice*1.08,tp=entryPrice*.92;
 const ordered=[...bars].sort((a,b)=>a.ts-b.ts);
 let next=entryTs;
 for(const b of ordered){
  if(b.ts>=expiry)break;
  if(b.ts!==next||b.ts+M>asof||!Number.isSafeInteger(b.ts)||b.ts%M||![b.open,b.high,b.low,b.close].every(Number.isFinite)||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))return {kind:"SOURCE_UNAVAILABLE",ts:next,price:null,orderAuthority:false};
  if(b.high>=stop-EPS)return {kind:"STOP8",ts:b.ts+M,price:Math.max(stop,b.open),orderAuthority:false};
  if(route==="R21_NEW48"&&b.low<=tp+EPS)return {kind:"TP8",ts:b.ts+M,price:Math.min(tp,b.open),orderAuthority:false};
  next+=M;
 }
 if(next===expiry&&asof>=expiry){
  const expiryOpen=ordered.find(b=>b.ts===expiry);
  return expiryOpen&&Number.isFinite(expiryOpen.open)&&expiryOpen.open>0?{kind:"TIME",ts:expiry,price:expiryOpen.open,orderAuthority:false}:{kind:"SOURCE_UNAVAILABLE",ts:expiry,price:null,orderAuthority:false};
 }
 return {kind:"SOURCE_UNAVAILABLE",ts:next,price:null,orderAuthority:false};
}
