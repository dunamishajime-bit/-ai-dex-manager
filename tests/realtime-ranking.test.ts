import { test } from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import { currentRankRow, fetObservationExpiry, evaluateFet, freshTimestamp, updateFetClock, gateScore, rankRows, rankChanges, type RankRow } from '../lib/realtime-ranking';
const H = 3600000;
const now = Date.UTC(2026,9,4,13,2);
function bars(close=101,volume=120){return Array.from({length:73},(_,i)=>[now-now%H-(73-i)*H,100,i===72?Math.max(100,close):100,99,i===72?close:100,i===72?volume:100,now-now%H-(72-i)*H-1]);}
test('FET strict breakout and inclusive volume boundary',()=>{
 assert.equal(evaluateFet(bars(100),now).gates.find(g=>g.key==='breakout')?.state,'NO');
 assert.equal(evaluateFet(bars(),now).gates.find(g=>g.key==='volume')?.state,'OK');
 assert.equal(evaluateFet(bars(101,119),now).gates.find(g=>g.key==='volume')?.state,'NO');
});
test('FET completed bars only and gaps fail closed',()=>{
 const b=bars(); b.push([now-now%H,100,999,1,999,999,now-now%H+H-1]);
 assert.equal(evaluateFet(b,now).gates.find(g=>g.key==='breakout')?.actual,101);
 assert.equal(evaluateFet(bars().slice(1),now).valid,false);
 const d=bars();d[1]=d[0];assert.equal(evaluateFet(d,now).valid,false);
});
test('FET entry clock is independent of technical signal',()=>{
 assert.equal(evaluateFet(bars(),now).gates.find(g=>g.key==='clock')?.state,'OK');
 assert.equal(evaluateFet(bars(),now+6*60000).gates.find(g=>g.key==='clock')?.state,'NO');
});
const row=(id:string,score:number|null):RankRow=>({id,symbol:id,logic:'X',side:'LONG',score,gates:[],reason:'',fresh:score!==null,checkedAt:now});
test('unknown scores last and ties stable',()=>{
 assert.deepEqual(rankRows([row('z',null),row('b',80),row('a',80)]).map(r=>r.id),['a','b','z']);
});
test('zero-score rows stay visible but are not assigned a rank or promoted above positive scores',()=>{
 const blocked={...row('blocked-high',90),gates:[{key:'held',label:'held',state:'NO' as const,detail:'',kind:'execution' as const}]};
 const ranked=rankRows([row('zero',0),blocked,row('candidate',25),row('unknown',null)]);
 assert.deepEqual(ranked.map(r=>r.id),['candidate','blocked-high','zero','unknown']);
 assert.deepEqual(ranked.map(r=>r.rank),[1,2,undefined,undefined]);
 assert.equal(ranked[2].score,0);
 assert.equal(ranked[2].rank,undefined);
});
test('display keeps a numeric score visible when the row has no ranking eligibility',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {rankScoreDisplay?:(score:number|null|undefined,unavailable?:boolean)=>string};
 assert.equal(typeof mod.rankScoreDisplay,'function');
 const unranked=rankRows([row('zero',0)])[0];
 assert.equal(unranked.rank,undefined);
 assert.equal(mod.rankScoreDisplay!(unranked.score),'0');
 assert.equal(mod.rankScoreDisplay!(null),'—');
 assert.equal(mod.rankScoreDisplay!(0,true),'—');
});
test('top candidates omit zero-score and execution-blocked rows',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {topRankedCandidates?: (rows:RankRow[],limit?:number)=>RankRow[]};
 assert.equal(typeof mod.topRankedCandidates,'function');
 assert.deepEqual(mod.topRankedCandidates!([row('zero',0),row('candidate',1),{...row('blocked',100),gates:[{key:'held',label:'held',state:'NO',detail:'',kind:'execution'}]}]).map(r=>r.id),['candidate']);
});
test('ranking refresh is scheduled 30 seconds after an observation completes',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {nextRealtimeRankingAt?: (now:number)=>number;realtimeRankingCacheExpiry?:(now:number,sourceExpiries:number[])=>number};
 assert.equal(typeof mod.nextRealtimeRankingAt,'function');
 assert.equal(mod.nextRealtimeRankingAt!(1_000),31_000);
 assert.equal(mod.realtimeRankingCacheExpiry!(1_000,[120_000]),31_000);
 assert.equal(mod.realtimeRankingCacheExpiry!(1_000,[20_000]),20_000);
});
test('near-expiry V12 observations shorten the server cache below 30 seconds',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {realtimeRankingRowExpiry?:(row:RankRow)=>number;realtimeRankingCacheExpiry?:(now:number,sourceExpiries:number[],rows?:RankRow[])=>number};
 const observedAt=Date.UTC(2026,9,4,13,2),nearExpiry=row('V12:BTC:LONG',80);
 nearExpiry.logic='V12';nearExpiry.checkedAt=observedAt-3*H+10_000;
 assert.equal(typeof mod.realtimeRankingRowExpiry,'function');
 assert.equal(mod.realtimeRankingRowExpiry!(nearExpiry),observedAt+10_000);
 assert.equal(mod.realtimeRankingCacheExpiry!(observedAt,[],[nearExpiry]),observedAt+10_000);
});
test('already-expired source deadlines do not disable the normal cache for unknown rows',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {realtimeRankingCacheExpiry?:(now:number,sourceExpiries:number[],rows?:RankRow[])=>number};
 assert.equal(mod.realtimeRankingCacheExpiry!(10_000,[9_000],[]),40_000);
});
test('FET server cache also ends at the entry-window and hour freshness boundary',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {realtimeRankingCacheExpiry?:(now:number,sourceExpiries:number[],rows?:RankRow[])=>number;fetObservationExpiry?:(at:number,ttl:number)=>number};
 const hour=Date.UTC(2026,9,4,13),observedAt=hour+4*60_000+55_000,fetCheckedAt=hour+4*60_000+53_000,fet=row('FETUSDT',70);
 fet.logic='FET';fet.checkedAt=fetCheckedAt;
 const sourceExpiry=mod.fetObservationExpiry!(fetCheckedAt,110_000);
 assert.equal(mod.realtimeRankingCacheExpiry!(observedAt,[sourceExpiry],[fet]),hour+5*60_000+1);
});
test('a source freshness deadline crossed during observation removes its cached score',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {expireRealtimeRankingRows?:(rows:RankRow[],now:number,sourceExpiryByLogic?:Record<string,number>)=>RankRow[]};
 const observed=row('V12:BTC:LONG',75);observed.logic='V12';observed.checkedAt=now;
 assert.equal(typeof mod.expireRealtimeRankingRows,'function');
 const result=mod.expireRealtimeRankingRows!([observed],now+101,{'V12':now+100});
 assert.equal(result[0].fresh,false);assert.equal(result[0].score,null);assert.equal(result[0].rank,undefined);
});
test('a positive non-FET score expires in the browser at its exact freshness deadline',()=>{
 const observed=row('V12:BTC:LONG',75);observed.logic='V12';observed.freshUntil=now+100;
 const live=currentRankRow(observed,now+99),expired=currentRankRow(observed,now+100);
 assert.equal(live.score,75);assert.equal(live.fresh,true);
 assert.equal(expired.score,null);assert.equal(expired.fresh,false);assert.equal(expired.rank,undefined);
});
test('zero score remains displayed until its source deadline then becomes unknown without a rank',()=>{
 const observed=row('Q102:BTC:LONG',0);observed.logic='Q102';observed.freshUntil=now+100;
 assert.equal(currentRankRow(observed,now+99).score,0);
 const expired=currentRankRow(observed,now+100);
 assert.equal(expired.score,null);assert.equal(expired.fresh,false);assert.equal(expired.rank,undefined);
});
test('zero-score rows do not create movement phases or sound events',async()=>{
 const mod=await import('../lib/ranking-motion-groups').catch(()=>null) as null|{createRankingMovementPhases:(before:unknown[],after:unknown[])=>unknown[]};
 assert.ok(mod);
 assert.deepEqual(mod.createRankingMovementPhases([{id:'zero',rank:1,score:0}],[{id:'zero',rank:undefined,score:0}]),[]);
});
test('positive score movement is grouped into a bounded rise animation',async()=>{
 const mod=await import('../lib/ranking-motion-groups').catch(()=>null) as null|{createRankingMovementPhases:(before:unknown[],after:unknown[])=>Array<{role:string;durationMs:number;changes:Array<{id:string}>}>};
 assert.ok(mod);
 assert.deepEqual(mod.createRankingMovementPhases([{id:'a',rank:5,score:70}],[{id:'a',rank:2,score:80}]),[{role:'top3',durationMs:1900,changes:[{id:'a',from:5,to:2,role:'top3'}]}]);
});
test('ranking sounds are separately selectable for rise, fall, and top three',async()=>{
 const mod=await import('../lib/ranking-sounds').catch(()=>null) as null|typeof import('../lib/ranking-sounds');
 assert.ok(mod);
 assert.equal(mod.rankingSoundsForRole('rise').length,5);
 assert.equal(mod.rankingSoundsForRole('fall').length,5);
 assert.equal(mod.rankingSoundsForRole('top3').length,5);
 assert.deepEqual(mod.loadRankingSoundSelections({rise:'rise-silver',fall:'fall-arc',top3:'invalid'},undefined),{rise:'rise-silver',fall:'fall-arc',top3:'top3-royal'});
});
test('closed audio contexts are recreated after effect cleanup and can be reused after suspension',async()=>{
 const mod=await import('../lib/ranking-sounds') as typeof import('../lib/ranking-sounds') & {canReuseRankingAudioContext?:(context:{state:string}|null|undefined)=>boolean};
 assert.equal(typeof mod.canReuseRankingAudioContext,'function');
 assert.equal(mod.canReuseRankingAudioContext!({state:'closed'}),false);
 assert.equal(mod.canReuseRankingAudioContext!({state:'suspended'}),true);
 assert.equal(mod.canReuseRankingAudioContext!(null),false);
});
test('all selected ranking sound recordings are packaged as public assets',async()=>{
 const mod=await import('../lib/ranking-sounds');
 for(const sound of mod.RANKING_SOUNDS){const file=join(process.cwd(),'public',sound.src.replace(/^\//,''));assert.equal(existsSync(file),true,sound.src);assert.ok(statSync(file).size>1_000,sound.src);}
});
test('known execution blocks rank behind available candidates despite higher signal score',()=>{
 const blocked={...row('held',100),gates:[{key:'holding',label:'holding',state:'NO' as const,detail:'',kind:'execution' as const}]};
 assert.deepEqual(rankRows([blocked,row('candidate',30),row('unknown',null)]).map(r=>r.id),['candidate','held','unknown']);
});
test('initial and unchanged rankings do not flash; only movement flashes',()=>{
 assert.deepEqual(rankChanges([],['a','b']),{});
 assert.deepEqual(rankChanges(['a','b'],['a','b']),{});
 assert.deepEqual(rankChanges(['a','b'],['b','a']),{b:1,a:-1});
 assert.deepEqual(rankChanges(['a'],['a','b']),{b:0});
});
test('unknown signal data and stale snapshots have no rankable score',()=>{
 assert.equal(gateScore([{key:'x',label:'x',state:'UNKNOWN',detail:''}],true),null);
 assert.equal(gateScore([{key:'x',label:'x',state:'OK',detail:''}],false),null);
 assert.equal(gateScore([{key:'x',label:'x',state:'OK',detail:''},{key:'account',label:'account',state:'UNKNOWN',detail:'',kind:'execution'}],true),100);
 assert.equal(gateScore([{key:'x',label:'x',state:'NO',progress:.99,detail:''},{key:'y',label:'y',state:'OK',detail:''}],true),99);
});
test('FET five-minute clock boundary and last completed bar freshness',()=>{
 const hour=now-now%H;
 assert.equal(evaluateFet(bars(),hour+300000).gates[0].state,'OK');
 assert.equal(evaluateFet(bars(),hour+300001).gates[0].state,'NO');
 assert.equal(evaluateFet(bars(),now+H).valid,false);
});
test('source freshness rejects future and old market data independently of heartbeat',()=>{
 assert.equal(freshTimestamp(now,now,2*H),true);
 assert.equal(freshTimestamp(now+60001,now,2*H),false);
 assert.equal(freshTimestamp(now-2*H-1,now,2*H),false);
 assert.equal(freshTimestamp(undefined,now,2*H),false);
});
test('client clock expires a previously passing cached gate at cutoff',()=>{
 const gates=evaluateFet(bars(),now).gates;
 assert.equal(updateFetClock(gates,now-now%H+300001)[0].state,'NO');
});
test('hour crossing expires FET market evidence and cache begun before boundary',()=>{
 const before=now-now%H+H-1000,after=before+5000;
 assert.equal(fetObservationExpiry(before,60000),now-now%H+H);
 const old={...row('FET',100),logic:'FET',checkedAt:before,gates:evaluateFet(bars(),now).gates};
 const current=currentRankRow(old,after);
 assert.equal(current.fresh,false);assert.equal(current.score,null);
 assert.equal(current.gates.find(g=>g.key==='breakout')?.state,'UNKNOWN');
});
