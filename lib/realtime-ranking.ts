export type Gate = { key:string; label:string; state:'OK'|'NO'|'UNKNOWN'; actual?:number|string; required?:number|string; detail:string; kind?:'signal'|'execution'; progress?:number };
export type RankScoreKind='NATIVE'|'MARKET'|'GATE_COMPLETION'|'UNAVAILABLE';
export type RankingSourceStatus='FRESH'|'STALE'|'SOURCE_ERROR'|'NOT_EVALUATED';
export type RankMetric={score:number|null;scoreKind:RankScoreKind;scoreLabel:string};
export type RankRow = {
 id:string; symbol:string; logic:string; side:string; score:number|null; scoreKind:RankScoreKind; scoreLabel:string;
 gates:Gate[]; reason:string; fresh:boolean; checkedAt:number; freshUntil?:number; rank?:number; href?:string;
 rankingScope?:string; sourceRank?:number; rankingEligible?:boolean; rankingContractAvailable?:boolean; rankingExclusion?:string;
 sourceStatus?:RankingSourceStatus; sourceRoute?:string; sourceFeatures?:Record<string,number|boolean>;
};
export type RealtimeTopSlot={slot:1|2|3;status:'CANDIDATE'|'NO_CANDIDATE'|'NOT_EVALUATED'|'STALE'|'SOURCE_ERROR';symbol?:string;sourceRow?:RankRow};
export function executionBlocked(row:RankRow){return row.gates.some(g=>g.kind==='execution'&&g.state==='NO');}
export const REALTIME_RANKING_REFRESH_MS=30_000;
export function nextRealtimeRankingAt(observedAt:number){return observedAt+REALTIME_RANKING_REFRESH_MS;}
const REALTIME_RANKING_SOURCE_MAX_AGE_MS:Record<string,number>={V12:3*3600000,V12_V4:3*3600000,Q102:2*3600000,PENGU:2*3600000,FET:110000,HYPE:20*60000,'Idle Long':2*3600000,'Idle Short':2*3600000,V52:2*3600000,MARKET:90_000};
export function realtimeRankingRowExpiry(row:RankRow){return row.checkedAt+(REALTIME_RANKING_SOURCE_MAX_AGE_MS[row.logic]??2*3600000);}
export function realtimeRankingCacheExpiry(observedAt:number,sourceExpiries:number[],rows:RankRow[]=[]){
 const deadlines=[observedAt+REALTIME_RANKING_REFRESH_MS,...sourceExpiries.filter(x=>Number.isFinite(x)&&x>observedAt),...rows.filter(r=>r.fresh).map(realtimeRankingRowExpiry)];
 return Math.min(...deadlines);
}
export function expireRealtimeRankingRows(rows:RankRow[],now:number,sourceExpiryByLogic:Record<string,number>={}){
 return rows.map(row=>{
  const cutoff=Math.min(realtimeRankingRowExpiry(row),sourceExpiryByLogic[row.logic]??Infinity);
  if(!row.fresh)return row;
  return now>=cutoff
   ?{...row,freshUntil:cutoff,fresh:false,score:null,scoreKind:'UNAVAILABLE' as const,rankingEligible:false,rank:undefined,sourceStatus:'STALE' as const,reason:'観測処理中に鮮度期限を超過 / '+row.reason}
   :{...row,freshUntil:cutoff};
 });
}
export function isRankableScore(score:number|null|undefined):score is number{return typeof score==='number'&&Number.isFinite(score)&&score>0;}
export function rankScoreDisplay(score:number|null|undefined,unavailable=false){return unavailable||typeof score!=='number'||!Number.isFinite(score)?'—':String(score);}
export function gateCompletionMetric(gates:Gate[],fresh:boolean):RankMetric{
 const score=gateScore(gates,fresh);
 return score===null
  ?{score:null,scoreKind:'UNAVAILABLE',scoreLabel:'Gate充足度 未取得'}
  :{score,scoreKind:'GATE_COMPLETION',scoreLabel:'Gate充足度（Signal Gate充足割合・発火確率ではありません）'};
}
export function nativeMetric(value:unknown,label:string,fresh:boolean):RankMetric{
 return fresh&&typeof value==='number'&&Number.isFinite(value)
  ?{score:value,scoreKind:'NATIVE',scoreLabel:label}
  :{score:null,scoreKind:'UNAVAILABLE',scoreLabel:label};
}
function hasCanonicalRank(row:RankRow):row is RankRow&{rankingScope:string;sourceRank:number}{
 return row.fresh&&row.rankingEligible===true&&row.rankingContractAvailable===true&&typeof row.rankingScope==='string'&&
  Number.isSafeInteger(row.sourceRank)&&Number(row.sourceRank)>0&&row.score!==0;
}
function sourceOrder(a:RankRow,b:RankRow){
 return Number(a.sourceRank)-Number(b.sourceRank)||(a.sourceRoute??'').localeCompare(b.sourceRoute??'')||a.id.localeCompare(b.id);
}
export function rankRows(rows:RankRow[]){
 // This is an observation inventory, not a shared score contest. Only a row
 // backed by its own fresh ranking contract receives its source-provided rank.
 return rows.map(row=>({...row,rank:hasCanonicalRank(row)?row.sourceRank:undefined}));
}
export function topRankedSymbols(rows:RankRow[],scope:string):RealtimeTopSlot[]{
 const scoped=rows.filter(row=>row.rankingScope===scope);
 const ranked=scoped.filter(hasCanonicalRank).sort(sourceOrder);
 const unique:RankRow[]=[];
 const seen=new Set<string>();
 for(const row of ranked){
  const symbol=row.symbol.trim().toUpperCase();
  if(!symbol||symbol==='—'||seen.has(symbol))continue;
  seen.add(symbol);unique.push(row);
 }
 const slots:RealtimeTopSlot[]=unique.slice(0,3).map((sourceRow,index)=>({slot:(index+1) as 1|2|3,status:'CANDIDATE',symbol:sourceRow.symbol,sourceRow}));
 let placeholder:RealtimeTopSlot['status']='NOT_EVALUATED';
 if(scoped.some(row=>row.sourceStatus==='SOURCE_ERROR'))placeholder='SOURCE_ERROR';
 else if(scoped.some(row=>row.fresh&&row.rankingContractAvailable===true))placeholder='NO_CANDIDATE';
 else if(scoped.some(row=>row.sourceStatus==='STALE'))placeholder='STALE';
 while(slots.length<3)slots.push({slot:(slots.length+1) as 1|2|3,status:placeholder});
 return slots;
}
export function topRankedCandidates(rows:RankRow[],limit=3){
 if(!Number.isInteger(limit)||limit<=0)return [];
 const scopes=[...new Set(rows.map(row=>row.rankingScope).filter((scope):scope is string=>!!scope))];
 if(scopes.length!==1)return [];
 return topRankedSymbols(rows,scopes[0]).filter(slot=>slot.status==='CANDIDATE'&&slot.sourceRow).slice(0,limit).map(slot=>slot.sourceRow!);
}
export function rankChanges(previous:string[],next:string[]){const result:Record<string,number>={};if(!previous.length)return result;next.forEach((id,i)=>{const old=previous.indexOf(id);if(old<0)result[id]=0;else if(old!==i)result[id]=old-i;});return result;}
export function gateScore(gates:Gate[],fresh:boolean){const signal=gates.filter(g=>g.kind!=='execution');if(!fresh||!signal.length||signal.some(g=>g.state==='UNKNOWN'))return null;const score=Math.round(100*signal.reduce((s,g)=>s+(g.state==='OK'?1:Math.max(0,Math.min(.99,g.progress??0))),0)/signal.length);return signal.every(g=>g.state==='OK')?100:Math.min(99,score);}
export const FET_POLICY={lookbackHours:48,volumeMedianHours:72,minimumVolumeRatio:1.2,decisionEntryHourModulo:4,decisionEntryHourRemainder:1,liveEntryWindowMs:300000};
export function freshTimestamp(at:unknown,now:number,maxAge:number){return typeof at==='number'&&Number.isFinite(at)&&at>0&&now-at>=-60000&&now-at<=maxAge;}
export function updateFetClock(gates:Gate[],now:number){const entry=now-now%3600000,open=new Date(entry).getUTCHours()%FET_POLICY.decisionEntryHourModulo===FET_POLICY.decisionEntryHourRemainder&&now-entry<=FET_POLICY.liveEntryWindowMs;return gates.map(g=>g.key==='clock'?{...g,state:open?'OK' as const:'NO' as const,actual:new Date(now).toISOString(),detail:'現在時刻で受付時間を再評価（市場条件は記載の観測時点）'}:g);}
export function fetObservationExpiry(at:number,ttl:number){const hour=Math.floor(at/3600000)*3600000,cutoff=hour+FET_POLICY.liveEntryWindowMs+1;return Math.min(at+ttl,hour+3600000,at<cutoff?cutoff:Infinity);}
export function currentFetGates(gates:Gate[],checkedAt:number,now:number){return updateFetClock(gates,now).map(g=>Math.floor(checkedAt/3600000)!==Math.floor(now/3600000)&&(g.kind!=='execution'||g.key==='data')?{...g,state:'UNKNOWN' as const,detail:'新しい確定足の観測更新待ち（前回値）'}:g);}
export function currentRankRow(row:RankRow,now:number):RankRow{
 const beforeSourceExpiry=row.freshUntil===undefined||now<row.freshUntil;
 const withinFetHour=row.logic!=='FET'||Math.floor(row.checkedAt/3600000)===Math.floor(now/3600000);
 const fresh=row.fresh&&beforeSourceExpiry&&withinFetHour;
 if(row.logic==='FET')return {...row,fresh,gates:currentFetGates(row.gates,row.checkedAt,now),score:fresh?row.score:null,scoreKind:fresh?row.scoreKind:'UNAVAILABLE' as const,rankingEligible:fresh&&row.rankingEligible===true,rank:fresh?row.rank:undefined,sourceStatus:fresh?row.sourceStatus:'STALE' as const,reason:fresh?row.reason:'新しい確定足の観測更新待ち'};
 if(fresh)return row;
 if(row.score!==null||row.rank!==undefined||row.fresh)return {...row,fresh:false,score:null,scoreKind:'UNAVAILABLE' as const,rankingEligible:false,rank:undefined,sourceStatus:'STALE' as const,reason:'観測鮮度期限切れ / '+row.reason};
 return row;
}
export function evaluateFet(raw:unknown,now:number,policy=FET_POLICY):{valid:boolean;gates:Gate[];referenceTs?:number}{
 const H=3600000,entry=now-now%H;
 const clock=new Date(entry).getUTCHours()%policy.decisionEntryHourModulo===policy.decisionEntryHourRemainder&&now-entry<=policy.liveEntryWindowMs;
 const gates:Gate[]=[{key:'clock',label:'新規受付時間',state:clock?'OK':'NO',actual:new Date(now).toISOString(),required:'UTC時刻 % '+policy.decisionEntryHourModulo+' = '+policy.decisionEntryHourRemainder+' / 最初の'+policy.liveEntryWindowMs/60000+'分',detail:'市場条件と別に判定する受付時間',kind:'execution'}];
 const rows=Array.isArray(raw)?raw.filter((r):r is unknown[]=>Array.isArray(r)).map(r=>({t:Number(r[0]),high:Number(r[2]),low:Number(r[3]),open:Number(r[1]),close:Number(r[4]),volume:Number(r[5]),end:Number(r[6])})).filter(r=>r.end<entry).sort((a,b)=>a.t-b.t):[];
 const n=Math.max(policy.lookbackHours,policy.volumeMedianHours)+1,used=rows.slice(-n);
 const valid=used.length===n&&used.every((r,i)=>Number.isFinite(r.t)&&r.t%H===0&&r.end===r.t+H-1&&[r.high,r.low,r.open,r.close,r.volume].every(Number.isFinite)&&r.low>0&&r.high>=Math.max(r.close,r.open)&&r.low<=Math.min(r.open,r.close)&&r.volume>=0&&(!i||r.t-used[i-1].t===H))&&used.at(-1)?.t===entry-H;
 gates.push({key:'data',label:'確定1時間足・連続性',state:valid?'OK':'UNKNOWN',actual:used.length,required:n,detail:valid?'未確定足を除外し、欠損・重複なし':'最新足・連続性・価格形式のいずれかが未確認',kind:'execution'});
 if(!valid){gates.push(...['breakout','volume'].map(key=>({key,label:key==='breakout'?'48時間高値更新':'出来高確認',state:'UNKNOWN' as const,detail:'有効な確定足が不足'})));return {valid:false,gates};}
 const last=used.at(-1)!,high=Math.max(...used.slice(-policy.lookbackHours-1,-1).map(r=>r.high));
 const volumes=used.slice(-policy.volumeMedianHours-1,-1).map(r=>r.volume).sort((a,b)=>a-b),m=Math.floor(volumes.length/2),median=volumes.length%2?volumes[m]:(volumes[m-1]+volumes[m])/2,ratio=median>0?last.volume/median:0;
 gates.push({key:'breakout',label:'48時間高値更新',state:last.close>high?'OK':'NO',actual:last.close,required:'終値 > '+high,detail:'高値まで '+Math.max(0,(high/last.close-1)*100).toFixed(3)+'%（同値はNO）。接近度は高値から5%下を0として計算',progress:Math.min(.99,Math.max(0,1-Math.max(0,high/last.close-1)/.05))});
 gates.push({key:'volume',label:'出来高 / 72時間中央値',state:ratio+1e-12>=policy.minimumVolumeRatio?'OK':'NO',actual:ratio,required:policy.minimumVolumeRatio,detail:'直前72本中央値 '+median.toFixed(2)+' / 確定足 '+last.volume.toFixed(2),progress:ratio/policy.minimumVolumeRatio});
 return {valid:true,gates,referenceTs:last.end};
}
