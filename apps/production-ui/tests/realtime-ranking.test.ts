import { test } from 'node:test';
import assert from 'node:assert/strict';
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
 assert.equal(gateScore([{key:'x',label:'x',state:'OK',detail:''},{key:'account',label:'account',state:'UNKNOWN',detail:'',kind:'execution'}],true),50);
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
