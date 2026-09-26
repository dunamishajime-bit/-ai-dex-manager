import { lstat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CURRENT = "/home/deploy/disdex-trading/current";
const SHA_PATH = CURRENT + "/.disdex-release-sha";
const POLICY = CURRENT + "/config/hypeZecLongPolicy.ts";
const STATE = "/var/lib/disdex/hype-zec-long/runner.json";
const KILL = "/var/lib/disdex/shared/kill-switch.json";
const FIFTEEN_MS = 15 * 60_000;
const SHA = /^[0-9a-f]{40}$/;
const PARAMS = ["btcMinMoveBps", "btcMinAccelBps", "btcMaxMoveBps", "symbolMinMoveBps",
  "symbolMinAccelBps", "symbolMaxDistanceBps", "breakoutBps", "breakoutConfirmMinutes",
  "holdMinutes", "stopLossPct", "takeProfitPct", "trailActivationPct", "trailRetracePct"] as const;
type Key = "HYPE_LONG" | "ZEC_LONG";
type Params = Record<(typeof PARAMS)[number], number>;
type Obj = Record<string, unknown>;
export type HypeZecGate = { key: string; label: string; status: "PASS" | "BLOCKED" | "UNKNOWN";
  actual?: number | string; threshold?: number | string; reason: string; source: "PUBLIC_CANDLES" | "RUNNER_STATE" | "EXECUTION" };
export type HypeZecSleeve = { strategy: Key; symbol: "HYPEUSDT" | "ZECUSDT";
  status: "LIVE" | "SHADOW" | "STALE" | "BLOCKED" | "NOT_DEPLOYED" | "UNCONFIRMED";
  runtimeSha: string; stateSha?: string; stateMode?: string; serviceActive?: boolean;
  stateUpdatedAt?: number; lastDecision?: { accepted: boolean; reason: string; at?: number };
  position?: { quantity: number; entryPrice: number; stopPrice: number; takeProfitPrice: number };
  pending?: boolean; manualReview?: string; maxGross?: number; riskPct?: number;
  publicSignalEligible: boolean | null; publicReferenceTs?: number; publicError?: string;
  gates: HypeZecGate[]; note: string };
export type HypeZecOverview = { ok: true; readOnly: true; tradingMutation: 0; capturedAt: string;
  releaseSha: string; sourceDeployed: boolean; stateAvailable: boolean;
  serviceActive: boolean; sharedKillActive: boolean | null; sleeves: Record<Key, HypeZecSleeve> };

function obj(v: unknown): Obj | null { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : null; }
function str(v: unknown) { return typeof v === "string" && v.trim() ? v.trim() : undefined; }
function num(v: unknown) { const n=Number(v); return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : undefined; }
async function safeJson(path: string): Promise<Obj | null> {
  try { const s=await lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.size > 400_000) return null;
    return obj(JSON.parse(await readFile(path,"utf8"))); } catch { return null; }
}
function policy(source: string,key:Key): Params | null {
  const section=source.split(key + ": Object.freeze({")[1]?.split("signal: Object.freeze({")[1]?.split("})")[0];
  if (!section) return null;
  const values: Record<string,number>={};
  for (const name of PARAMS) { const m=section.match(new RegExp("\\b"+name+"\\s*:\\s*([-+]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+))"));
    if (!m) return null; values[name]=Number(m[1]); }
  return values as Params;
}
function go(key:string,label:string,pass:boolean|null,actual:unknown,threshold:unknown,reason:string,
  source:HypeZecGate["source"]="PUBLIC_CANDLES"):HypeZecGate {
  return {key,label,status:pass===null?"UNKNOWN":pass?"PASS":"BLOCKED",
    ...(actual===undefined?{}:{actual:String(actual)}),
    ...(threshold===undefined?{}:{threshold:String(threshold)}),reason,source};
}
type Candle = { ts:number;close:number;high:number };
function parseCandles(data:unknown,period:number,now:number):Candle[] {
  if (!Array.isArray(data)) throw new Error("ASTERCANDLES_NOT_ARRAY");
  const rows:Candle[]=data.map((row)=>{
    if (!Array.isArray(row)) throw new Error("ASTERCANDLE_INVALID");
    const ts=Number(row[0]),high=Number(row[2]),close=Number(row[4]);
    if (![ts,high,close].every(Number.isFinite) || ts<=0 || high<=0 || close<=0) throw new Error("ASTERCANDLE_INVALID");
    return {ts,high,close}; }).filter(x=>x.ts+period<=now).sort((a,b)=>a.ts-b.ts);
  if (rows.length<3) throw new Error("ASTERCANDLES_INSUFFICIENT");
  for(let i=1;i<rows.length;i++) if(rows[i].ts<=rows[i-1].ts || rows[i].ts-rows[i-1].ts>period*2)
    throw new Error("ASTERCANDLES_GAP_OR_DUPLICATE");
  return rows;
}
async function candles(symbol:string,interval:string,limit:number,now:number):Promise<Candle[]> {
  const url=new URL("https://fapi.asterdex.com/fapi/v3/klines");
  url.searchParams.set("symbol",symbol);url.searchParams.set("interval",interval);url.searchParams.set("limit",String(limit));
  const response=await fetch(url.toString(),{signal:AbortSignal.timeout(6500),next:{revalidate:60}});
  if(!response.ok)throw new Error("ASTER_PUBLIC_KLINES_HTTP_"+response.status);
  return parseCandles(await response.json(),interval==="15m"?FIFTEEN_MS:60_000,now);
}
type Market = {btc:Candle[];hype:Candle[];hypeMinute:Candle[];zec:Candle[];zecMinute:Candle[]};
let marketCache:{until:number;promise:Promise<Market>}|null=null;
function loadMarket(now:number):Promise<Market>{
  if(marketCache && marketCache.until>now)return marketCache.promise;
  const promise=Promise.all([candles("BTCUSDT","15m",100,now),candles("HYPEUSDT","15m",100,now),
    candles("HYPEUSDT","1m",180,now),candles("ZECUSDT","15m",100,now),
    candles("ZECUSDT","1m",180,now)])
    .then(([btc,hype,hypeMinute,zec,zecMinute])=>({btc,hype,hypeMinute,zec,zecMinute}));
  marketCache={until:now+60_000,promise};
  void promise.catch(()=>{if(marketCache?.promise===promise)marketCache=null;});
  return promise;
}
function marketGates(data:Market,which:Key,p:Params,now:number) {
  const symbol=which==="HYPE_LONG"?data.hype:data.zec,minute=which==="HYPE_LONG"?data.hypeMinute:data.zecMinute;
  const b=data.btc.at(-1)!,s=symbol.at(-1)!;
  const gates:HypeZecGate[]=[];
  const fresh=now-b.ts<=20*60_000 && now-s.ts<=20*60_000 && now>=b.ts+FIFTEEN_MS && now>=s.ts+FIFTEEN_MS;
  gates.push(go("DATA_FRESHNESS","確定15分足 / 鮮度",fresh,Math.max(now-b.ts,now-s.ts)/60000,"20分以内（足の開始時刻から）",
    "実Runnerと同じ確定足と20分鮮度条件"));
  const move=(rows:Candle[],offset:number)=> (rows.at(offset)!.close/rows.at(offset-1)!.close-1)*10000;
  const bm=move(data.btc,-1),ba=bm-move(data.btc,-2),sm=move(symbol,-1),sa=sm-move(symbol,-2);
  let e=0;const alpha=2/21;for(const row of symbol)e=e===0?row.close:row.close*alpha+e*(1-alpha);
  const dist=Math.abs((s.close/Math.max(e,1e-7)-1)*10000);
  gates.push(go("BTC_15M_MOVE","BTC 15分足モメンタム",bm>=p.btcMinMoveBps && bm<=p.btcMaxMoveBps,bm.toFixed(2),
    String(p.btcMinMoveBps)+"～"+p.btcMaxMoveBps+"bps","確定BTC 15m足の上昇幅"));
  gates.push(go("BTC_ACCEL","BTC 加速度",ba>=p.btcMinAccelBps,ba.toFixed(2),">="+p.btcMinAccelBps+"bps","前15分足からの差"));
  gates.push(go("SYMBOL_MOMENTUM","対象通貨15分足",sm>=p.symbolMinMoveBps,sm.toFixed(2),">="+p.symbolMinMoveBps+"bps","確定足上昇幅"));
  gates.push(go("SYMBOL_ACCEL","対象通貨加速度",sa>=p.symbolMinAccelBps,sa.toFixed(2),">="+p.symbolMinAccelBps+"bps","直前15分足からの変化"));
  gates.push(go("EMA20_DISTANCE","EMA20乖離",dist<=p.symbolMaxDistanceBps,dist.toFixed(2),
    "<="+p.symbolMaxDistanceBps+"bps","20期間EMAに対する絶対距離"));
  const target=s.close*(1+p.breakoutBps/10000);
  const until=s.ts+FIFTEEN_MS+p.breakoutConfirmMinutes*60_000;
  const confirmation=minute.filter(x=>x.ts>=s.ts+FIFTEEN_MS && x.ts<=until && x.ts<=now)
    .find(x=>x.high>=target);
  const windowClosed=now>until;
  gates.push(go("BREAKOUT_1M","1分足ブレイク確認",confirmation?true:windowClosed?false:null,
    confirmation?confirmation.high.toFixed(8):"確定データ待機",
    ">="+target.toFixed(8)+" / "+p.breakoutConfirmMinutes+"分以内",
    "確定15分足終値から1分足の高値を確認"));
  const accepted=gates.every(g=>g.status==="PASS");
  return {gates,accepted,reference:s.ts};
}
async function serviceActive(sha:string):Promise<boolean>{
  try { const r=await execFileAsync("systemctl",["is-active","disdex-hype-zec-long@"+sha+".service"],{timeout:2200});
    return r.stdout.trim()==="active"; }catch {return false;}
}
export async function loadHypeZecRuntimeObservability(now=Date.now()):Promise<HypeZecOverview>{
  const releaseSha=(await readFile(SHA_PATH,"utf8")).trim();
  if(!SHA.test(releaseSha))throw new Error("CURRENT_RUNTIME_SHA_INVALID");
  const capturedAt=new Date(now).toISOString();
  const source=await readFile(POLICY,"utf8").catch(()=>null);
  const state=await safeJson(STATE),kill=await safeJson(KILL);
  const active=source!==null && await serviceActive(releaseSha);
  const sourceDeployed=source!==null;
  const stateAvailable=state!==null;
  const stateSha=str(state?.runtimeCommitSha),mode=str(state?.mode);
  const updatedAt=num(state?.updatedAt),ageMs=updatedAt===undefined?null:now-updatedAt;
  const shaOk=stateSha===releaseSha,cleanState=!state?.pending&&!str(state?.manualReview)&&
    (!Array.isArray(state?.failures)||state.failures.length===0);
  const killActive=typeof kill?.active==="boolean"?kill.active:null;
  let market:Market|null=null,marketError:string|undefined;
  if(sourceDeployed&&stateAvailable&&shaOk){
    try{market=await loadMarket(now);}catch(e){marketError=e instanceof Error?e.message:"PUBLIC_CANDLES_UNAVAILABLE";}
  }
  const results={} as Record<Key,HypeZecSleeve>;
  for(const key of ["HYPE_LONG","ZEC_LONG"] as const){
    const symbol=key==="HYPE_LONG"?"HYPEUSDT":"ZECUSDT";
    const p=source?policy(source,key):null;
    const positions=Array.isArray(state?.positions)?state.positions.map(obj).filter((x):x is Obj=>x!==null):[];
    const pos=positions.find(x=>x.strategy===key && x.symbol===symbol);
    const last=obj(state?.lastDecision);
    const specific=last?.strategy===key?last:null;
    const fresh=ageMs!==null&&ageMs>=-60_000&&ageMs<=180_000;
    const status: HypeZecSleeve["status"]=!sourceDeployed||!stateAvailable?"NOT_DEPLOYED":
      !shaOk?"BLOCKED":!fresh?"STALE":mode!=="LIVE"?"SHADOW":
      !active||!cleanState||killActive!==false?"UNCONFIRMED":"LIVE";
    const gates:HypeZecGate[]=[
      go("DEPLOYED","本番ソース・Runner接続",sourceDeployed&&stateAvailable&&shaOk&&active,active?"active":"未起動",
        "新SHA・systemd active・state一致","判定と発注可能性は別物","RUNNER_STATE"),
      go("RUNTIME_MODE","実Runnerモード",mode==="LIVE",mode??"stateなし","LIVE","SHADOW時は発注不可","RUNNER_STATE"),
      go("SHARED_KILL","Shared Kill Switch",killActive===null?null:!killActive,
        killActive===null?"未取得":killActive?"ON":"OFF","OFF","未知の場合は発注可とは判断しません","RUNNER_STATE"),
      go("PENDING_REVIEW","Pending・要確認",stateAvailable?cleanState:null,
        stateAvailable?cleanState?"なし":"あり":"未取得","なし","共有注文・手動レビュー状態","RUNNER_STATE"),
    ];
    let publicSignalEligible:boolean|null=null,publicReferenceTs:number|undefined;
    if(p && market){
      const evaluation=marketGates(market,key,p,now);
      gates.push(...evaluation.gates);publicSignalEligible=evaluation.accepted;publicReferenceTs=evaluation.reference;
    }else for(const [g,label] of [["DATA_FRESHNESS","確定15分足・鮮度"],["BTC_15M_MOVE","BTC 15分足"],["BTC_ACCEL","BTC加速度"],
      ["SYMBOL_MOMENTUM","対象通貨モメンタム"],["SYMBOL_ACCEL","対象通貨加速度"],["EMA20_DISTANCE","EMA20乖離"],
      ["BREAKOUT_1M","1分足ブレイク確認"]] as const)
      gates.push(go(g,label,null,undefined,undefined,!p?"Productionの実設定待ち":marketError||"公開15分足待機"));
    gates.push(go("VENUE_AND_PORTFOLIO","5x Cross・容量・保護注文",
      null,undefined,"注文直前の実Runner read-back","この欄は市場条件が成立しても、実Runnerの注文直前照合を証明しません","EXECUTION"));
    results[key]={strategy:key,symbol,status,runtimeSha:releaseSha,stateSha,stateMode:mode,serviceActive:active,
      stateUpdatedAt:updatedAt,lastDecision:specific?{
        accepted:specific.accepted===true,reason:str(specific.reason)||"未取得",at:num(state?.lastDecisionTs)}:undefined,
      position:pos?{quantity:num(pos.quantity)||0,entryPrice:num(pos.entryPrice)||0,
        stopPrice:num(pos.stopPrice)||0,takeProfitPrice:num(pos.takeProfitPrice)||0}:undefined,
      pending:!!state?.pending,manualReview:str(state?.manualReview),maxGross:sourceDeployed?1:undefined,
      riskPct:undefined,publicSignalEligible,publicReferenceTs,publicError:marketError,
      gates,note:!sourceDeployed?"現在のProduction releaseにHYPE/ZECソースがありません。GitHubの研究ブランチはLIVEではありません。":
        !stateAvailable?"実Runner stateが見つかりません。":!shaOk?"stateのSHAがProductionと一致しません。":
        !active?"HYPE/ZECの実行サービスを確認できません。":
        mode!=="LIVE"?"SHADOW/PAPERモードのため実注文は無効です。":
        "発火には公開足Gate以外にRisk・5x Cross・口座ロック・保護注文の実Runner判定が必要です。"};
  }
  return {ok:true,readOnly:true,tradingMutation:0,capturedAt,releaseSha,sourceDeployed,stateAvailable,
    serviceActive:active,sharedKillActive:killActive,sleeves:results};
}
