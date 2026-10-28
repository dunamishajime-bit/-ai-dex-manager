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
type TestRankRow=RankRow & {scoreKind:'NATIVE'|'GATE_COMPLETION'|'UNAVAILABLE';scoreLabel:string;rankingScope?:string;sourceRank?:number;rankingEligible?:boolean;rankingContractAvailable?:boolean};
const row=(id:string,score:number|null,sourceRank?:number):TestRankRow=>({id,symbol:id,logic:'X',side:'LONG',score,scoreKind:score===null?'UNAVAILABLE':'NATIVE',scoreLabel:'Test native score',gates:[],reason:'',fresh:true,checkedAt:now,rankingScope:'X',sourceRank,rankingEligible:sourceRank!==undefined&&score!==0,rankingContractAvailable:sourceRank!==undefined});
test('rows without a canonical rank do not gain synthetic ranks from incomparable scores',()=>{
 const ranked=rankRows([row('z',null),row('b',80),row('a',80)]);
 assert.deepEqual(ranked.map(r=>r.id),['z','b','a']);
 assert.deepEqual(ranked.map(r=>r.rank),[undefined,undefined,undefined]);
});
test('zero-score rows stay visible but do not receive a synthetic rank',()=>{
 const blocked={...row('blocked-high',90),gates:[{key:'held',label:'held',state:'NO' as const,detail:'',kind:'execution' as const}]};
 const ranked=rankRows([row('zero',0),blocked,row('candidate',25),row('unknown',null)]);
 assert.deepEqual(ranked.map(r=>r.id),['zero','blocked-high','candidate','unknown']);
 assert.deepEqual(ranked.map(r=>r.rank),[undefined,undefined,undefined,undefined]);
 assert.equal(ranked[0].score,0);
 assert.equal(ranked[0].rank,undefined);
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
test('top candidates use canonical source rank and keep execution-blocked observations visible',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {topRankedCandidates?: (rows:RankRow[],limit?:number)=>RankRow[]};
 assert.equal(typeof mod.topRankedCandidates,'function');
 const blocked={...row('blocked',100,2),gates:[{key:'held',label:'held',state:'NO' as const,detail:'',kind:'execution' as const}]};
 assert.deepEqual(mod.topRankedCandidates!([row('zero',0,3),row('candidate',1,1),blocked]).map(r=>r.id),['candidate','blocked']);
});

test('metric metadata distinguishes native score, gate completion, missing data, numeric zero, and stale data',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {gateCompletionMetric?:(gates:unknown[],fresh:boolean)=>{score:number|null;scoreKind:string;scoreLabel:string};nativeMetric?:(score:unknown,label:string,fresh:boolean)=>{score:number|null;scoreKind:string;scoreLabel:string}};
 assert.equal(typeof mod.gateCompletionMetric,'function');
 assert.equal(typeof mod.nativeMetric,'function');
 const zero=mod.gateCompletionMetric!([{key:'signal',label:'signal',state:'NO',detail:''}],true);
 assert.deepEqual([zero.score,zero.scoreKind], [0,'GATE_COMPLETION']);
 assert.match(zero.scoreLabel,/Gate充足度/);
 const missing=mod.gateCompletionMetric!([{key:'signal',label:'signal',state:'UNKNOWN',detail:''}],true);
 assert.deepEqual([missing.score,missing.scoreKind],[null,'UNAVAILABLE']);
 const native=mod.nativeMetric!(42,'Q102 proximity model units',true);
 assert.deepEqual([native.score,native.scoreKind,native.scoreLabel],[42,'NATIVE','Q102 proximity model units']);
 const nativeZero=mod.nativeMetric!(0,'Q102 proximity model units',true);
 assert.deepEqual([nativeZero.score,nativeZero.scoreKind],[0,'NATIVE']);
 const stale=mod.nativeMetric!(42,'Q102 proximity model units',false);
 assert.deepEqual([stale.score,stale.scoreKind],[null,'UNAVAILABLE']);
});

test('scoped top-three uses canonical source rank, deduplicates symbols, keeps blocked rows, and returns three slots',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {topRankedSymbols?:(rows:RankRow[],scope:string)=>Array<{slot:number;status:string;symbol?:string;sourceRow?:RankRow}>};
 assert.equal(typeof mod.topRankedSymbols,'function');
 const blocked={...row('eth-route-z',90,1),symbol:'ETHUSDT',sourceRank:1,rankingScope:'Q102',gates:[{key:'margin',label:'margin',state:'NO' as const,detail:'blocked',kind:'execution' as const}]};
 const duplicate={...row('eth-route-a',80,2),symbol:'ETHUSDT',sourceRank:2,rankingScope:'Q102'};
 const btc={...row('btc',70,3),symbol:'BTCUSDT',sourceRank:3,rankingScope:'Q102'};
 const otherScope={...row('other',100,1),symbol:'OTHERUSDT',sourceRank:1,rankingScope:'PENGU'};
 const slots=mod.topRankedSymbols!([otherScope,btc,duplicate,blocked],'Q102');
 assert.equal(slots.length,3);
 assert.deepEqual(slots.map(slot=>slot.status),['CANDIDATE','CANDIDATE','NO_CANDIDATE']);
 assert.deepEqual(slots.map(slot=>slot.symbol),['ETHUSDT','BTCUSDT',undefined]);
 assert.equal(slots[0].sourceRow?.id,'eth-route-z');
 assert.equal(slots[0].sourceRow?.gates.some(g=>g.kind==='execution'&&g.state==='NO'),true);
});

test('scoped top-three uses deterministic route/id tie-breaks and fills one-candidate placeholders',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {topRankedSymbols?:(rows:RankRow[],scope:string)=>Array<{status:string;symbol?:string;sourceRow?:RankRow}>};
 assert.equal(typeof mod.topRankedSymbols,'function');
 const routeZ={...row('same-z',80,1),symbol:'AAAUSDT',rankingScope:'Q102',sourceRoute:'Z_ROUTE'};
 const routeA={...row('same-a',70,1),symbol:'AAAUSDT',rankingScope:'Q102',sourceRoute:'A_ROUTE'};
 const second={...row('second',10,2),symbol:'BBBUSDT',rankingScope:'Q102'};
 const slots=mod.topRankedSymbols!([routeZ,second,routeA],'Q102');
 assert.deepEqual(slots.map(slot=>slot.status),['CANDIDATE','CANDIDATE','NO_CANDIDATE']);
 assert.deepEqual(slots.map(slot=>slot.symbol),['AAAUSDT','BBBUSDT',undefined]);
 assert.equal(slots[0].sourceRow?.id,'same-a');
 assert.deepEqual(mod.topRankedSymbols!([routeA],'Q102').map(slot=>slot.status),['CANDIDATE','NO_CANDIDATE','NO_CANDIDATE']);
});

test('scoped top-three returns NOT_EVALUATED, STALE, and SOURCE_ERROR placeholders without cross-scope promotion',async()=>{
 const mod=await import('../lib/realtime-ranking') as typeof import('../lib/realtime-ranking') & {topRankedSymbols?:(rows:RankRow[],scope:string)=>Array<{status:string}>};
 assert.equal(typeof mod.topRankedSymbols,'function');
 assert.deepEqual(mod.topRankedSymbols!([],'V12_V4').map(slot=>slot.status),['NOT_EVALUATED','NOT_EVALUATED','NOT_EVALUATED']);
 const stale={...row('stale',90,1),rankingScope:'V12_V4',rankingEligible:false,fresh:false,sourceStatus:'STALE' as const};
 assert.deepEqual(mod.topRankedSymbols!([stale],'V12_V4').map(slot=>slot.status),['STALE','STALE','STALE']);
 const failed={...stale,sourceStatus:'SOURCE_ERROR' as const};
 assert.deepEqual(mod.topRankedSymbols!([failed],'V12_V4').map(slot=>slot.status),['SOURCE_ERROR','SOURCE_ERROR','SOURCE_ERROR']);
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
 assert.equal(result[0].fresh,false);assert.equal(result[0].score,null);assert.equal(result[0].scoreKind,'UNAVAILABLE');assert.equal(result[0].rankingEligible,false);assert.equal(result[0].rank,undefined);
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
 assert.equal(expired.score,null);assert.equal(expired.scoreKind,'UNAVAILABLE');assert.equal(expired.rankingEligible,false);assert.equal(expired.fresh,false);assert.equal(expired.rank,undefined);
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
test('currency foreground motion groups complete serially before the next currency starts',async()=>{
 const mod=await import('../lib/ranking-motion-groups') as typeof import('../lib/ranking-motion-groups');
 const started:string[]=[],finished:string[]=[],release:Array<()=>void>=[];let completed=0;
 const work=mod.playRankingSequence(['BTC','ETH','SOL'],async id=>{started.push(id);await new Promise<void>(resolve=>release.push(resolve));finished.push(id);},()=>true,()=>{completed++;});
 assert.deepEqual(started,['BTC']);assert.deepEqual(finished,[]);assert.equal(completed,0);
 release.shift()!();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['BTC','ETH']);assert.deepEqual(finished,['BTC']);
 release.shift()!();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(started,['BTC','ETH','SOL']);assert.deepEqual(finished,['BTC','ETH']);
 release.shift()!();await work;
 assert.deepEqual(finished,['BTC','ETH','SOL']);assert.equal(completed,1);
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
test('canonical source rank remains visible when execution blocks an observation',()=>{
 const blocked={...row('held',100,1),gates:[{key:'holding',label:'holding',state:'NO' as const,detail:'',kind:'execution' as const}]};
 const [result]=rankRows([blocked,row('candidate',30,2)]);
 assert.equal(result.id,'held');
 assert.equal(result.rank,1);
 assert.equal(result.gates[0].state,'NO');
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
