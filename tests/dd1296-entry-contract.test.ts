import assert from 'node:assert/strict';
import test from 'node:test';
import { quality102GrossForFamily } from '../config/integratedProductionRiskPolicy';
import { causalReturn, q102ExhaustionReason, v12EntryReason, recordSideExit } from '../lib/dd1296-entry-policy';
const H=3_600_000;
test('side caps constrain opposite HV and REV allocations independently',()=>{
  const f=quality102GrossForFamily as (family:string,side:number)=>number;
  for(const [family,side,want] of [['HIGH_VOL',1,1],['HIGH_VOL',-1,.6],['REV',1,1.5],['REV',-1,1.25],['PB',1,2],['MR',1,.75],['MR',-1,.75],['BRK',1,.75],['BRK',-1,.75]] as const) assert.equal(f(family,side),want);
  assert.throws(()=>f('HIGH_VOL',0));
});
test('FET BRK SHORT exhaustion boundary rejects only the selected route',()=>{
  assert.equal(q102ExhaustionReason('FETUSDT','BRK',-1,-.1199),undefined);
  assert.equal(q102ExhaustionReason('FETUSDT','BRK',-1,-.12),'Q102_BRK_FET_SHORT_EXHAUSTION');
  for(const [symbol,family,side] of [['ATOMUSDT','BRK',-1],['FETUSDT','MR',-1],['FETUSDT','BRK',1]] as const) assert.equal(q102ExhaustionReason(symbol,family,side,-.5),undefined);
});
test('boundary return uses entry open and ignores future/current H1 close',()=>{
  const bars=Array.from({length:74},(_,i)=>({timestampMs:(100+i)*H,open:100,close:i===73?999:100}));
  assert.equal(causalReturn(bars,{timestampMs:173*H,open:102},72),.020000000000000018);
  assert.throws(()=>causalReturn(bars.filter(x=>x.timestampMs!==101*H),{timestampMs:173*H,open:102},72));
});
test('V12 causal thresholds apply to intended symbol side and rank',()=>{
  assert.equal(v12EntryReason('AVAXUSDT','SHORT',1,.001,-.01,0),'V12_AVAX_R1_SHORT_REBOUND');
  assert.equal(v12EntryReason('AVAXUSDT','SHORT',2,.001,-.01,0),undefined);
  assert.equal(v12EntryReason('ATOMUSDT','LONG',1,.00603,0,0),'V12_ATOM_EXHAUSTION_CAUSAL');
  assert.equal(v12EntryReason('AVAXUSDT','LONG',1,0,0,.0165),'V12_AVAX_LONG_WEAK24_CAUSAL');
});
test('six same-side net losses block only that side; duplicate fills and zero do not reset streak',()=>{
  const ledger:any={};
  for(let i=0;i<6;i++) recordSideExit(ledger,{id:`s${i}`,side:'SHORT',netPnl:-1,exitTs:100*H+i});
  assert.equal(ledger.SHORT.losses,6); assert.equal(ledger.SHORT.until,106*H+5); assert.equal(ledger.LONG,undefined);
  recordSideExit(ledger,{id:'s5',side:'SHORT',netPnl:-1,exitTs:101*H}); assert.equal(ledger.SHORT.losses,6);
  recordSideExit(ledger,{id:'zero',side:'SHORT',netPnl:0,exitTs:101*H}); assert.equal(ledger.SHORT.losses,6);
  recordSideExit(ledger,{id:'longwin',side:'LONG',netPnl:2,exitTs:101*H}); assert.equal(ledger.SHORT.losses,6);
  recordSideExit(ledger,{id:'shortwin',side:'SHORT',netPnl:2,exitTs:101*H}); assert.equal(ledger.SHORT.losses,0); assert.equal(ledger.SHORT.until,106*H+5);
});

test('FET cooldown survives the real durable store and expires at exactly 24 hours', async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
 const {emptyFetBrk48State,recordFetExit,writeFetBrk48State,readFetBrk48State}=await import('../lib/fet-brk48-state');
 const dir=await mkdtemp(join(tmpdir(),'dd1296-')); try {const path=join(dir,'state.json'); const s=emptyFetBrk48State('test',100*H); recordFetExit(s,100*H); await writeFetBrk48State(path,s); const r=await readFetBrk48State(path,'test'); assert.equal(r.cooldownUntilTs,124*H); assert.equal(r.lastEvaluationCandidate,false); } finally {await rm(dir,{recursive:true,force:true});}
});

test('PENGU limited re-break rejects elevated bounce only during BTC counterwind',async()=>{
 const {evaluatePenguDualLsV2ShortSignals}=await import('../lib/pengu-dual-ls-v2');
 const f:any={low:100,close:103,previousLow:104,ema72:110,ema168:120,penguReturn24h:-.08,penguReturn72h:-.02,relativeReturn24h:-.07,volumeRatio6OverPrior36:1,btcReturn24h:-.01,btcEma168Distance:.01,rsi14:40};
 assert.deepEqual(evaluatePenguDualLsV2ShortSignals([f]).signals,[false]);
 assert.deepEqual(evaluatePenguDualLsV2ShortSignals([f,{...f,close:102}]).signals,[false,true]);
 assert.deepEqual(evaluatePenguDualLsV2ShortSignals([{...f,btcEma168Distance:-.01}]).signals,[true]);
});

test('V12 full-exit counter uses fees and all partial fills and rejects incomplete quantity proof',async()=>{
 const {recordV12ConfirmedExit}=await import('../lib/v12-dd1296-live-policy');
 const fills=[{id:1,orderId:7,symbol:'ATOMUSDT',side:'BUY',qty:'10',time:100*H,realizedPnl:'0',commission:'1',commissionAsset:'USDT'}, {id:2,orderId:8,symbol:'ATOMUSDT',side:'SELL',qty:'4',time:101*H,realizedPnl:'2',commission:'.4',commissionAsset:'USDT'},{id:3,orderId:9,symbol:'ATOMUSDT',side:'SELL',qty:'6',time:102*H,realizedPnl:'-1',commission:'.6',commissionAsset:'USDT'}];
 const a:any={client:{getOrder:async()=>({orderId:7,executedQty:'10'}),getUserTrades:async()=>fills,getIncomeHistory:async()=>[]}};
 const s:any={}; const p:any={symbol:'ATOMUSDT',side:'LONG',positionId:'own-entry',entrySignalTs:100*H};
 await recordV12ConfirmedExit(a,s,p,103*H); assert.equal(s.sideLossLedger.LONG.losses,1);
 await recordV12ConfirmedExit(a,s,p,104*H); assert.equal(s.sideLossLedger.LONG.losses,1);
 fills.pop(); await assert.rejects(recordV12ConfirmedExit(a,{} as any,p,103*H),/QUANTITY_RECONCILIATION/);
});

test('FET active migration requires exact venue quantity, profit-floor STOP and cross5 leverage',async()=>{
 const {assertFetMigrationProof}=await import('../scripts/disdex-fet-active-state-sha-migrate');
 const s:any={position:{quantity:515,entryPrice:.2407,hardStop:.2419,stopClientOrderId:'fet-stop-own'}};
 const p:any={symbol:'FETUSDT',positionAmt:'515',entryPrice:'.2407',leverage:'5',marginType:'cross'};
 const o:any={symbol:'FETUSDT',clientOrderId:'fet-stop-own',type:'STOP_MARKET',side:'SELL',reduceOnly:true,status:'NEW',executedQty:'0',origQty:'515',stopPrice:'.2419'};
 assert.doesNotThrow(()=>assertFetMigrationProof(s,[p],[o]));
 assert.throws(()=>assertFetMigrationProof(s,[{...p,positionAmt:'514'}],[o]),/POSITION_MISMATCH/);
 assert.throws(()=>assertFetMigrationProof(s,[p],[{...o,stopPrice:'.228'}]),/STOP_READBACK/);
 assert.throws(()=>assertFetMigrationProof(s,[{...p,marginType:'isolated'}],[o]),/MARGIN_CONTRACT/);
});

test('new integrated acceptance is bound to specified research SHA and reproduced 1358-trade ledger',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const t=JSON.parse(await readFile('docs/production/current-live-target.json','utf8'));
 // Hash Git-canonical LF content: Windows checkout CRLF must not change the frozen artifact contract.
 const bytes=await readFile(t.formalBacktest.sourceArtifact);
 const canonicalBytes=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'),'utf8');
 assert.equal(createHash('sha256').update(canonicalBytes).digest('hex').toUpperCase(),t.formalBacktest.sourceArtifactSha256);
 assert.equal(t.researchSourceSha,'db0ee5def97e8194f55aa77fa5b7326fa938d456');assert.equal(t.formalBacktest.NORMAL.trades,1358);
 assert.equal(t.strategy.v52.basisStopMultiple,1.75);assert.equal(t.strategy.v52.fixedEntryReferenceStopPhase1,false);
});

test('LONG loss cooldown survives real V12 restart and never disables opposite SHORT',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {FileV12X1AllRunnerStateStore}=await import('../lib/v12-x1-all-runner-state');const {evaluateV12Dd1296Entry}=await import('../lib/v12-dd1296-live-policy');
 const dir=await mkdtemp(join(tmpdir(),'v12-side-'));try{const store=new FileV12X1AllRunnerStateStore(join(dir,'state.json'),'LIVE');const s=await store.load();s.sideLossLedger={};for(let i=0;i<6;i++)recordSideExit(s.sideLossLedger,{id:`l${i}`,side:'LONG',netPnl:-1,exitTs:100*H});await store.save(s);const after=await store.load();
 assert.equal(await evaluateV12Dd1296Entry({} as any,after,{symbol:'SOL',side:'LONG',rank:1,entryTs:101*H},101*H),'V12_SIDE_LOSS_COOLDOWN_6H');
 assert.equal(await evaluateV12Dd1296Entry({} as any,after,{symbol:'SOL',side:'SHORT',rank:1,entryTs:101*H},101*H),undefined);
 assert.equal(await evaluateV12Dd1296Entry({} as any,after,{symbol:'SOL',side:'LONG',rank:1,entryTs:106*H},106*H),undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('delayed V12 forced exit stops accounting at first flat before another owner opens same symbol',async()=>{
 const {recordV12ConfirmedExit}=await import('../lib/v12-dd1296-live-policy');
 const f=(id:number,orderId:number,side:string,qty:number,time:number,pnl:number)=>({id,orderId,symbol:'ATOMUSDT',side,qty:String(qty),time,realizedPnl:String(pnl),commission:'0',commissionAsset:'USDT'});
 const a:any={client:{getOrder:async()=>({orderId:7,executedQty:'10'}),getUserTrades:async()=>[f(1,7,'BUY',10,100*H,0),f(2,8,'SELL',10,101*H,-1),f(3,9,'BUY',12,102*H,0)],getIncomeHistory:async(i:any)=>{assert.equal(i.endTime,101*H);return [];}}};
 const s:any={};await recordV12ConfirmedExit(a,s,{symbol:'ATOMUSDT',side:'LONG',positionId:'own-entry',entrySignalTs:100*H} as any,103*H);assert.equal(s.sideLossLedger.LONG.losses,1);
});

test('simultaneous finalized exits count in actual fill-time order instead of reversed active array',async()=>{
 const {recordV12ConfirmedExitBatch}=await import('../lib/v12-dd1296-live-policy');
 const f=(symbol:string,id:number,orderId:number,side:string,time:number,pnl:number)=>({id,orderId,symbol,side,qty:'10',time,realizedPnl:String(pnl),commission:'0',commissionAsset:'USDT'});
 const a:any={client:{getOrder:async()=>({orderId:7,executedQty:'10'}),getUserTrades:async(symbol:string)=>[f(symbol,1,7,'BUY',100*H,0),f(symbol,2,8,'SELL',symbol==='SOLUSDT'?101*H:102*H,symbol==='SOLUSDT'?1:-1)],getIncomeHistory:async()=>[]}};
 const s:any={sideLossLedger:{LONG:{losses:5,until:0},completed:[]}};
 await recordV12ConfirmedExitBatch(a,s,[{symbol:'ATOMUSDT',side:'LONG',positionId:'later-loss',entrySignalTs:100*H},{symbol:'SOLUSDT',side:'LONG',positionId:'earlier-win',entrySignalTs:100*H}] as any,103*H);
 assert.equal(s.sideLossLedger.LONG.losses,1);assert.equal(s.sideLossLedger.LONG.until,0);
});

test('formal handoff PB SHORT inherits 2.50 independently of PB LONG 2.00',()=>{
 assert.equal(quality102GrossForFamily('PB',-1),2.5);
 assert.equal(quality102GrossForFamily('PB',1),2.0);
});
