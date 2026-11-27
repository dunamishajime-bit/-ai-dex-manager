/** R21 public-data observation kernel: no order authority. */
import type {Raw} from "./stable4-public-market-reconstruction";
import type {Candidate} from "./stable4-research-decision-observation";
const H=3600000,M=300000;
export const R21_SYMBOLS=["ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"] as const;
type Bar=number[]|null;
export type R21Series={startH:number;startM:number;h:Bar[];m:Bar[];bin:Bar[]};
const finite=(a:Bar|undefined):a is number[]=>Array.isArray(a)&&a.length>=5&&a.slice(0,5).every(Number.isFinite);
function slice(a:Bar[],lo:number,hi:number):number[][]|undefined{
 if(lo<0||hi>a.length)return;const z=a.slice(lo,hi);return z.every(finite)?z:undefined;
}
function atr(h:Bar[],i:number){const z=slice(h,i-15,i);if(!z)return;return z.slice(1).reduce((s,b,j)=>s+Math.max(b[1]-b[2],Math.abs(b[1]-z[j][3]),Math.abs(b[2]-z[j][3])),0)/14;}
export function quality(s:R21Series,t:number){
 const i=(t-s.startH)/H,k=(t-s.startM)/M;if(!Number.isInteger(i)||!Number.isInteger(k)||i<60||k<576)return false;
 const h=slice(s.h,i-48,i),m=slice(s.m,k-576,k);if(!h||!m||m.filter(x=>x[4]>0).length<432)return false;
 for(let j=0;j<6;j++){
  const a=h[42+j],b=m.slice(504+12*j,516+12*j),v=[b[0][0],Math.max(...b.map(x=>x[1])),Math.min(...b.map(x=>x[2])),b[11][3]];
  if(v.some((x,k)=>x<=0||Math.abs(a[k]/x-1)>.001))return false;
 }return true;
}
export function old24(s:R21Series,btc:R21Series,t:number){
 const i=(t-s.startH)/H;if(s.startH!==btc.startH||!quality(s,t)||i<73)return false;
 const h=s.h,b=btc.h,z=slice(h,i-48,i),bb=slice(b,i-73,i);if(!z||!bb||z.filter(x=>x[4]>0).length<36)return false;
 const a=atr(h,i);if(!a||a<=0)return false;
 const c=z[47][3];
 for(const n of [24,12,6]){
  const j=i-(t/H)%n;if(!finite(h[j-1])||!finite(h[j-n-1])||h[j-1]![3]>=h[j-n-1]![3])return false;
 }
 if(c/h[i-7]![3]>=b[i-1]![3]/b[i-7]![3]||c>=Math.min(...z.slice(-13,-1).map(x=>x[2]))-.1*a)return false;
 const b24=b[i-1]![3]-b[i-25]![3],b72=b[i-1]![3]-b[i-73]![3];
 if(b24>0&&b72>0||(h[i-4]![3]-c)/a>2)return false;
 if(b24<0&&b72<0){
  const room=slice(h,i-169,i-1);if(!room||(c-Math.min(...room.map(x=>x[2])))/a<.5)return false;
  const w=slice(b,i-169,i),f=slice(s.bin,i-3,i);
  const v=f?.reduce((a,x)=>a+x[4],0)??0;
  const sell=!!f&&v>0&&f.every(x=>Number.isFinite(x[5]))&&2*f.reduce((a,x)=>a+x[5],0)/v-1<0;
  return !!(sell||w&&w.at(-1)![3]>w[0][3]);
 }return true;
}
function flow(rows:Bar[],i:number){
 const z=slice(rows,i-25,i);if(!z)return;const r=z.slice(-24);
 if(!r.every(x=>Number.isFinite(x[5])&&x[5]>=0&&x[5]<=x[4]+1e-9))return;
 const recent=r.slice(-3),prior=r.slice(0,-3),v=recent.reduce((a,x)=>a+x[4],0),p=prior.reduce((a,x)=>a+x[4],0);
 if(v<=0||p<=0)return;
 return {imb:2*recent.reduce((a,x)=>a+x[5],0)/v-1,ratio:7*v/p,ret:z[24][3]/z[21][3]-1};
}
export function new48Score(s:R21Series,t:number){
 const i=(t-s.startH)/H;if(t%(3*H)!==0||!quality(s,t)||!slice(s.h,i-73,i))return;
 const a=flow(s.h,i),b=flow(s.bin,i);if(!a||!b)return;
 if(a.imb>=.15&&a.ratio>=1.5&&a.ret<0)return a.imb*Math.min(a.ratio,10);
}
export function confirmNew48(s:R21Series,origin:number,t:number){
 if(![H,2*H,3*H].includes(t-origin)||!quality(s,t))return false;
 const a=(origin-s.startM)/M,j=(t-s.startM)/M;
 const x=s.m[a],b=s.m[j-12],c=s.m[j-1];
 return finite(x)&&finite(b)&&finite(c)&&c[3]<x[0]&&c[3]<b[0];
}
export function observationAt(data:Record<string,R21Series>,t:number):Candidate[]{
 if(!data.BTC||R21_SYMBOLS.some(s=>!data[s]))throw Error("R21_UNIVERSE_INCOMPLETE");
 const out:Candidate[]=[];const add=(s:string,route:Candidate["route"])=>out.push({id:[route,s,t].join("|"),symbol:s+"USDT",route,ts:t,gross:.3,side:"SHORT"});
 for(const s of R21_SYMBOLS)if(old24(data[s],data.BTC,t))add(s,"R21_OLD24");
 for(const origin of [t-3*H,t-2*H,t-H]){
  if(origin%(3*H))continue;
  const options=R21_SYMBOLS.flatMap(s=>{const score=new48Score(data[s],origin);return score===undefined?[]:[{s,score}];}).sort((a,b)=>b.score-a.score||(a.s<b.s?1:-1));
  const x=options[0];if(!x)continue;
  if(confirmNew48(data[x.s],origin,t)&&![H,2*H].some(d=>origin+d<t&&confirmNew48(data[x.s],origin,origin+d)))add(x.s,"R21_NEW48");
 }return out;
}
export function normalizeR21Raw(h:readonly Raw[],m:readonly Raw[],bin:readonly Raw[],t:number):R21Series{
 const startH=t-192*H,startM=t-51*H;
 function pack(rows:readonly Raw[],start:number,width:number,n:number,flowRequired:boolean){
  const a:Bar[]=Array(n).fill(null);for(const r of rows){
   const ts=Number(r[0]),i=(ts-start)/width;
   if(!Number.isInteger(i)||i<0||i>=n||Number(r[6])!==ts+width-1||a[i]!==null)throw Error("R21_RAW_CLOCK_OR_DUPLICATE");
   const v=r.slice(1,6).map(Number);
   if(!v.every(Number.isFinite)||!(v[2]>0&&v[2]<=Math.min(v[0],v[3])&&Math.max(v[0],v[3])<=v[1])||v[4]<0)throw Error("R21_RAW_INVALID");
   if(flowRequired){const taker=Number(r[9]);if(!Number.isFinite(taker)||taker<0||taker>v[4]+1e-9)throw Error("R21_TAKER_MISSING");v.push(Math.min(taker,v[4]));}
   a[i]=v;
  }if(a.some(x=>x===null))throw Error("R21_RAW_GAP");return a;
 }
 return {startH,startM,h:pack(h,startH,H,192,true),m:pack(m,startM,M,612,false),bin:pack(bin,startH,H,192,true)};
}
