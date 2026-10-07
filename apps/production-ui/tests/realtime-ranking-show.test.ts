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

test('PC alerts only fire for changed high-score leader or an entry from below top 3',()=>{
 assert.equal(typeof ranking.rankingPcAlert,'function');
 const base=[row('a',95),row('b',88),row('c',80),row('d',70)];
 assert.equal(ranking.rankingPcAlert([],base),null);
 assert.equal(ranking.rankingPcAlert(base,base),null);

 const leaderStillHighButOrderChanged=[row('a',95),row('c',90),row('b',88),row('d',70)];
 const high=ranking.rankingPcAlert(base,leaderStillHighButOrderChanged);
 assert.equal(high?.reason,'TOP_SCORE');
 assert.match(high?.body||'',/1位 a \/ V12 Score 95/);

 const top3Entry=[row('a',85),row('d',84),row('b',83),row('c',70)];
 const entry=ranking.rankingPcAlert(base,top3Entry);
 assert.equal(entry?.reason,'TOP3_ENTRY');
 assert.match(entry?.body||'',/d \/ V12 4位→2位/);

 const alreadyTop3=[row('a',85),row('c',84),row('b',83),row('d',70)];
 const noEntry=ranking.rankingPcAlert([row('a',85),row('b',84),row('c',83),row('d',70)],alreadyTop3);
 assert.equal(noEntry,null);
});

test('PC alert requires a ranking change with top score 90+, or a prior rank below top3 entering top3',()=>{
 assert.equal(typeof ranking.rankingPcAlert,'function');
 const base=[row('A',95),row('B',89),row('C',88),row('D',87),row('E',86)];
 assert.equal(ranking.rankingPcAlert([],base),null,'first snapshot must not notify');
 assert.equal(ranking.rankingPcAlert(base,base),null,'unchanged ranking must not notify even with top score >= 90');
 const swapped=[row('A',95),row('C',90),row('B',89),row('D',87),row('E',86)];
 const highTop=ranking.rankingPcAlert(base,swapped);
 assert.equal(highTop?.reason,'TOP_SCORE');
 assert.match(highTop?.body||'',/1位 A .*Score 95/);
 const top3Entry=[row('A',85),row('D',84),row('B',83),row('C',82),row('E',81)];
 const entered=ranking.rankingPcAlert(base,top3Entry);
 assert.equal(entered?.reason,'TOP3_ENTRY');
 assert.match(entered?.body||'',/D .*4位→2位/);
 const both=[row('D',97),row('A',95),row('B',89),row('C',88),row('E',86)];
 const combined=ranking.rankingPcAlert(base,both);
 assert.equal(combined?.reason,'BOTH');
 assert.match(combined?.body||'',/D .*4位→1位/);
});
