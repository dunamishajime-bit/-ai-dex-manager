/* Pure V12 source dissection. No runners/executors/order imports. */
const fs=require('fs'),path=require('path'),Module=require('module');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'docs/research/results/v12-logic-dissection-20261008');
const ts=require('C:/Users/dis/-ai-dex-manager/node_modules/typescript');
const old=Module._resolveFilename;Module._resolveFilename=function(r,p,...a){if(r.startsWith('@/'))r=path.join(ROOT,r.slice(2));return old.call(this,r,p,...a)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const v=require(path.join(ROOT,'lib/v12-x1-all.ts')),cfg=require(path.join(ROOT,'config/v12X1AllRuntime.ts')),res=require(path.join(ROOT,'lib/v12-top2-residual.ts'));
const original=structuredClone(cfg.V12_X1_ALL),H=3600000;
const DATA='C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines';
const h2={},maps={},en={};for(const sym of original.universe.map(s=>s+'USDT')){
 const rows=fs.readFileSync(path.join(DATA,sym+'.jsonl'),'utf8').trim().split(/\r?\n/).map(l=>JSON.parse(l)).map(x=>({ts:+x.event_time_ms,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.base_volume,closed:true}));
 en[sym]=new Map(rows.map(x=>[x.ts,x]));h2[sym]=v.resampleV12H1ToH2(rows);maps[sym]=new Map(h2[sym].map((x,i)=>[x.endTs,{...x,i}]));
}
const variants={BASELINE:{},MOM12:{momentumBars:6},MOM24:{momentumBars:12},BTC24:{btcRegimeSmaBars:12,btcRegimeMomentumBars:12},BTC12:{btcRegimeSmaBars:6,btcRegimeMomentumBars:6},BREAKOUT36:{}};
fs.mkdirSync(path.join(OUT,'source-candidates'),{recursive:true});
for(const[name,patch]of Object.entries(variants)){
 cfg.V12_X1_ALL={...original,...patch};const out=[];
 for(let now=Date.parse('2025-08-10');now<Date.parse('2026-08-10');now+=2*H){
  const b=maps.BTCUSDT.get(now);if(!b||b.i<120)continue;
  const br=h2.BTCUSDT.slice(b.i-120,b.i+1);if(br.some((x,i)=>i&&x.ts-br[i-1].ts!==2*H))continue;
  const uni={BTC:br};for(const sym of original.universe){const rs=br.map(x=>maps[sym+'USDT'].get(x.endTs));uni[sym]=rs.every(Boolean)?rs:[]}
  for(const s of v.buildV12Signals(uni,120)){
   const sym=s.symbol+'USDT',entry=en[sym].get(now);if(!entry)continue;
   const bars=uni[s.symbol],f=v.buildV12WinRateGateFeatures(uni,120,s),ob=v.buildV12DecisionObservation(uni,120,now);
   if(name==='BREAKOUT36'){
    const prev=bars.slice(120-original.breakoutBars,120),cur=bars[120];
    if(s.side==='LONG'?cur.close<Math.max(...prev.map(x=>x.high))*(1+original.breakoutBufferPct):cur.close>Math.min(...prev.map(x=>x.low))*(1-original.breakoutBufferPct))continue;
   }
   const requested=Math.min(v.sizeV12Position(1,entry.open,s.atr,s.side).requestedGross*v.v12EntryGrossMultiplierForSignal(s),v.v12EntryGrossCapForSignal(s));
   const gross=res.decideV12ResidualEntry(requested,{v12Gross:0,cryptoGross:0,stockGross:0,totalGross:0},0).acceptedGross;
   out.push({symbol:sym,side:s.side,entry_ts_ms:now,entry_price:entry.open,atr:s.atr,rank:s.rank,requested_gross:gross,maxHoldHours:46,...Object.fromEntries(['momentum','score','volatility','volumeRatio','regime','entryQualityClass','entryGrossMultiplier','entryGateReason'].map(k=>[k,s[k]])),entry_features:f});
  }
 }
 fs.writeFileSync(path.join(OUT,'source-candidates',name+'.jsonl'),out.map(x=>JSON.stringify(x)).join('\n')+'\n');
 console.log(name,out.length);
}
fs.writeFileSync(path.join(OUT,'source-protocol.json'),JSON.stringify({variants,sourceFiles:['lib/v12-x1-all.ts','config/v12X1AllRuntime.ts','lib/v12-top2-residual.ts'],closedInputs:true,ordersSent:false,note:'BREAKOUT36 is an explicit added use of previously unused configured breakoutBars/buffer; others modify ONE signal component.'},null,2));
