/** Offline decision-contract replay. No order, venue, credential or runner dependency. */
export const H=3600000, M5=300000;
export type Route="R21_OLD24"|"R21_NEW48";
export type Candidate={id:string;symbol:string;route:Route;ts:number;gross:number;side:"SHORT"};
export type Phase="PENDING"|"UNKNOWN"|"OPEN"|"EXIT_PENDING";
export type Slot={candidate:Candidate;phase:Phase};
export type State={slot:Slot|null;cooldown:Record<string,number>;seen:string[];lastTs:number};
export const initial=():State=>({slot:null,cooldown:{},seen:[],lastTs:0});
export function reviewCandidate(s:State,c:Candidate,asof:number):string{
 if(!Number.isSafeInteger(asof)||!Number.isSafeInteger(c.ts)||c.ts<=0||c.ts%H!==0||asof<c.ts||asof-c.ts>15*60000||asof<s.lastTs)return "CLOCK";
 if(!c.id||!c.symbol||!["R21_OLD24","R21_NEW48"].includes(c.route)||c.side!=="SHORT"||c.gross!==.30)return "IDENTITY";
 if(s.seen.includes(c.id))return "DUPLICATE";
 if(s.slot)return "SLOT_OCCUPIED";
 if((s.cooldown[c.symbol]??0)>asof)return "COOLDOWN";
 return "ELIGIBLE_OFFLINE";
}
export type Event={type:"OBSERVED";candidate:Candidate;ts:number}|{type:"UNKNOWN"|"OPEN"|"EXIT_PENDING"|"FLAT_VERIFIED"|"UNFILLED_VERIFIED";id:string;ts:number};
export function replayEvent(s:State,e:Event):State{
 if(!Number.isSafeInteger(e.ts)||e.ts<s.lastTs)throw Error("CLOCK");
 if(e.type==="OBSERVED"){
  const reason=reviewCandidate(s,e.candidate,e.ts);
  if(reason!=="ELIGIBLE_OFFLINE")throw Error(reason);
  return {...s,lastTs:e.ts,seen:[...s.seen,e.candidate.id],slot:{candidate:{...e.candidate},phase:"PENDING"}};
 }
 const slot=s.slot;if(!slot||slot.candidate.id!==e.id)throw Error("IDENTITY");
 const phase=slot.phase;
 if(e.type==="UNFILLED_VERIFIED"){
  if(phase!=="PENDING"&&phase!=="UNKNOWN")throw Error("NOT_UNFILLED");
  return {...s,lastTs:e.ts,slot:null};
 }
 if(e.type==="FLAT_VERIFIED"){
  if(phase!=="OPEN"&&phase!=="EXIT_PENDING")throw Error("NOT_OPEN");
  return {...s,lastTs:e.ts,slot:null,cooldown:{...s.cooldown,[slot.candidate.symbol]:e.ts+12*H}};
 }
 const allowed:Record<Phase,Phase[]>={PENDING:["UNKNOWN","OPEN"],UNKNOWN:["OPEN"],OPEN:["EXIT_PENDING"],EXIT_PENDING:[]};
 if(!allowed[phase].includes(e.type))throw Error("INVALID_TRANSITION");
 return {...s,lastTs:e.ts,slot:{...slot,phase:e.type}};
}
export type P91Input={signalTs:number;asof:number;macroBull:boolean;asterPoints:number;binancePoints:number;priorH1Close:number;bar:number[]|null};
export function p91(x:P91Input){
 const {signalTs:t,asof,macroBull,asterPoints:a,binancePoints:b,priorH1Close:p,bar}=x;
 if(typeof macroBull!=="boolean"||![a,b,p,t,asof].every(Number.isFinite)||p<=0||!Number.isSafeInteger(t)||t%H!==0)return {gross:0,score:null,pass:false};
 const gross=macroBull?(a>=5&&b>=3?.5:0):.75;
 if(asof<t+M5||!bar||bar.length<6||bar[0]!==t)return {gross,score:null,pass:false};
 const [,o,h,l,c,v]=bar;
 if(![o,h,l,c,v].every(Number.isFinite)||!(l>0&&l<=Math.min(o,c)&&Math.max(o,c)<=h)||v<0)return {gross,score:null,pass:false};
 if(v===0)return {gross,score:null,pass:false};
 let score=Number(c<o)+Number(c<p)+Number((h-Math.max(o,c))/Math.max(h-l,1e-12)>=.3);
 if(c/o>1.004)score-=2;if(c/p>1.003)score--;if(c/p<.975)score--;
 return {gross,score,pass:gross>0&&score>=2};
}

// The connection is observation-only; never map these to executable candidates.
export type R21ObservationInput={candidates:Candidate[];state?:State};
export type R21Observation={status:"OBSERVATION_ONLY"|"UNAVAILABLE";orderEnabled:false;decisions:{id:string;symbol:string;route:Route;reason:string}[]};
export function observeR21(input:R21ObservationInput|undefined,asof:number):R21Observation{
 if(!input||!Array.isArray(input.candidates))return {status:"UNAVAILABLE",orderEnabled:false,decisions:[]};
 return {status:"OBSERVATION_ONLY",orderEnabled:false,decisions:input.candidates.map(c=>({id:c.id,symbol:c.symbol,route:c.route,reason:input.state?reviewCandidate(input.state,c,asof):"SLOT_STATE_UNVERIFIED"}))};
}
export type P91Observation={status:"OBSERVATION_ONLY"|"UNAVAILABLE";orderEnabled:false;gross:number;score:number|null;pass:boolean};
export function observeP91(input:P91Input|undefined,asof:number):P91Observation{
 if(!input||input.asof!==asof||asof-input.signalTs>15*60000)return {status:"UNAVAILABLE",orderEnabled:false,gross:0,score:null,pass:false};
 return {status:"OBSERVATION_ONLY",orderEnabled:false,...p91(input)};
}
