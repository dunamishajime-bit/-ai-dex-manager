export type Gate = { key:string; label:string; state:'OK'|'NO'|'UNKNOWN'; actual?:number|string; required?:number|string; detail:string; kind?:'signal'|'execution'|'reference'|'shadow'; progress?:number };
export type RankRow = { id:string; symbol:string; logic:string; side:string; score:number|null; gates:Gate[]; reason:string; fresh:boolean; checkedAt:number; rank?:number; href?:string };
export function executionBlocked(row:RankRow){return row.gates.some(g=>g.kind==='execution'&&g.state==='NO');}
export function rankRows(rows:RankRow[]){const tier=(r:RankRow)=>r.score===null?0:executionBlocked(r)?1:2;return [...rows].sort((a,b)=>tier(b)-tier(a)||(b.score??-1)-(a.score??-1)||a.id.localeCompare(b.id)).map((r,i)=>({...r,rank:r.score===null?undefined:i+1}));}
export function rankChanges(previous:string[],next:string[]){const result:Record<string,number>={};if(!previous.length)return result;next.forEach((id,i)=>{const old=previous.indexOf(id);if(old<0)result[id]=0;else if(old!==i)result[id]=old-i;});return result;}
export type RankingPcAlert={title:string;body:string;reason:'TOP_SCORE'|'TOP3_ENTRY'|'BOTH'};
export function rankingPcAlert(previous:RankRow[],next:RankRow[]):RankingPcAlert|null{
 if(!previous.length)return null;
 const before=rankRows(previous).filter(r=>r.score!==null),after=rankRows(next).filter(r=>r.score!==null);
 if(!after.length)return null;
 const beforeIds=before.map(r=>r.id),afterIds=after.map(r=>r.id);
 const rankingChanged=beforeIds.length!==afterIds.length||beforeIds.some((id,i)=>afterIds[i]!==id);
 const top=after[0],highTop=rankingChanged&&top.score!==null&&top.score>=90;
 const oldPos=new Map(before.map((r,i)=>[r.id,i+1]));
 const entrants=after.slice(0,3).flatMap((r,i)=>{const from=oldPos.get(r.id);return from&&from>3?[{row:r,from,to:i+1}]:[];});
 if(!highTop&&!entrants.length)return null;
 const parts:string[]=[];
 if(highTop)parts.push('1位 '+top.symbol.replace(/USDT$/,'')+' / '+top.logic+' Score '+top.score);
 if(entrants.length)parts.push(entrants.map(e=>e.row.symbol.replace(/USDT$/,'')+' / '+e.row.logic+' '+e.from+'位→'+e.to+'位').join('、'));
 return {title:entrants.length?'Top3入りを検知':'1位がScore 90以上',body:parts.join('。')+'。',reason:highTop&&entrants.length?'BOTH':entrants.length?'TOP3_ENTRY':'TOP_SCORE'};
}
export function gateScore(gates:Gate[],fresh:boolean){
 const required=gates.filter(g=>g.kind!=='reference'&&g.kind!=='shadow'),signal=required.filter(g=>g.kind!=='execution');
 if(!fresh||!signal.length||signal.some(g=>g.state==='UNKNOWN'))return null;
 const score=Math.round(100*required.reduce((sum,g)=>sum+(g.state==='OK'?1:g.kind==='execution'||g.state==='UNKNOWN'?0:Math.max(0,Math.min(.99,g.progress??0))),0)/required.length);
 return required.every(g=>g.state==='OK')?100:Math.min(99,score);
}
export const FET_POLICY={lookbackHours:48,volumeMedianHours:72,minimumVolumeRatio:1.2,minimumReturn72h:.02,decisionEntryHourModulo:4,decisionEntryHourRemainder:1,liveEntryWindowMs:300000};
export function freshTimestamp(at:unknown,now:number,maxAge:number){return typeof at==='number'&&Number.isFinite(at)&&at>0&&now-at>=-60000&&now-at<=maxAge;}
export function updateFetClock(gates:Gate[],now:number){const entry=now-now%3600000,open=new Date(entry).getUTCHours()%FET_POLICY.decisionEntryHourModulo===FET_POLICY.decisionEntryHourRemainder&&now-entry<=FET_POLICY.liveEntryWindowMs;return gates.map(g=>g.key==='clock'?{...g,state:open?'OK' as const:'NO' as const,actual:new Date(now).toISOString(),detail:'現在時刻で受付時間を再評価（市場条件は記載の観測時点）'}:g);}
export function fetObservationExpiry(at:number,ttl:number){const hour=Math.floor(at/3600000)*3600000,cutoff=hour+FET_POLICY.liveEntryWindowMs+1;return Math.min(at+ttl,hour+3600000,at<cutoff?cutoff:Infinity);}
export function currentFetGates(gates:Gate[],checkedAt:number,now:number){return updateFetClock(gates,now).map(g=>Math.floor(checkedAt/3600000)!==Math.floor(now/3600000)&&(g.kind!=='execution'||g.key==='data')?{...g,state:'UNKNOWN' as const,detail:'新しい確定足の観測更新待ち（前回値）'}:g);}
export function currentRankRow(row:RankRow,now:number):RankRow{
 if(row.logic!=='FET')return row.gates.length?{...row,score:gateScore(row.gates,row.fresh)}:row;
 const fresh=row.fresh&&Math.floor(row.checkedAt/3600000)===Math.floor(now/3600000),gates=currentFetGates(row.gates,row.checkedAt,now);
 return {...row,fresh,gates,score:gateScore(gates,fresh),rank:fresh?row.rank:undefined,reason:fresh?row.reason:'新しい確定足の観測更新待ち'};
}
export function evaluateFet(raw:unknown,now:number,policy=FET_POLICY):{valid:boolean;gates:Gate[];referenceTs?:number}{
 const H=3600000,entry=now-now%H;
 const clock=new Date(entry).getUTCHours()%policy.decisionEntryHourModulo===policy.decisionEntryHourRemainder&&now-entry<=policy.liveEntryWindowMs;
 const gates:Gate[]=[{key:'clock',label:'新規受付時間',state:clock?'OK':'NO',actual:new Date(now).toISOString(),required:'UTC時刻 % '+policy.decisionEntryHourModulo+' = '+policy.decisionEntryHourRemainder+' / 最初の'+policy.liveEntryWindowMs/60000+'分',detail:'市場条件と別に判定する受付時間',kind:'execution'}];
 const rows=Array.isArray(raw)?raw.filter((r):r is unknown[]=>Array.isArray(r)).map(r=>({t:Number(r[0]),high:Number(r[2]),low:Number(r[3]),open:Number(r[1]),close:Number(r[4]),volume:Number(r[5]),end:Number(r[6])})).filter(r=>r.end<entry).sort((a,b)=>a.t-b.t):[];
 const n=Math.max(policy.lookbackHours,policy.volumeMedianHours)+1,used=rows.slice(-n);
 const valid=used.length===n&&used.every((r,i)=>Number.isFinite(r.t)&&r.t%H===0&&r.end===r.t+H-1&&[r.high,r.low,r.open,r.close,r.volume].every(Number.isFinite)&&r.low>0&&r.high>=Math.max(r.close,r.open)&&r.low<=Math.min(r.open,r.close)&&r.volume>=0&&(!i||r.t-used[i-1].t===H))&&used.at(-1)?.t===entry-H;
 gates.push({key:'data',label:'確定1時間足・連続性',state:valid?'OK':'UNKNOWN',actual:used.length,required:n,detail:valid?'未確定足を除外し、欠損・重複なし':'最新足・連続性・価格形式のいずれかが未確認',kind:'execution'});
 if(!valid){gates.push(...['breakout','volume','return72h'].map(key=>({key,label:key==='breakout'?'48時間高値更新':key==='volume'?'出来高確認':'72h return ≥ +2%',state:'UNKNOWN' as const,detail:'有効な確定足が不足'})));return {valid:false,gates};}
 const last=used.at(-1)!,high=Math.max(...used.slice(-policy.lookbackHours-1,-1).map(r=>r.high));
 const volumes=used.slice(-policy.volumeMedianHours-1,-1).map(r=>r.volume).sort((a,b)=>a-b),m=Math.floor(volumes.length/2),median=volumes.length%2?volumes[m]:(volumes[m-1]+volumes[m])/2,ratio=median>0?last.volume/median:0;
 gates.push({key:'breakout',label:'48時間高値更新',state:last.close>high?'OK':'NO',actual:last.close,required:'終値 > '+high,detail:'高値まで '+Math.max(0,(high/last.close-1)*100).toFixed(3)+'%（同値はNO）。接近度は高値から5%下を0として計算',progress:Math.min(.99,Math.max(0,1-Math.max(0,high/last.close-1)/.05))});
 gates.push({key:'volume',label:'出来高 / 72時間中央値',state:ratio+1e-12>=policy.minimumVolumeRatio?'OK':'NO',actual:ratio,required:policy.minimumVolumeRatio,detail:'直前72本中央値 '+median.toFixed(2)+' / 確定足 '+last.volume.toFixed(2),progress:ratio/policy.minimumVolumeRatio});
 const ret72=last.close/used[0].close-1;
 gates.push({key:'return72h',label:'72h return ≥ +2%',state:ret72+1e-12>=policy.minimumReturn72h?'OK':'NO',actual:ret72*100,required:policy.minimumReturn72h*100+'%',detail:'確定closeから72h前の確定closeのみ使用 / '+(ret72*100).toFixed(3)+'%',progress:ret72/policy.minimumReturn72h});
 return {valid:true,gates,referenceTs:last.end};
}

export function hypeRankingFresh(row:{status:string;stateSha?:string;lastDecision?:{at?:number}},releaseSha:string,now:number){
 return row.status==='LIVE'&&row.stateSha===releaseSha&&freshTimestamp(row.lastDecision?.at,now,3*3600000);
}

export type RiseEvent={row:RankRow;from:number;to:number;delta:number};
export function risingRankEvents(previous:RankRow[],next:RankRow[]):RiseEvent[]{
 if(!previous.length)return [];
 const before=rankRows(previous).filter(r=>r.score!==null),after=rankRows(next).filter(r=>r.score!==null);
 const positions=new Map(before.map((r,i)=>[r.id,{row:r,position:i+1}]));
 return after.flatMap((row,i)=>{const old=positions.get(row.id);return old&&old.row.fresh&&row.fresh&&old.position>i+1?[{row,from:old.position,to:i+1,delta:old.position-i-1}]:[];}).sort((a,b)=>b.delta-a.delta||a.to-b.to);
}
const displayGateNumber=(n:number)=>Number(n.toFixed(4)).toString();
function commentaryGate(g:Gate){
 let detail=g.label+'：'+(g.state==='UNKNOWN'?'未確認。':'');
 if(g.actual!==undefined)detail+='現在 '+(typeof g.actual==='number'?displayGateNumber(g.actual):g.actual)+' / ';
 if(g.required!==undefined)detail+='基準 '+g.required+'。';
 // Only an explicit inclusive lower bound (or the documented volume ratio)
 // proves that subtraction is a meaningful deficit.
 const match=typeof g.required==='string'?g.required.match(/^\s*(?:≥|>=)\s*(-?\d+(?:\.\d+)?)(%)?\s*$/):null;
 const minimum=match?Number(match[1]):g.key==='volume'&&typeof g.required==='number'?g.required:undefined;
 if(g.state==='NO'&&typeof g.actual==='number'&&Number.isFinite(g.actual)&&minimum!==undefined&&minimum>g.actual)detail+='あと'+displayGateNumber(minimum-g.actual)+(match?.[2]?'ポイント':'')+'。';
 return detail+(g.detail||'');
}
function naturalSpeechGate(g:Gate){
 if(g.state==='UNKNOWN')return g.label+'は、まだ確認できていません。';
 const actual=g.actual!==undefined?(typeof g.actual==='number'?displayGateNumber(g.actual):String(g.actual)):'';
 const required=g.required!==undefined?String(g.required):'';
 const match=typeof g.required==='string'?g.required.match(/^\s*(?:≥|>=)\s*(-?\d+(?:\.\d+)?)(%)?\s*$/):null;
 const minimum=match?Number(match[1]):g.key==='volume'&&typeof g.required==='number'?g.required:undefined;
 if(g.state==='NO'&&typeof g.actual==='number'&&Number.isFinite(g.actual)&&minimum!==undefined&&minimum>g.actual){
  const gap=displayGateNumber(minimum-g.actual)+(match?.[2]?'ポイント':'');
  return g.label+'は現在'+actual+'です。基準は'+required+'で、あと'+gap+'です。';
 }
 if(actual&&required)return g.label+'は現在'+actual+'、基準は'+required+'です。';
 return g.label+'が未達です。';
}
export function rankCommentary(row:RankRow,from?:number,to?:number){
 const symbol=row.symbol.replace(/USDT$/,'');
 const name=symbol+' / '+row.logic;
 const headline=from!==undefined&&to!==undefined?name+'が'+from+'位から'+to+'位へ上昇（↑'+(from-to)+'）':name+'の判定状況';
 const signalGates=row.gates.filter(g=>g.kind!=='execution'&&g.kind!=='shadow'&&g.state!=='OK'),executionGates=row.gates.filter(g=>g.kind==='execution'&&g.state==='NO');
 const signal=!row.fresh||row.score===null?'観測更新待ち。現在の条件充足は未確認です。':signalGates.length?signalGates.map(commentaryGate).join(' / '):'市場条件は通過。実Runnerの最終確認が必要です。';
 const execution=executionGates.length?'発注制約：'+executionGates.map(commentaryGate).join(' / '):'発注制約：確認済みの停止条件なし。余力・競合・実発注はRunner確認待ち。';
 let speech=from!==undefined&&to!==undefined
  ? symbol+'、'+row.logic+'が、'+from+'位から'+to+'位まで上昇しました。'
  : symbol+'、'+row.logic+'の現在の判定です。';
 if(!row.fresh||row.score===null)speech+='最新の観測を待っています。';
 else if(signalGates.length)speech+=naturalSpeechGate(signalGates[0]);
 else speech+='市場条件は通過しています。Runnerの最終判定を待っています。';
 if(executionGates.length)speech+='ただし、'+executionGates.map(g=>g.label).join('、')+'の制約があるため、現時点では発注待機です。';
 return {headline,signal,execution,speech};
}
