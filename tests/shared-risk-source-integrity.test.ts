import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {refreshSharedCryptoDailyRisk} from '../lib/disdex-shared-crypto-risk-writer';
import type {AsterV3Client} from '../lib/aster-v3-client';

const now=1793709100519;
const bad=[null,undefined,true,false,'',' ',NaN,Infinity,'NaN','Infinity'];
async function fixture(){
 const root=join(process.cwd(),'.verification');await mkdir(root,{recursive:true});
 const dir=await mkdtemp(join(root,'risk-source-'));const path=join(dir,'risk.json');
 const prior={schema:'disdex-shared-crypto-daily-risk/v1',accountScope:'ASTER_FUTURES',utcDay:'2026-11-03',tripped:true};
 const raw=JSON.stringify(prior);await writeFile(path,raw);
 const data:any={balances:[{asset:'USDT',balance:'100'}],
  positions:[{symbol:'DOGEUSDT',unRealizedProfit:'0'}],
  income:[{symbol:'DOGEUSDT',time:now-1000,incomeType:'REALIZED_PNL',income:'-1'}]};
 const client={getBalances:async()=>data.balances,getPositions:async()=>data.positions,
  getIncomeHistory:async()=>data.income} as unknown as AsterV3Client;
 return {data,path,raw,prior,run:()=>refreshSharedCryptoDailyRisk({client,path,now})};
}

test('incomplete or nonfinite financial inputs cannot publish a complete Risk snapshot',async()=>{
 for(const value of bad){
  for(const field of ['balance','pnl','income']){
   const f=await fixture();
   if(field==='balance')f.data.balances[0].balance=value;
   if(field==='pnl')f.data.positions[0].unRealizedProfit=value;
   if(field==='income')f.data.income[0].income=value;
   await assert.rejects(f.run,/SHARED_CRYPTO_RISK_SOURCE_/);
   assert.equal(await readFile(f.path,'utf8'),f.raw,'failed reads must preserve the existing latch bytes');
  }
 }
});

test('income with invalid or future timestamps cannot disappear from the PnL filter',async()=>{
 for(const time of [...bad,now+1,-1,now+0.5]){
  const f=await fixture();f.data.income[0].time=time;
  await assert.rejects(f.run,/SHARED_CRYPTO_RISK_SOURCE_/);
  assert.equal(await readFile(f.path,'utf8'),f.raw);
 }
});

test('a malformed prior latch cannot become false by coercion',async()=>{
 for(const tripped of [null,undefined,'true','false',0]){
  const f=await fixture();await writeFile(f.path,JSON.stringify({...f.prior,tripped}));
  await assert.rejects(f.run,/PRIOR_STATE_/);
 }
});

test('valid decimal inputs retain 7.5 percent and an already tripped same-day latch',async()=>{
 const f=await fixture();const state=await f.run();
 assert.equal(state.maximumLossPct,7.5);assert.equal(state.tripped,true);
 assert.equal(state.sourceComplete,true);assert.equal(state.realizedPnl,-1);
 assert.equal(state.referenceEquity,101);
});
