import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ranking from '../lib/realtime-ranking';
import type { RankRow } from '../lib/realtime-ranking';
const row=(id:string,score=80):RankRow=>({id,symbol:id+'USDT',logic:'V12',side:'LONG',score,gates:[],reason:'',fresh:true,checkedAt:1});
test('only existing fresh candidates rising in authoritative order are show events',()=>{
 assert.equal(typeof ranking.risingRankEvents,'function');
 const before=[row('a',90),row('b',80),row('c',70)],after=[row('c',95),row('a',90),row('b',80),row('new',60)];
 assert.deepEqual(ranking.risingRankEvents([],after),[]);
 assert.deepEqual(ranking.risingRankEvents(before,after).map(e=>[e.row.id,e.from,e.to,e.delta]),[['c',3,1,2]]);
 assert.deepEqual(ranking.risingRankEvents(before,[{...row('c'),fresh:false},row('a'),row('b')]),[]);
});
test('commentary states numeric minimum gap and keeps execution blocks separate',()=>{
 assert.equal(typeof ranking.rankCommentary,'function');
 const r={...row('LINK'),gates:[{key:'volume',label:'出来高比率',state:'NO' as const,actual:.72,required:'≥ 0.8',detail:'必要値未達'},{key:'cooldown',label:'Cooldown',state:'NO' as const,detail:'あと6時間',kind:'execution' as const}]};
 const c=ranking.rankCommentary(r,10,5);
 assert.match(c.headline,/10位から5位/);
 assert.match(c.signal,/あと0.08/);
 assert.match(c.execution,/Cooldown/);
 assert.doesNotMatch(c.signal,/発注できます|発火します/);
 assert.match(c.speech,/10位から5位まで上昇しました/);
 assert.match(c.speech,/あと0.08です/);
 assert.doesNotMatch(c.speech,/\s\/\s/);
});
test('unknown, stale, strict breakout and upper limits never invent minimum deficits',()=>{
 assert.equal(typeof ranking.rankCommentary,'function');
 const r={...row('X'),gates:[{key:'max',label:'最大距離',state:'NO' as const,actual:4,required:'≤ 3',detail:'距離超過'},{key:'raw',label:'候補',state:'UNKNOWN' as const,detail:'未取得'}]};
 assert.doesNotMatch(ranking.rankCommentary(r).signal,/あと/);
 assert.match(ranking.rankCommentary({...r,fresh:false}).signal,/観測更新待ち/);
 const atBoundary={...row('FET'),gates:[{key:'breakout',label:'高値',state:'NO' as const,actual:100,required:'終値 > 100',detail:'同値はNO'}]};
 assert.doesNotMatch(ranking.rankCommentary(atBoundary).signal,/あと0/);
});
