from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()
old='const EVAL_END = Date.parse("2026-08-10T00:00:00Z");\nconst HOLDOUT_CUTOFF = EVAL_START + Math.floor((EVAL_END - EVAL_START) * 2 / 3);'
new='const EVAL_END = Date.parse(process.env.PENGU_EVAL_END || "2026-08-27T11:00:00Z");\nconst HISTORICAL_EVAL_END = Date.parse("2026-08-10T00:00:00Z");\nconst HOLDOUT_CUTOFF = EVAL_START + Math.floor((HISTORICAL_EVAL_END - EVAL_START) * 2 / 3);'
if old not in src: raise SystemExit('EVAL_END marker missing')
src=src.replace(old,new,1)
old_assert='''  const baselineNormalMetrics = metrics(baselineNormal), baselineStressMetrics = metrics(baselineStress);
  assert.equal(baselineNormalMetrics.trades, 33, `baseline replay drift: ${JSON.stringify(baselineNormalMetrics)}`);
  assert.equal(baselineNormalMetrics.longTrades, 5);
  assert.equal(baselineNormalMetrics.shortTrades, 28);
  assert.ok(Math.abs(baselineNormalMetrics.returnPct - 152.82887236975503) < 0.25, `baseline return drift: ${baselineNormalMetrics.returnPct}`);'''
new_assert='''  const baselineNormalMetrics = metrics(baselineNormal), baselineStressMetrics = metrics(baselineStress);
  const historicalBaselineNormal = baselineNormal.filter(t=>t.entryTs<HISTORICAL_EVAL_END);
  const historicalBaselineNormalMetrics = metrics(historicalBaselineNormal);
  assert.equal(historicalBaselineNormalMetrics.trades, 33, `historical baseline replay drift: ${JSON.stringify(historicalBaselineNormalMetrics)}`);
  assert.equal(historicalBaselineNormalMetrics.longTrades, 5);
  assert.equal(historicalBaselineNormalMetrics.shortTrades, 28);
  assert.ok(Math.abs(historicalBaselineNormalMetrics.returnPct - 152.82887236975503) < 0.25, `historical baseline return drift: ${historicalBaselineNormalMetrics.returnPct}`);'''
if old_assert not in src: raise SystemExit('baseline assertion marker missing')
src=src.replace(old_assert,new_assert,1)
start=src.index('  const v64=evaluateV64(rows,funding,baselineNormal);')
end=src.index('\n}\n\nmain().catch',start)
tail=r'''  const forwardDerivation=deriveV57Thresholds(historicalBaselineNormal);
  v57Thresholds=forwardDerivation.thresholds;
  const v64Frozen:V64Config={rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},lowGross:0.1875,label:"penguReturn72h_lte_0.12049483_LOW0.1875",trainScore:31.7010356792032};
  const exit={name:"FIXED_A6_T6_R3_H72",hardStopPct:.06,trailActivationPct:.06,trailRetracePct:.03,maxHoldHours:72,structuralBufferPct:null} as RecoveryExitConfig;
  const v2Frozen:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit,yieldMode:"BASE_LONG",v7Mode:"BASE"};
  const v8Frozen:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit,yieldMode:"BASE_LONG",v7Mode:"P5BE_H4_A24_G25"};
  const v8Plan=recoveryV7Plan(v8Frozen.v7Mode); assert.equal(v8Plan.protectActivationPct,null); assert.equal(v8Plan.partialStopPct,.04); assert.equal(v8Plan.partialAfterHours,24); assert.equal(v8Plan.partialGross,.25);
  v64ActiveConfig=v64Frozen; const baseN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  v64ActiveConfig=v64Frozen; const baseS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  v64ActiveConfig=v64Frozen; const v2N=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",v2Frozen);
  v64ActiveConfig=v64Frozen; const v2S=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",v2Frozen);
  v64ActiveConfig=v64Frozen; const v8N=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",v8Frozen);
  v64ActiveConfig=v64Frozen; const v8S=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",v8Frozen);
  const histV64=baseN.filter(t=>t.entryTs<HISTORICAL_EVAL_END),histV64m=metrics(histV64);
  assert.equal(histV64m.trades,41); assert.equal(histV64m.longTrades,13); assert.equal(histV64m.shortTrades,28); assert.ok(Math.abs(histV64m.returnPct-303.9903920953809)<1e-9);
  const forwardStart=HISTORICAL_EVAL_END;
  const isComplete=(t:RichTrade)=>{if(!t.engineExitReason.includes("MAX_HOLD"))return true;const h=t.engineExitReason.startsWith("RECOVERY_")?72:(t.side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours);return t.exitTs-t.entryTs>=(h-1)*HOUR;};
  const summarize=(trades:RichTrade[])=>{const observed=trades.filter(t=>t.entryTs>=forwardStart&&t.entryTs<EVAL_END),complete=observed.filter(isComplete),recovery=complete.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));return{completeOnly:metrics(complete),completeTrades:complete.length,recoveryTrades:recovery.length,incompleteExcluded:observed.length-complete.length,trades:complete.map(t=>({side:t.side,entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),accountReturnPct:t.accountReturn*100,exitReason:t.engineExitReason,requestedGross:t.requestedGross,mfePct:t.mfeUnit*100,maePct:t.maeUnit*100}))};};
  const bN=summarize(baseN),bS=summarize(baseS),r2N=summarize(v2N),r2S=summarize(v2S),r8N=summarize(v8N),r8S=summarize(v8S);
  const delta=(a:any,b:any)=>({returnPct:b.completeOnly.returnPct-a.completeOnly.returnPct,pf:(b.completeOnly.profitFactor??0)-(a.completeOnly.profitFactor??0),ddPct:b.completeOnly.maxDrawdownPct-a.completeOnly.maxDrawdownPct});
  const result={schema:"pengu-recovery-v8-final-observed-forward/v1",start:new Date(forwardStart).toISOString(),endExclusive:new Date(EVAL_END).toISOString(),alreadyObserved:true,notFreshAfterV8Development:true,v57Frozen:forwardDerivation,v64Frozen,v2Frozen,v8Frozen,v8Semantic:{breakevenProtector:false,partialStopPct:.04,partialAfterHours:24,partialGross:.25,remainingGross:.25},baseline:{normal:bN,stress:bS},v2:{normal:r2N,stress:r2S},v8:{normal:r8N,stress:r8S},deltas:{v8VsV64:{normal:delta(bN,r8N),stress:delta(bS,r8S)},v8VsV2:{normal:delta(r2N,r8N),stress:delta(r2S,r8S)}},historicalFreeze:{v64:histV64m},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v8-final-forward.json"),JSON.stringify(result,null,2)+"\n","utf8");
  console.log("V8_FINAL_FORWARD="+JSON.stringify(result));
'''
src=src[:start]+tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V8_FINAL_FORWARD={TARGET}')
