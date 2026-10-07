/* Read-only source Gate ablations. No order/executor imports. */
const fs=require('fs'),path=require('path'),Module=require('module'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'docs/research/results/all-gates-opportunity-20261008');
const ts=require('C:/Users/dis/-ai-dex-manager/node_modules/typescript');
const oldResolve=Module._resolveFilename;
Module._resolveFilename=function(r,p,...args){if(r.startsWith('@/'))r=path.join(ROOT,r.slice(2));return oldResolve.call(this,r,p,...args)};
require.extensions['.ts']=(m,f)=>{const s=fs.readFileSync(f,'utf8');m._compile(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)};
const load=f=>require(path.join(ROOT,f));
const v=load('lib/v12-x1-all.ts'),pg=load('lib/pengu-dual-ls-v2.ts'),rec=load('lib/pengu-recovery-v8.ts'),sv=load('lib/pengu-short-v20.ts');
const fet=load('lib/fet-brk48-signal.ts'),hype=load('lib/hype-trend-long-signal.ts'),idle=load('lib/idle-priority-short-signal.ts'),resid=load('lib/idle-residual-long-signal.ts');
const qs=load('lib/disdex-quality102-causal-v4-s34.ts'),qgate=load('lib/disdex-quality102-causal-selector.ts'),qm=load('config/disdexQuality102CausalV4Model.ts');
const configs={
 V12:load('config/v12X1AllRuntime.ts'),PENGU:load('config/penguDualLsV2Runtime.ts'),
 RECOVERY:load('config/penguRecoveryV8.ts'),FET:load('config/fetBrk48Runtime.ts'),HYPE:load('config/hypeTrendLongPolicy.ts'),
 IDLE:load('config/idlePriorityShortPolicy.ts'),RESIDUAL:load('config/idleResidualLongPolicy.ts')};
const originals={};for(const [k,m]of Object.entries(configs)){originals[k]={};for(const[n,x]of Object.entries(m))if(x&&typeof x==='object')originals[k][n]=structuredClone(x)}
const qoriginal={...qgate};
function reset(){for(const[k,objs]of Object.entries(originals))for(const[n,x]of Object.entries(objs))configs[k][n]=structuredClone(x);Object.assign(qgate,qoriginal)}
const H=3600000,START=Date.parse('2025-08-10T00:00:00Z'),END=Date.parse('2026-08-10T00:00:00Z'),DSTART=Date.parse('2026-10-06T15:00:00Z'),DEND=Date.parse('2026-10-07T15:00:00Z');
const DATA='C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines';
function candle(x){return{ts:+x.event_time_ms,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.base_volume,quoteVolume:+x.quote_volume}}
const annual={};for(const fn of fs.readdirSync(DATA).filter(f=>f.endsWith('.jsonl'))){annual[fn.slice(0,-6)]=fs.readFileSync(path.join(DATA,fn),'utf8').trim().split(/\r?\n/).map(l=>candle(JSON.parse(l)))}
const recent={};for(const[s,rs]of Object.entries(JSON.parse(fs.readFileSync(path.join(OUT,'live-inputs/recent-public-klines.json'))))){recent[s]=rs.map(x=>({ts:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],quoteVolume:+x[7]}))}
const livehist=JSON.parse(fs.readFileSync(path.join(OUT,'live-inputs/quality102-causal-v1__market-history.json')));
for(const[s,rs]of Object.entries(livehist.candlesBySymbol))if(!recent[s])recent[s]=rs.map(x=>({ts:x.timestampMs,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.baseVolume,quoteVolume:x.quoteVolume}));
function prepare(market){
 const maps={},h2={},h2maps={};for(const[s,rs]of Object.entries(market)){maps[s]=new Map(rs.map((x,i)=>[x.ts,{...x,i}]));h2[s]=v.resampleV12H1ToH2(rs.map(x=>({...x,closed:true})));h2maps[s]=new Map(h2[s].map((x,i)=>[x.endTs,{...x,i}]))}
 const pts=[...maps.PENGUUSDT.keys()].filter(t=>maps.BTCUSDT.has(t)).sort((a,b)=>a-b);
 const pc=pts.map(t=>({...maps.PENGUUSDT.get(t),openTime:t,closeTime:t+H-1})),bc=pts.map(t=>({...maps.BTCUSDT.get(t),openTime:t,closeTime:t+H-1}));
 const penguSeries=pg.buildPenguDualLsV2EvaluationSeries({pengu1h:pc,btc1h:bc},(pts.at(-1)||0)+H);
 const penguMap=new Map(penguSeries.filter(r=>r.features).map(r=>[r.features.referenceTs,r]));
 return{market,maps,h2,h2maps,penguSeries,penguMap};
}
reset();const contexts={ANNUAL:prepare(annual),RECENT:prepare(recent)};
if(contexts.ANNUAL.penguMap.size<1000||contexts.RECENT.penguMap.size<500)throw Error('PENGU_ADAPTER_FEATURES_MISSING');
function window(ctx,s,now,n=350){const row=ctx.maps[s]?.get(now-H);if(!row)return[];return ctx.market[s].slice(Math.max(0,row.i-n+1),row.i+1)}
function qrows(rs){return rs.map(x=>({timestampMs:x.ts,open:x.open,high:x.high,low:x.low,close:x.close,baseVolume:x.volume,quoteVolume:x.quoteVolume}))}
function candidate(s,side,now,entry,hold,stop,extra={}){return{symbol:s,side,entry_ts_ms:now,entry_price:entry,maxHoldHours:hold,hardStop:stop,...extra}}
function qdecision(ctx,now){
 if(new Date(now).getUTCHours()%4!==1)return {candidates:[],reason:'OFF_GRID'};
 let raw=[];for(const s of new Set(qm.QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))){const rs=window(ctx,s,now,350);const en=ctx.maps[s]?.get(now);if(rs.length<336||!en)continue;if(rs.some((x,i)=>i&&x.ts-rs[i-1].ts!==H))continue;
 raw.push(...qs.generateQuality102CausalV4S34Candidates({symbol:s,rows:qrows(rs),entryOpen:{timestampMs:now,open:en.open}}))}
 const layers={S3:1,S4:2},fams={BRK:1,PB:2,MR:3,REV:4};raw.sort((a,b)=>layers[a.layer]-layers[b.layer]||fams[a.family]-fams[b.family]||b.margin-a.margin||a.key.localeCompare(b.key));
 const x=raw[0];if(!x)return{candidates:[],reason:'NO_S34_SIGNAL'};
 if(!qgate.evaluateQuality102CausalV4ImprovementGate(x).accepted)return{candidates:[],reason:'REV_LONG_RET14_BELOW_24PCT',raw:x};
 if(x.family==='BRK'&&x.symbol==='FETUSDT'&&x.side===-1){const rs=window(ctx,'FETUSDT',now,74);if(rs.length>=73&&rs.at(-1).close/rs.at(-73).close-1<=-.12)return{candidates:[],reason:'BRK_FET_EXHAUSTION'};}
 return{candidates:[candidate(x.symbol,x.side===1?'LONG':'SHORT',now,ctx.maps[x.symbol].get(now).open,x.maxHoldHours,x.hardStop,{family:x.family,variant:x.variant})],reason:'SIGNAL'};
}
function generate(ctx,strategy,start,end){
 const signals=[],diagnostics=[],timing={};let pseries=ctx.penguSeries,short;
 if(strategy==='PENGU'){short=pg.evaluatePenguDualLsV2ShortSignals(pseries.map(r=>r.features),180)}
 for(let now=start;now<end;now+=H){
  let out=[],reason='NO_SIGNAL',detail=null;
  if(strategy==='V12'&&now%(2*H)===0){
   const b=ctx.h2maps.BTCUSDT.get(now);if(!b||b.i<120)continue;
   const bwindow=ctx.h2.BTCUSDT.slice(b.i-120,b.i+1);if(bwindow.some((x,i)=>i&&x.ts-bwindow[i-1].ts!==2*H))continue;
   const uni={BTC:bwindow};for(const s of configs.V12.V12_X1_ALL.universe){const rs=bwindow.map(x=>ctx.h2maps[s+'USDT']?.get(x.endTs));uni[s]=rs.every(Boolean)?rs:[]}
   out=v.buildV12Signals(uni,120).map(x=>{const bar=ctx.maps[x.symbol+'USDT']?.get(now);if(!bar)return null;return candidate(x.symbol+'USDT',x.side,now,bar.open,46,.08,{atr:x.atr,rank:x.rank,entryGrossMultiplier:x.entryGrossMultiplier})}).filter(Boolean);
   const ob=v.buildV12DecisionObservation(uni,120,now);reason=ob?.reason||'NO_DATA';detail=ob;
  } else if(strategy==='PENGU'){
   const row=ctx.penguMap.get(now-H);if(!row)continue;const i=row.index,f=row.features;
   const lng=pg.isPenguV8V64DynamicLongSignal(pseries,i),sho=short.signals[i];
   const rrow=row.recoveryV8?{...row.recoveryV8,ordinaryLongEligible:lng,ordinaryShortEligible:sho,baseLongSignal:lng}:undefined;
   const rd=pg.selectPenguRecoveryV8Entry(rrow,true);
   const route=sho?'SHORT_V20':lng?'BASE_V64_LONG':rd?.kind==='RECOVERY_V8'?'RECOVERY_V8':null;
   if(route){const en=ctx.maps.PENGUUSDT.get(now);if(en)out=[candidate('PENGUUSDT',sho?'SHORT':'LONG',now,en.open,sho?72:route==='RECOVERY_V8'?72:120,route==='RECOVERY_V8'?.06:.08,{route,features:f,recovery:rrow})]}
   reason=route||'NO_BASE_OR_RECOVERY_SIGNAL';detail={features:f,shortSetupActive:short.setupActive[i],shortSetupArmed:short.setupArmed[i],longEligible:lng,shortEligible:sho,recovery:rd?.reason};
  } else if(strategy==='FET'){
   const rs=window(ctx,'FETUSDT',now,74).map(x=>({...x,openTs:x.ts,closeTs:x.ts+H-1}));
   const sig=fet.buildFetBrk48Signal(rs,now);if(sig){const en=ctx.maps.FETUSDT.get(now);if(en)out=[candidate('FETUSDT','LONG',now,en.open,24,.05)]}
   const prev=rs.at(-1);detail={volumeRatio:prev?prev.volume/median(rs.slice(-73,-1).map(x=>x.volume)):null,return72h:rs.length>=73?prev.close/rs.at(-73).close-1:null};reason=out.length?'SIGNAL':'NO_BRK48_SIGNAL';
  } else if(strategy==='HYPE'){
   const rs=window(ctx,'HYPEUSDT',now,1000).map(x=>({...x,openTime:x.ts})),br=window(ctx,'BTCUSDT',now,1000).map(x=>({...x,openTime:x.ts}));
   const sig=hype.buildHypeTrendSignal({hype:rs,btc:br,now});if(sig.accepted){const en=ctx.maps.HYPEUSDT.get(now);if(en)out=[candidate('HYPEUSDT','LONG',now,en.open,168,null,{stopDistance:sig.stopDistance,trailingDistance:sig.trailingDistance})]}
   reason=sig.reason;detail=sig;
  } else if(strategy==='Q102'){const z=qdecision(ctx,now);out=z.candidates;reason=z.reason;detail=z.raw||null;
  } else if(strategy==='IDLE'||strategy==='RESIDUAL'){
   const syms=strategy==='IDLE'?Object.keys(configs.IDLE.IDLE_PRIORITY_SHORT_POLICY.routes):Object.keys(configs.RESIDUAL.IDLE_RESIDUAL_LONG_POLICY.routes);detail=[];
   for(const s of syms){let f;try{f=idle.computeIdlePriorityFeatures(now,window(ctx,s,now,80),window(ctx,'BTCUSDT',now,80))}catch{continue}
    const generic=idle.evaluateIdleGenericCandidate(f),z=strategy==='IDLE'?idle.evaluateIdlePriorityShort(s,f,generic):resid.evaluateIdleResidualLongFeatures(s,f);detail.push({symbol:s,features:f,generic:generic.reason,accepted:z.accepted,reason:z.reason});
    const en=ctx.maps[s]?.get(now);if(z.accepted&&en)out.push(candidate(s,strategy==='IDLE'?'SHORT':'LONG',now,en.open,z.holdHours,.10,{route:z.route,priority:z.priority||0,features:f,generic}));
   }reason=out.length?'SIGNAL':'NO_ROUTE_SIGNAL';
  }
  signals.push(...out);
  if(start===DSTART)diagnostics.push({now,strategy,reason,candidates:out,detail});
 }
 return{signals,diagnostics};
}
function median(a){if(!a.length)return NaN;a=[...a].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2}
function exitTrade(ctx,c,strategy){
 const sg=c.side==='LONG'?1:-1,entry=c.entry_price;let stop=strategy==='V12'?v.protectiveLevels(entry,c.atr,c.side).initialStop:c.stopDistance?entry-c.stopDistance:entry*(1-sg*c.hardStop),peak=entry;
 let position=null,partialReturn=0,remainingWeight=1;
 if(strategy==='PENGU'){const f=c.features;position={side:sg,entryPrice:entry,entryTs:c.entry_ts_ms,quantity:1,originalGross:1,entryVersion:c.route,highWaterMark:entry,lowWaterMark:entry,gross:1,entryAtr24Ratio:f.atr24Ratio};
  if(c.route==='SHORT_V20')position.shortV20=sv.createPenguShortV20State({entryPrice:entry,requestedGross:1,entryAtr24Ratio:f.atr24Ratio,btcEma168Distance:f.btcEma168Distance,btcReturn24h:f.btcReturn24h});
  if(c.route==='RECOVERY_V8')position.recoveryV8={version:'RECOVERY_V8',side:1,entryTs:c.entry_ts_ms,entryPrice:entry,highWaterMark:entry,quantity:1,originalQuantity:1,partialDefenseTriggered:false,remainingGross:.5,originalGross:.5,protectionLifecycle:'FULL_HARD_STOP'};
 }
 const events=[];let exit=null;
 for(let t=c.entry_ts_ms;t<c.entry_ts_ms+c.maxHoldHours*H;t+=H){
  const b=ctx.maps[c.symbol]?.get(t);if(!b)return null;
  let px=null,reason='TIME_EXIT';
  if(strategy==='PENGU'){
   const f=ctx.penguMap.get(t)?.features;if(!f)return null;
   try{
    if(c.route==='RECOVERY_V8'){
     const row=ctx.penguMap.get(t);const rr={...row.recoveryV8,...f,baseLongSignal:pg.isPenguV8V64DynamicLongSignal(ctx.penguSeries,row.index)};
     const z=rec.evaluateRecoveryV8PositionBar(position.recoveryV8,rr);
     if(z.events.includes('PARTIAL_DEFENSE')){partialReturn+=remainingWeight*.5*(-.04);remainingWeight*=.5;}
     position.recoveryV8=z.updatedPosition;
     if(['HARD_STOP','TRAILING_STOP','MAX_HOLD','YIELD_BASE_LONG'].includes(z.kind)){px=z.stopPrice||f.close;reason='RECOVERY_V8_'+z.kind}
    }else{const z=pg.evaluatePenguDualLsV2PositionBar(position,f);position=z.updatedPosition;if(z.exit){px=z.exit.stopPrice||f.close;reason=z.exit.reason}}
   }catch(e){throw new Error('PENGU_EXIT:'+e.message)}
  }else{
   if((sg===1&&b.low<=stop)||(sg===-1&&b.high>=stop)){px=sg===1?Math.min(stop,b.open):Math.max(stop,b.open);reason='STOP';}
   if(px===null&&strategy==='V12'){const tp=entry+sg*c.atr*configs.V12.V12_X1_ALL.takeProfitAtr;if((sg===1&&b.high>=tp)||(sg===-1&&b.low<=tp)){px=tp;reason='TAKE_PROFIT';}}
   if(px===null&&strategy==='FET'&&b.high>=entry*1.05)stop=Math.max(stop,entry*1.03);
   if(px===null&&strategy==='V12'&&(t+H)%(2*H)===0){
    const previous=ctx.maps[c.symbol].get(t-H);
    peak=sg===1?Math.max(peak,b.high,previous?.high||b.high):Math.min(peak,b.low,previous?.low||b.low);
    const nextStop=v.nextTrailingStop(c.side,stop,peak,c.atr*.20),next=ctx.maps[c.symbol].get(t+H);
    if(next&&((sg===1&&next.open<=nextStop)||(sg===-1&&next.open>=nextStop))){px=next.open;reason='TRAILING_CROSSED_BEFORE_REPLACEMENT';}
    stop=nextStop;
   }
   if(px===null&&strategy==='HYPE'){peak=Math.max(peak,b.high);stop=Math.max(stop,peak-c.trailingDistance)}
   if(px===null&&(strategy==='IDLE'||strategy==='RESIDUAL')){const tp=entry*(1+sg*.25);if((sg===1&&b.high>=tp)||(sg===-1&&b.low<=tp)){px=tp;reason='TAKE_PROFIT'}}
  }
  events.push({ts:t+H,mark_return:sg*(b.close/entry-1),mfe:sg===1?b.high/entry-1:1-b.low/entry,mae:sg===1?b.low/entry-1:1-b.high/entry});
  if(px!==null){if(!(px>0))throw Error('INVALID_EXIT:'+strategy+':'+JSON.stringify(position));exit={exit_ts_ms:t+H,exit_price:px,reason};break}
 }
 if(!exit){const t=c.entry_ts_ms+c.maxHoldHours*H,b=ctx.maps[c.symbol]?.get(t);if(!b)return null;exit={exit_ts_ms:t,exit_price:b.open,reason:'TIME_EXIT'}}
 return{...c,...exit,unit_gross_return:partialReturn+remainingWeight*sg*(exit.exit_price/entry-1),events};
}
function simulate(ctx,gen,strategy){
 const accepted=[],until=new Map(),active=[],sideLoss={LONG:0,SHORT:0},sideUntil={LONG:0,SHORT:0};let pgHold=0,pgRisk=1,pgPeak=1;const routeUntil={};let skipped=0;
 for(const c of gen.signals){
  for(let i=active.length-1;i>=0;i--)if(active[i].exit_ts_ms<=c.entry_ts_ms){const t=active.splice(i,1)[0],loss=t.unit_gross_return-.001<0;
    until.set(t.symbol,t.exit_ts_ms+(strategy==='FET'?24:strategy==='V12'?2:strategy==='PENGU'?(t.reason.includes('HARD_STOP')?24:6):strategy==='IDLE'?12:0)*H);
    if(strategy==='V12'){sideLoss[t.side]=loss?sideLoss[t.side]+1:0;if(sideLoss[t.side]>=6)sideUntil[t.side]=t.exit_ts_ms+6*H}
    if(strategy==='PENGU'){pgRisk*=1+t.unit_gross_return-.001;pgPeak=Math.max(pgPeak,pgRisk);if(pgRisk/pgPeak-1<=-.17)pgHold=t.exit_ts_ms+72*H;if(t.reason.includes('HARD_STOP'))routeUntil[t.route]=t.exit_ts_ms+60*H}
  }
  if(c.entry_ts_ms<(until.get(c.symbol)||0)||active.some(t=>t.symbol===c.symbol)||active.length>=(strategy==='V12'?3:1)||c.entry_ts_ms<sideUntil[c.side]||(strategy==='PENGU'&&(c.entry_ts_ms<pgHold||c.entry_ts_ms<(routeUntil[c.route]||0)))){skipped++;continue}
  const t=exitTrade(ctx,c,strategy);if(!t){skipped++;continue}accepted.push(t);active.push(t);
 }
 return {trades:accepted,skipped};
}
function metrics(trades,bps=10){
 const rets=trades.map(x=>x.unit_gross_return-bps/10000),wins=rets.filter(x=>x>0),losses=rets.filter(x=>x<0);let eq=1,peak=1,dd=0;
 for(const r of rets){eq*=1+r;peak=Math.max(peak,eq);dd=Math.min(dd,eq/peak-1)}
 const stats=xs=>{const rs=xs.map(x=>x.unit_gross_return-bps/10000);return{trades:rs.length,win_rate:rs.length?rs.filter(x=>x>0).length/rs.length:null,pf:rs.some(x=>x<0)?rs.filter(x=>x>0).reduce((a,b)=>a+b,0)/-rs.filter(x=>x<0).reduce((a,b)=>a+b,0):null,mean_net_return:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null}}
 const split=START+(END-START)/2;
 return{...stats(trades),win_days_jst:new Set(trades.map(x=>new Date(x.entry_ts_ms+9*H).toISOString().slice(0,10))).size,serial_unit_equity:eq,serial_realized_dd:dd,first:stats(trades.filter(x=>x.entry_ts_ms<split&&x.exit_ts_ms<split)),second:stats(trades.filter(x=>x.entry_ts_ms>=split))};
}
const variants=[
 ['V12','BASELINE',()=>{}],['V12','BTC_1P5',()=>configs.V12.V12_X1_ALL.regimeThresholdPct=.015],['V12','BTC_1P0',()=>configs.V12.V12_X1_ALL.regimeThresholdPct=.01],
 ['V12','BTC_0',()=>configs.V12.V12_X1_ALL.regimeThresholdPct=0],['V12','SCORE_085',()=>configs.V12.V12_X1_ALL.neutralScoreThreshold=.85],['V12','VOLUME_055',()=>configs.V12.V12_X1_ALL.minimumVolumeRatio=.55],['V12','MOMENTUM_018',()=>configs.V12.V12_X1_ALL.minimumMomentumPct=.018],
 ['V12','RELAXED_ATR10',()=>configs.V12.V12_X1_ALL.relaxedRegimeMinimumAtrRatio=.01],['V12','BTC1_ATR07_SCORE85',()=>{configs.V12.V12_X1_ALL.regimeThresholdPct=.01;configs.V12.V12_X1_ALL.relaxedRegimeMinimumAtrRatio=.007;configs.V12.V12_X1_ALL.strongRegimeQualityMinimumAtrRatio=.007;configs.V12.V12_X1_ALL.neutralScoreThreshold=.85}],['PENGU','BASELINE',()=>{}],['PENGU','BTC_DIST_M06',()=>configs.PENGU.PENGU_DUAL_LS_V2.short.btcEma168DistanceMinimum=-.06],['PENGU','BTC_MAX_06',()=>configs.PENGU.PENGU_DUAL_LS_V2.short.btcReturn24hMaximum=.06],
 ['PENGU','LONG_BTC_M01',()=>configs.PENGU.PENGU_DUAL_LS_V2.long.btcReturn24hMinimum=-.01],['PENGU','RECOVERY_BTC_0',()=>configs.RECOVERY.PENGU_RECOVERY_V8.thresholds.btcReturn6hMinPct=0],
 ['PENGU','SHORT_RSI25',()=>configs.PENGU.PENGU_DUAL_LS_V2.short.rsiMinimum=25],['PENGU','SHORT_VOL5',()=>configs.PENGU.PENGU_DUAL_LS_V2.short.volumeRatioMaximum=5],['PENGU','IMPULSE_M05',()=>configs.PENGU.PENGU_DUAL_LS_V2.short.impulseReturn24hMaximum=-.05],
 ['PENGU','RSI25_VOL7',()=>{configs.PENGU.PENGU_DUAL_LS_V2.short.rsiMinimum=25;configs.PENGU.PENGU_DUAL_LS_V2.short.volumeRatioMaximum=7}],['FET','BASELINE',()=>{}],['FET','VOLUME_10',()=>configs.FET.FET_BRK48_RESIDUAL.minimumVolumeRatio=1],['FET','RETURN72_0',()=>configs.FET.FET_BRK48_RESIDUAL.minimumReturn72h=0],['FET','GRID_1H',()=>{configs.FET.FET_BRK48_RESIDUAL.decisionEntryHourModulo=1;configs.FET.FET_BRK48_RESIDUAL.decisionEntryHourRemainder=0}],
 ['Q102','BASELINE',()=>{}],['Q102','REV_LONG_020',()=>qgate.evaluateQuality102CausalV4ImprovementGate=x=>({...qoriginal.evaluateQuality102CausalV4ImprovementGate(x),accepted:x.family!=='REV'||x.side!==1||x.ret14>=.20})],
 ['Q102','REV_LONG_OFF',()=>qgate.evaluateQuality102CausalV4ImprovementGate=x=>({accepted:true})],
 ['Q102','MARGIN_UPPER20',()=>qgate.evaluateQuality102CausalV4FeatureGate=x=>qoriginal.evaluateQuality102CausalV4FeatureGate({...x,margin:['MR','PB'].includes(x.family)&&x.margin>=1.7&&x.margin<2?1.69:x.margin})],
 ['Q102','RET14_WIDEN',()=>qgate.evaluateQuality102CausalV4FeatureGate=x=>qoriginal.evaluateQuality102CausalV4FeatureGate({...x,ret14:x.family==='REV'&&x.side*x.ret14>=.075&&x.side*x.ret14<.10?x.side*.10:x.ret14})],
 ['HYPE','BASELINE',()=>{}],['HYPE','SLOPE_50',()=>configs.HYPE.HYPE_TREND_LONG_POLICY.minimumRegimeSlopeBps=50],['HYPE','BREAKOUT_0',()=>configs.HYPE.HYPE_TREND_LONG_POLICY.minimumBreakoutBps=0],['HYPE','DISTANCE_1200',()=>configs.HYPE.HYPE_TREND_LONG_POLICY.maximumDistanceFromSlowEmaBps=1200],
 ['IDLE','BASELINE',()=>{}],['IDLE','DOT_BTC_01',()=>configs.IDLE.IDLE_PRIORITY_SHORT_POLICY.routes.DOTUSDT.btc24Max=.01],['IDLE','VOLUME_80PCT',()=>{for(const x of Object.values(configs.IDLE.IDLE_PRIORITY_SHORT_POLICY.generic))if(x&&typeof x==='object'&&'volumeRatioMin'in x)x.volumeRatioMin*=.8}],
 ['IDLE','RELATIVE_02',()=>configs.IDLE.IDLE_PRIORITY_SHORT_POLICY.generic.relative.rel24AbsMin=.02],['RESIDUAL','BASELINE',()=>{}],['RESIDUAL','RELATIVE_02',()=>{for(const x of Object.values(configs.RESIDUAL.IDLE_RESIDUAL_LONG_POLICY.routes))x.rel24Min=.02}],['RESIDUAL','VOLUME_80PCT',()=>{for(const x of Object.values(configs.RESIDUAL.IDLE_RESIDUAL_LONG_POLICY.routes))x.volumeRatioMin*=.8}],
];
const selected=process.argv.slice(2),results=[];fs.mkdirSync(path.join(OUT,'gate-cases'),{recursive:true});
for(const[strategy,name,patch]of variants){
 if(selected.length&&!selected.includes(strategy))continue;
 reset();patch();console.log('START',strategy,name);
 const a=generate(contexts.ANNUAL,strategy,START,END),d=generate(contexts.RECENT,strategy,DSTART,DEND),sim=simulate(contexts.ANNUAL,a,strategy);
 const result={strategy,name,scope:'SOURCE_ENTRY_H1_UNIT_RETURN_ISOLATED_SLEEVE_NOT_GLOBAL_BT',raw_candidate_count:a.signals.length,annual_candidates:a.signals,skipped:sim.skipped,metrics:[10,20,30].map(cost=>({cost_bps:cost,...metrics(sim.trades,cost)})),yesterday_candidates:d.signals,yesterday_diagnostics:d.diagnostics,trades:sim.trades};
 const file=path.join(OUT,'gate-cases',strategy+'_'+name+'.json');fs.writeFileSync(file,JSON.stringify(result));
 results.push({...result,trades:undefined,yesterday_diagnostics:undefined,yesterday_candidates:result.yesterday_candidates.map(x=>({symbol:x.symbol,side:x.side,entry_ts_ms:x.entry_ts_ms,route:x.route}))});
 fs.writeFileSync(path.join(OUT,'gate-summary-'+strategy+'.json'),JSON.stringify(results.filter(x=>x.strategy===strategy),null,2));
 console.log('RESULT',JSON.stringify({strategy,name,raw:a.signals.length,day:d.signals.length,metrics:result.metrics[0]}));
}
reset();
const sourceManifest=Object.keys(require.cache).filter(f=>f.startsWith(ROOT)&&f.endsWith('.ts')).map(f=>({path:path.relative(ROOT,f).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}));
fs.writeFileSync(path.join(OUT,'entry-source-manifest.json'),JSON.stringify(sourceManifest,null,2));
