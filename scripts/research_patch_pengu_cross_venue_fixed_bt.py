from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

# Cross-venue window: warmup 2026-05-15, evaluation 2026-06-01..2026-08-10.
src=src.replace('const WARM_START = Date.parse("2025-07-01T00:00:00Z");','const WARM_START = Date.parse("2026-05-15T00:00:00Z");',1)
src=src.replace('const EVAL_START = Date.parse("2025-08-10T00:00:00Z");','const EVAL_START = Date.parse("2026-06-01T00:00:00Z");',1)
src=src.replace('const EVAL_END = Date.parse("2026-08-10T00:00:00Z");','const EVAL_END = Date.parse("2026-08-10T00:00:00Z");',1)

start=src.index('async function main() {')
end=src.index('\n}\n\nmain().catch',start)
main=r'''async function main() {
  assert.equal(PENGU_DUAL_LS_V2.id,"PENGU_DUAL_LS_V2_FINAL");
  const venue=process.env.PENGU_CROSS_VENUE||"UNKNOWN";
  const dataDir=process.env.PENGU_LOCAL_DATA_DIR;
  assert.ok(dataDir,"PENGU_LOCAL_DATA_DIR required");
  const readJson=async(name:string)=>JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));
  const penguRaw=(await readJson("PENGUUSDT-candles.json")) as DisDexV35Candle[];
  const btcRaw=(await readJson("BTCUSDT-candles.json")) as DisDexV35Candle[];
  const funding=(await readJson("PENGUUSDT-funding.json")) as FundingPoint[];
  const meta=await readJson("meta.json");
  const btcByTs=new Set(btcRaw.map(r=>r.openTime));
  const pengu=penguRaw.filter(r=>btcByTs.has(r.openTime));
  const penguByTs=new Set(pengu.map(r=>r.openTime));
  const btc=btcRaw.filter(r=>penguByTs.has(r.openTime));
  assert.equal(pengu.length,btc.length);
  for(let ts=EVAL_START;ts<EVAL_END;ts+=HOUR){assert.ok(penguByTs.has(ts),`missing common evaluation bar ${new Date(ts).toISOString()}`);}
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:funding.map(r=>({...r}))};
  const rows=buildPenguDualLsV2EvaluationSeries(history,EVAL_END+HOUR);

  // All thresholds/configs below were frozen on Aster before this venue replay.
  v57Thresholds={relativeReturn24hFloor:0.10855085872412068,breakoutAtrFloor:0.510560996033169};
  const v64Frozen:V64Config={rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},lowGross:0.1875,label:"penguReturn72h_lte_0.12049483_LOW0.1875",trainScore:31.7010356792032};
  const recoveryFrozen:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit:{name:"FIXED_A6_T6_R3_H72",hardStopPct:.06,trailActivationPct:.06,trailRetracePct:.03,maxHoldHours:72,structuralBufferPct:null},yieldMode:"BASE_LONG"};
  v64ActiveConfig=v64Frozen;
  const baseN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  v64ActiveConfig=v64Frozen;
  const baseS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  v64ActiveConfig=v64Frozen;
  const candN=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",recoveryFrozen);
  v64ActiveConfig=v64Frozen;
  const candS=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",recoveryFrozen);
  const inEval=(t:RichTrade)=>t.entryTs>=EVAL_START&&t.entryTs<EVAL_END;
  const bn=baseN.filter(inEval),bs=baseS.filter(inEval),cn=candN.filter(inEval),cs=candS.filter(inEval);
  const recoveryN=cn.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));
  const recoveryS=cs.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));
  const bnm=metrics(bn),bsm=metrics(bs),cnm=metrics(cn),csm=metrics(cs);
  const result={
    schema:"pengu-recovery-v2-cross-venue-fixed/v1",venue,
    period:{warmStart:new Date(WARM_START).toISOString(),start:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    frozenBeforeVenue:true,
    v57Frozen:v57Thresholds,v64Frozen,recoveryFrozen,data:meta,
    baseline:{normal:bnm,stress:bsm},candidate:{normal:cnm,stress:csm},
    deltas:{normalReturnPct:cnm.returnPct-bnm.returnPct,stressReturnPct:csm.returnPct-bsm.returnPct,normalPf:(cnm.profitFactor??0)-(bnm.profitFactor??0),stressPf:(csm.profitFactor??0)-(bsm.profitFactor??0),normalDdPct:cnm.maxDrawdownPct-bnm.maxDrawdownPct,stressDdPct:csm.maxDrawdownPct-bsm.maxDrawdownPct},
    recovery:{normal:metrics(recoveryN),stress:metrics(recoveryS),normalTrades:recoveryN.map(t=>({entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),accountReturnPct:t.accountReturn*100,exitReason:t.engineExitReason,mfePct:t.mfeUnit*100,maePct:t.maeUnit*100})),stressTrades:recoveryS.map(t=>({entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),accountReturnPct:t.accountReturn*100,exitReason:t.engineExitReason,mfePct:t.mfeUnit*100,maePct:t.maeUnit*100}))},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  };
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"cross-venue-result.json"),JSON.stringify(result,null,2)+"\n","utf8");
  console.log("CROSS_VENUE_FIXED="+JSON.stringify(result));
'''
src=src[:start]+main+src[end:]
TARGET.write_text(src)
print(f'PATCHED_CROSS_VENUE_FIXED={TARGET}')
