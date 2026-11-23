from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()
start=src.index('  const v64=evaluateV64(rows,funding,baselineNormal);')
end=src.index('\n}\n\nmain().catch',start)
tail=r'''  const frozenV57:V57Thresholds={relativeReturn24hFloor:0.10855085872412068,breakoutAtrFloor:0.510560996033169};
  v57Thresholds=frozenV57;
  const v64Frozen:V64Config={rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},lowGross:0.1875,label:"penguReturn72h_lte_0.12049483_LOW0.1875",trainScore:31.7010356792032};
  const exit={name:"FIXED_A6_T6_R3_H72",hardStopPct:.06,trailActivationPct:.06,trailRetracePct:.03,maxHoldHours:72,structuralBufferPct:null} as RecoveryExitConfig;
  const v8Frozen:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit,yieldMode:"BASE_LONG",v7Mode:"P5BE_H4_A24_G25"};
  const v8Plan=recoveryV7Plan(v8Frozen.v7Mode);
  assert.equal(v8Plan.protectActivationPct,null);
  assert.equal(v8Plan.partialStopPct,.04);
  assert.equal(v8Plan.partialAfterHours,24);
  assert.equal(v8Plan.partialGross,.25);
  v64ActiveConfig=v64Frozen; const v8N=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",v8Frozen);
  v64ActiveConfig=v64Frozen; const v8S=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",v8Frozen);
  const normalMetrics=metrics(v8N),stressMetrics=metrics(v8S);
  assert.equal(normalMetrics.trades,70,`V8 normal trade drift ${JSON.stringify(normalMetrics)}`);
  assert.equal(stressMetrics.trades,70,`V8 severe trade drift ${JSON.stringify(stressMetrics)}`);
  assert.ok(Math.abs(normalMetrics.returnPct-574.2299381960086)<1e-9,`V8 normal return drift ${normalMetrics.returnPct}`);
  assert.ok(Math.abs(normalMetrics.profitFactor!-4.331158674670027)<1e-9,`V8 normal PF drift ${normalMetrics.profitFactor}`);
  assert.ok(Math.abs(normalMetrics.maxDrawdownPct-(-12.848857788628465))<1e-9,`V8 normal DD drift ${normalMetrics.maxDrawdownPct}`);
  assert.ok(Math.abs(stressMetrics.returnPct-395.5575708353778)<1e-9,`V8 severe return drift ${stressMetrics.returnPct}`);
  assert.ok(Math.abs(stressMetrics.profitFactor!-3.4431875382578734)<1e-9,`V8 severe PF drift ${stressMetrics.profitFactor}`);
  assert.ok(Math.abs(stressMetrics.maxDrawdownPct-(-14.773631389772579))<1e-9,`V8 severe DD drift ${stressMetrics.maxDrawdownPct}`);
  const publicV8Trade=(t:RichTrade)=>({side:t.side,signalTs:t.signalTs,entryTs:t.entryTs,exitTs:t.exitTs,entryPrice:t.entryPrice,exitPrice:t.exitPrice,requestedGross:t.requestedGross,rawUnitReturn:t.rawUnitReturn,fundingUnitReturn:t.fundingUnitReturn,costUnitReturn:t.costUnitReturn,netUnitReturn:t.netUnitReturn,accountReturn:t.accountReturn,exitReason:t.exitReason,engineExitReason:t.engineExitReason});
  const recoveryN=v8N.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));
  const recoveryS=v8S.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));
  assert.ok(recoveryN.length>0&&recoveryS.length>0,"Recovery V8 trades missing");
  const ledger={
    schema:"pengu-dual-ls-v2-recovery-v8-ledger/v1",
    strategyId:"PENGU_DUAL_LS_V2_RECOVERY_V8",
    researchOnly:true,
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{productionLogicSha:SOURCE_SHA,freezeSha:"15c0b7586710c9db1c46b376bb5041203fc7d826",venue:"Aster perpetual public REST V3",parametersFrozen:true},
    config:{rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,yieldMode:"BASE_LONG",exit:v8Frozen.exit,delayedPartialDefense:{partialStopPct:.04,partialAfterHours:24,partialGross:.25,remainingGross:.25},breakevenProtector:false,staticAtrBtcGuard:false,stagedEntry:false},
    costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    modes:{normal:{metrics:normalMetrics,trades:v8N.map(publicV8Trade)},stress:{metrics:stressMetrics,trades:v8S.map(publicV8Trade)}},
    integrity:{
      noOverlapNormal:v8N.every((t,i)=>i===0||t.entryTs>=v8N[i-1].exitTs),
      noOverlapStress:v8S.every((t,i)=>i===0||t.entryTs>=v8S[i-1].exitTs),
      sameTimestampHandoffAllowed:true,
      maximumRequestedGrossNormal:Math.max(...v8N.map(t=>t.requestedGross)),
      maximumRequestedGrossStress:Math.max(...v8S.map(t=>t.requestedGross)),
      maximumRecoveryRequestedGrossNormal:Math.max(...recoveryN.map(t=>t.requestedGross)),
      maximumRecoveryRequestedGrossStress:Math.max(...recoveryS.map(t=>t.requestedGross)),
      recoveryTradeCountNormal:recoveryN.length,
      recoveryTradeCountStress:recoveryS.length
    },
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  };
  assert.equal(ledger.period.startInclusive,"2025-08-10T00:00:00.000Z");
  assert.equal(ledger.period.endExclusive,"2026-08-10T00:00:00.000Z");
  assert.equal(ledger.integrity.noOverlapNormal,true);
  assert.equal(ledger.integrity.noOverlapStress,true);
  assert.ok(Math.abs(ledger.integrity.maximumRecoveryRequestedGrossNormal-.5)<1e-12);
  assert.ok(Math.abs(ledger.integrity.maximumRecoveryRequestedGrossStress-.5)<1e-12);
  const out=process.env.PENGU_LEDGER_OUT||path.join(OUTPUT_DIR,"pengu-recovery-v8-ledger.json");
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(ledger,null,2)+"\n","utf8");
  console.log("PENGU_V8_LEDGER="+JSON.stringify({period:ledger.period,normal:normalMetrics,stress:stressMetrics,integrity:ledger.integrity,safety:ledger.safety}));
'''
src=src[:start]+tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V8_INTEGRATED_LEDGER={TARGET}')
