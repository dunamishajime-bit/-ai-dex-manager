from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='const EVAL_END = Date.parse("2026-08-10T00:00:00Z");\nconst HOLDOUT_CUTOFF = EVAL_START + Math.floor((EVAL_END - EVAL_START) * 2 / 3);'
new='const EVAL_END = Date.parse(process.env.PENGU_EVAL_END || "2026-08-27T11:00:00Z");\nconst HISTORICAL_EVAL_END = Date.parse("2026-08-10T00:00:00Z");\nconst HOLDOUT_CUTOFF = EVAL_START + Math.floor((HISTORICAL_EVAL_END - EVAL_START) * 2 / 3);'
if old not in src: raise SystemExit('EVAL_END/HOLDOUT marker missing')
src=src.replace(old,new,1)

old_assert='''  assert.equal(v64Trades.length,41,"V64 trade identity/count must remain frozen at 41");
  assert.equal(v64Trades.filter(t=>t.side==="L").length,13,"V64 frozen Long count must remain 13");
  assert.equal(v64Trades.filter(t=>t.side==="S").length,28,"V64 frozen Short count must remain 28");'''
new_assert='''  const historicalFrozenV64=v64Trades.filter(t=>t.entryTs<HISTORICAL_EVAL_END);
  assert.equal(historicalFrozenV64.length,41,"historical V64 trade identity/count must remain frozen at 41");
  assert.equal(historicalFrozenV64.filter(t=>t.side==="L").length,13,"historical V64 frozen Long count must remain 13");
  assert.equal(historicalFrozenV64.filter(t=>t.side==="S").length,28,"historical V64 frozen Short count must remain 28");'''
if old_assert not in src: raise SystemExit('frozen V64 assertions missing')
src=src.replace(old_assert,new_assert,1)

marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
if marker not in src: raise SystemExit('longDiagnostics marker missing')
insert=r'''
const FORWARD_V64_FROZEN:V64Config={rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},lowGross:0.1875,label:"penguReturn72h_lte_0.12049483_LOW0.1875",trainScore:31.7010356792032};
const FORWARD_RECOVERY_FROZEN:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit:{name:"FIXED_A6_T6_R3_H72",hardStopPct:.06,trailActivationPct:.06,trailRetracePct:.03,maxHoldHours:72,structuralBufferPct:null},yieldMode:"BASE_LONG"};
const FORWARD_START=Date.parse("2026-08-10T00:00:00Z");
function forwardSelectedConfigMatches(x:V64Config|null){return Boolean(x&&x.rule.feature===FORWARD_V64_FROZEN.rule.feature&&x.rule.op===FORWARD_V64_FROZEN.rule.op&&Math.abs(x.rule.threshold-FORWARD_V64_FROZEN.rule.threshold)<1e-15&&Math.abs(x.lowGross-FORWARD_V64_FROZEN.lowGross)<1e-15);}
function forwardTradeComplete(t:RichTrade){if(!t.engineExitReason.includes("MAX_HOLD"))return true;const h=t.engineExitReason.startsWith("RECOVERY_")?FORWARD_RECOVERY_FROZEN.exit.maxHoldHours:(t.side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours);return t.exitTs-t.entryTs>=(h-1)*HOUR;}
function forwardSlice(x:RichTrade[]){return x.filter(t=>t.entryTs>=FORWARD_START&&t.entryTs<EVAL_END);}
function forwardSummary(x:RichTrade[]){const all=forwardSlice(x),complete=all.filter(forwardTradeComplete),recovery=complete.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));return{allObserved:metrics(all),completeOnly:metrics(complete),completeTrades:complete.length,recoveryTrades:recovery.length,incompleteExcluded:all.length-complete.length,firstEntry:complete.length?new Date(complete[0].entryTs).toISOString():null,lastExit:complete.length?new Date(complete.at(-1)!.exitTs).toISOString():null};}
function buildFreshForward(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],selectedConfig:V64Config|null){assert(forwardSelectedConfigMatches(selectedConfig),"historical V64 frozen config drifted before forward replay");v64ActiveConfig=FORWARD_V64_FROZEN;const bn=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;v64ActiveConfig=FORWARD_V64_FROZEN;const bs=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;v64ActiveConfig=FORWARD_V64_FROZEN;const cn=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",FORWARD_RECOVERY_FROZEN);v64ActiveConfig=FORWARD_V64_FROZEN;const cs=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",FORWARD_RECOVERY_FROZEN);return{schema:"pengu-recovery-v2-fresh-forward/v2",start:new Date(FORWARD_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString(),frozenBeforeForward:true,v57Frozen:v57Thresholds,v64Frozen:FORWARD_V64_FROZEN,recoveryFrozen:FORWARD_RECOVERY_FROZEN,baseline:{normal:forwardSummary(bn),stress:forwardSummary(bs)},candidate:{normal:forwardSummary(cn),stress:forwardSummary(cs)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};}
'''
src=src.replace(marker,insert+marker,1)

old='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);'
new='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);\n  analysis.freshForward=buildFreshForward(rows,funding,selectedConfig);'
if old not in src: raise SystemExit('recoveryBacktest assignment missing')
src=src.replace(old,new,1)
TARGET.write_text(src)
print(f'PATCHED_FRESH_FORWARD_V2={TARGET}')
