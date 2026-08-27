from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

src=src.replace('const WARM_START = Date.parse("2025-07-01T00:00:00Z");','const WARM_START = Date.parse("2026-05-15T00:00:00Z");',1)
src=src.replace('const EVAL_START = Date.parse("2025-08-10T00:00:00Z");','const EVAL_START = Date.parse("2026-06-01T00:00:00Z");',1)

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
  for(let ts=EVAL_START;ts<EVAL_END;ts+=HOUR)assert.ok(penguByTs.has(ts),`missing common evaluation bar ${new Date(ts).toISOString()}`);
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:funding.map(r=>({...r}))};
  const rows=buildPenguDualLsV2EvaluationSeries(history,EVAL_END+HOUR);
  v57Thresholds={relativeReturn24hFloor:0.10855085872412068,breakoutAtrFloor:0.510560996033169};
  const v64Frozen:V64Config={rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},lowGross:0.1875,label:"penguReturn72h_lte_0.12049483_LOW0.1875",trainScore:31.7010356792032};
  const exit={name:"FIXED_A6_T6_R3_H72",hardStopPct:.06,trailActivationPct:.06,trailRetracePct:.03,maxHoldHours:72,structuralBufferPct:null} as RecoveryExitConfig;
  const v2Frozen:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit,yieldMode:"BASE_LONG",v7Mode:"BASE"};
  const v7Frozen:RecoveryBtConfig={rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit,yieldMode:"BASE_LONG",v7Mode:"P5BE_H4_A12_G125"};
  v64ActiveConfig=v64Frozen; const baseN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  v64ActiveConfig=v64Frozen; const baseS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  v64ActiveConfig=v64Frozen; const v2N=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",v2Frozen);
  v64ActiveConfig=v64Frozen; const v2S=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",v2Frozen);
  v64ActiveConfig=v64Frozen; const v7N=replayRecoveryIntegrated(rows,funding,"normal","V64_DYNAMIC",v7Frozen);
  v64ActiveConfig=v64Frozen; const v7S=replayRecoveryIntegrated(rows,funding,"stress","V64_DYNAMIC",v7Frozen);
  const inEval=(t:RichTrade)=>t.entryTs>=EVAL_START&&t.entryTs<EVAL_END;
  const summarize=(tr:RichTrade[])=>metrics(tr.filter(inEval));
  const bn=summarize(baseN),bs=summarize(baseS),n2=summarize(v2N),s2=summarize(v2S),n7=summarize(v7N),s7=summarize(v7S);
  const delta=(a:any,b:any)=>({returnPct:b.returnPct-a.returnPct,pf:(b.profitFactor??0)-(a.profitFactor??0),ddPct:b.maxDrawdownPct-a.maxDrawdownPct});
  const rec=(tr:RichTrade[])=>tr.filter(inEval).filter(t=>t.engineExitReason.startsWith("RECOVERY_")).map(t=>({entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),accountReturnPct:t.accountReturn*100,exitReason:t.engineExitReason,mfePct:t.mfeUnit*100,maePct:t.maeUnit*100}));
  const result={schema:"pengu-recovery-v7-final-cross/v1",venue,period:{warmStart:new Date(WARM_START).toISOString(),start:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},frozenBeforeVenue:true,v57Frozen:v57Thresholds,v64Frozen,v2Frozen,v7Frozen,data:meta,baseline:{normal:bn,stress:bs},v2:{normal:n2,stress:s2},v7:{normal:n7,stress:s7},deltas:{v7VsV64:{normal:delta(bn,n7),stress:delta(bs,s7)},v7VsV2:{normal:delta(n2,n7),stress:delta(s2,s7)}},recoveryV7:{normal:rec(v7N),stress:rec(v7S)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v7-final-cross.json"),JSON.stringify(result,null,2)+"\n","utf8");
  console.log("V7_FINAL_CROSS="+JSON.stringify(result));
'''
src=src[:start]+main+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V7_FINAL_CROSS={TARGET}')
