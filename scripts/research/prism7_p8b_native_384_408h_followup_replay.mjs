/**
 * PRISM VII P8: immutable pinned PENGU native SHORT V20 signal and EXIT
 * on source-profile clustered synthetic 336H M5 market paths.
 *
 * Only 72H of entry evaluation after 264H of strictly prior warm-up.
 * All 4×8×12=384 paths, same printed/unprinted mask cohorts as P7.
 * SOURCE-PINNED pure functions, not simulated signed fills or portfolio.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';

const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const H=3600000,M5=300000;
const WARMUP_H=264,EVAL_H=72,FOLLOWUP_H=72,ALL_H=WARMUP_H+EVAL_H+FOLLOWUP_H;
const P8_PREFIX_N=(WARMUP_H+EVAL_H)*12;
const T0=1800000000000,TEND=T0+ALL_H*H;
const N=ALL_H*12;
const REGIMES=[
 'PERSISTENT_DOWN','PERSISTENT_UP','SIDEWAYS','DOWN_THEN_SQUEEZE',
 'UP_THEN_DUMP','HIGH_VOL_CHOP','ILLIQUID_ZERO_PRINT','BTC_PENGU_DIVERGENCE'
];
const SEEDS=Array.from({length:12},(_,i)=>2026112280+i);
const PROFILES=[
 {id:'PRE_20250801_20250924',part:'prebaseline_public_20250801_20250924',file:'PENGUUSDT-5m-20250801-20250924.jsonl.gz'},
 {id:'MAIN_PREFIX_20250924_20260803',part:'@bt/aster-public-v3-5m-prefix',file:'PENGUUSDT-5m-20250924-20260803.jsonl.gz'},
 {id:'MAIN_SUFFIX_20260803_20261001',part:'@bt/aster-public-v3-5m-suffix',file:'PENGUUSDT-5m-20260803-20261001.jsonl.gz'},
 {id:'POST_20261001_20261118',part:'forward_public_20261001_20261118',file:'PENGUUSDT-5m-20261001-20261118.jsonl.gz'},
];
const work=process.env.PRISM_NATIVE_WORK,bt=process.env.PRISM_NATIVE_ROOT,
 out=process.env.PRISM_NATIVE_SYNTH_OUTPUT;
if(!work||!bt||!out)throw Error('P8_ENV_ROOT_WORK_OUTPUT_REQUIRED');

const prior=JSON.parse(fs.readFileSync(path.join(work,'results',
 'PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122.json'),'utf8'));
if(prior.sourcePinnedRuntimeSha!==PIN||
   prior.matchedSourceNativeShortExits!==53||
   prior.entryAndExitParity!=='PASS_53_53'||
   prior.pinnedNativeCandidateCoverage!=='PASS_53_53_IN_SOURCE_OWN_ENTRY_PERIOD'||
   prior.sharedNativeExitCoreParity!=='PASS_53_53')
   throw Error('PRECONDITION_NATIVE53_53_SHARED_EXIT_PARITY_REQUIRED');

function uintSeed(...args){
  const str=args.join('|');
  return crypto.createHash('sha256').update(str).digest().readUInt32BE(0);
}
function rng(seed){
 let a=seed>>>0,spare=null;
 const uniform=()=>{
  a=(a+0x6D2B79F5)|0;
  let t=Math.imul(a^(a>>>15),1|a);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
 };
 const normal=()=>{
  if(spare!==null){const ret=spare;spare=null;return ret;}
  const u=Math.max(1e-12,uniform()),v=uniform();
  const s=Math.sqrt(-2*Math.log(u));
  spare=s*Math.sin(2*Math.PI*v);
  return s*Math.cos(2*Math.PI*v);
 };
 return {uniform,normal,int:max=>Math.floor(uniform()*max)};
}
function maskSource(profile){
 const fn=profile.part.startsWith('@bt/')
   ?path.join(bt,profile.part.slice(4),profile.file)
   :path.join(work,profile.part,profile.file);
 const raw=fs.readFileSync(fn);
 const sha256=crypto.createHash('sha256').update(raw).digest('hex');
 const text=zlib.gunzipSync(raw).toString('utf8').trim();
 const flags=text.split(/\r?\n/).filter(Boolean).map(line=>{
   const a=JSON.parse(line);
   return Number(a[5])>0;
 });
 if(flags.length<N+12 || flags.length%12!==0)throw Error('SOURCE_MASK_INSUFFICIENT:'+profile.id);
 return {flags,sha256,filename:path.basename(fn)};
}
function maskSelection(profile,flags,regime,seed){
 const random=rng(uintSeed('P8_LIQ_MASK',profile,regime,seed));
 const start=random.int(Math.floor((flags.length-P8_PREFIX_N)/12)+1)*12;
 const mask=Array.from({length:N},(_,i)=>flags[(start+i)%flags.length]);
 if(mask.length!==N)throw Error('MASK_LENGTH_FAIL');
 return {mask,start,wrapped:start+N>flags.length};
}
function priceDynamics(regime,entryIndex){
 const h=entryIndex/12;
 switch(regime){
 case 'PERSISTENT_DOWN':return [-.00027,-.00009,.0028,.0014];
 case 'PERSISTENT_UP':return [.00027,.00008,.0028,.0014];
 case 'SIDEWAYS':return [0,0,.0038,.0017];
 case 'DOWN_THEN_SQUEEZE':return [h<30?-.00030:.00042,h<30?-.00008:.00015,.0035,.0017];
 case 'UP_THEN_DUMP':return [h<35?.00027:-.00048,h<35?.00010:-.00018,.0034,.0018];
 case 'HIGH_VOL_CHOP':return [Math.floor(h/8)%2?.00035:-.00035,0,.0080,.0035];
 case 'ILLIQUID_ZERO_PRINT':return [-.00005,-.00002,.0045,.0022];
 case 'BTC_PENGU_DIVERGENCE':return [.00021,-.00017,.0032,.0019];
 default:throw Error('INVALID_REGIME:'+regime);
 }
}
function buildMarket(mask,regime,profile,seed){
 const random=rng(uintSeed('P8_PRICE',profile,regime,seed));
 let pLatent=1,pPrinted=1,bLatent=100000,maxZeroRun=0,currentZeroRun=0;
 const pH1=[],bH1=[];
 let totalNoPrint=0,emptyH=0;
 for(let h=0;h<ALL_H;h++){
   let po=null,ph=-Infinity,pl=Infinity,pc=null,pvol=0,pfirst=null,
       bo=null,bh=-Infinity,bl=Infinity,bc=null,bvol=0;
   const start=T0+h*H;
   for(let j=0;j<12;j++){
     const i=h*12+j;
     const relative=i-WARMUP_H*12;
     const warm=relative<0;
     const [pDrift,bDrift,pSig,bSig]=warm?[0,0,.0038,.0017]:priceDynamics(regime,relative);
     const zb=random.normal(),zp=random.normal();
     let pRet=pDrift+pSig*(.4*zb+.92*zp);
     const bRet=bDrift+bSig*zb;
     if(!warm){
       if(regime==='DOWN_THEN_SQUEEZE'&&relative===30*12)pRet+=.025;
       if(regime==='UP_THEN_DUMP'&&relative===35*12)pRet-=.035;
       if(regime==='HIGH_VOL_CHOP'&&relative%100===50)
         pRet+=(Math.floor(relative/100)%2?.025:-.025);
     }
     const pOld=pLatent,bOld=bLatent;
     pLatent*=Math.exp(pRet);
     bLatent*=Math.exp(bRet);
     const printed=mask[i];
     if(printed){
       const upper=Math.max(pOld,pLatent)*(1+Math.abs(random.normal())*pSig*.30);
       const lower=Math.min(pOld,pLatent)*(1-Math.abs(random.normal())*pSig*.30);
       if(!(lower>0&&lower<=Math.min(pOld,pLatent)&&upper>=Math.max(pOld,pLatent)))
          throw Error('PENGU_OHLC_INVALID');
       if(po===null){po=pOld;pfirst=j;}
       ph=Math.max(ph,upper);pl=Math.min(pl,lower);pc=pLatent;
       pvol+=Math.max(1,Math.floor(Math.exp(12+.7*random.normal())));
       pPrinted=pLatent;
       if(currentZeroRun>maxZeroRun)maxZeroRun=currentZeroRun;
       currentZeroRun=0;
     }else{
       totalNoPrint++;currentZeroRun++;
     }
     const btcUpper=Math.max(bOld,bLatent)*(1+Math.abs(random.normal())*bSig*.25);
     const btcLower=Math.min(bOld,bLatent)*(1-Math.abs(random.normal())*bSig*.25);
     if(bo===null)bo=bOld;
     bh=Math.max(bh,btcUpper);bl=Math.min(bl,btcLower);bc=bLatent;
     bvol+=Math.max(1,Math.floor(Math.exp(14+.3*random.normal())));
   }
   if(po===null){emptyH++;po=ph=pl=pc=pPrinted;pfirst=null;}
   if(!(pl>0&&pl<=Math.min(po,pc)&&ph>=Math.max(po,pc)&&
        bl>0&&bl<=Math.min(bo,bc)&&bh>=Math.max(bo,bc)))throw Error('H1_OHLC_WRONG');
   pH1.push({openTime:start,closeTime:start+H-1,open:po,high:ph,
       low:pl,close:pc,volume:pvol,positivePrintInHour:pvol>0,
       firstPrintMinuteOffset:pfirst===null?null:pfirst*5});
   bH1.push({openTime:start,closeTime:start+H-1,open:bo,high:bh,
       low:bl,close:bc,volume:bvol});
 }
 if(currentZeroRun>maxZeroRun)maxZeroRun=currentZeroRun;
 if(pH1.length!==ALL_H||bH1.length!==ALL_H)
   throw Error('SYNTH_H1_WRONG_LENGTH');
 for(let i=0;i<ALL_H;i++){
   const expected=(mask.slice(i*12,(i+1)*12).some(Boolean));
   if(expected!==(pH1[i].volume>0))throw Error('SYNTH_PRINT_MASK_H1_MISMATCH');
   if(pH1[i].openTime!==bH1[i].openTime)throw Error('PENGU_BTC_H1_TIME_MISMATCH');
   if(i>0&&pH1[i].openTime-pH1[i-1].openTime!==H)
     throw Error('SYNTH_H1_GAP');
 }
 return {pH1,bH1,noPrintM5:totalNoPrint,emptyH1:emptyH,
     maxZeroRun,priceRngId:uintSeed('P8_PRICE',profile,regime,seed)};
}
function testPrefixInvariance(p,b,all,profile,regime,seed){
 const decisionIndex=WARMUP_H+36;
 const endDecision=T0+decisionIndex*H;
 const before=all[decisionIndex-1];
 const cut=buildPenguDualLsV2EvaluationSeries({
    pengu1h:p.slice(0,decisionIndex),
    btc1h:b.slice(0,decisionIndex),penguFunding:[]
 },endDecision);
 const after=cut[decisionIndex-1];
 if(!before||!after||
     before.shortSignal!==after.shortSignal||
     !before.features||!after.features)
     throw Error('NATIVE_CAUSAL_SIGNAL_PREFIX_FAILED:'+profile+':'+regime);
 for(const k of ['referenceTs','atr24Ratio','penguReturn24h','btcReturn24h']){
    if(Math.abs(before.features[k]-after.features[k])>1e-10)
      throw Error('NATIVE_CAUSAL_FEATURE_PREFIX_FAILED:'+profile+':'+regime+':'+k);
 }
 return true;
}
function metric(rows){
 const v=rows.map(x=>x.net_pct);
 const w=v.filter(x=>x>0);
 const good=w.reduce((a,x)=>a+x,0);
 const bad=-v.filter(x=>x<0).reduce((a,x)=>a+x,0);
 return {n:v.length,wins:w.length,
   winrate_pct:v.length?100*w.length/v.length:null,
   mean_net_pct:v.length?v.reduce((a,x)=>a+x,0)/v.length:null,
   price_pf:bad>0?good/bad:null,
   max_loss_pct:v.length?Math.min(...v):null};
}
const caseLedger=[],pathLedger=[],inputHashes={};
let prefixChecks=0;
for(const profile of PROFILES){
 const source=maskSource(profile);inputHashes[profile.id]={
     input_gzip_sha256:source.sha256,input_file:source.filename,
     available_source_m5:source.flags.length};
 for(const regime of REGIMES){
  for(const seed of SEEDS){
   const {mask,start,wrapped}=maskSelection(profile.id,source.flags,regime,seed);
   const market=buildMarket(mask,regime,profile.id,seed);
   const {pH1,bH1}=market;
   const evals=buildPenguDualLsV2EvaluationSeries({
       pengu1h:pH1,btc1h:bH1,penguFunding:[],
   },TEND);
   if(evals.length!==ALL_H)throw Error('NATIVE_EVAL_WRONG_LENGTH');
   if(seed===SEEDS[0]){
      if(!testPrefixInvariance(pH1,bH1,evals,profile.id,regime,seed))
          throw Error('PREFIX_ASSERT_FAIL');
      prefixChecks++;
   }
   const pathTag=profile.id+'|'+regime+'|'+seed;
   let sourceShort=0,complete=0,censored=0,
       entryNoPrintedH1=0,entryDelayedPrint=0,
       hardStopModeled=0,trailStopModeled=0,nonresidentModeled=0;
   for(let i=WARMUP_H;i<WARMUP_H+EVAL_H;i++){
      const signal=evals[i-1];
      if(!signal?.features || !signal.shortSignal)continue;
      const entryTs=T0+i*H,open=pH1[i];
      if(signal.features.referenceTs!==entryTs-H)
          throw Error('NATIVE_SIGNAL_REFERENCETS_MISMATCH:'+pathTag);
      sourceShort++;
      const sourcePrint=open.positivePrintInHour;
      if(!sourcePrint)entryNoPrintedH1++;
      if(sourcePrint&&open.firstPrintMinuteOffset!==0)entryDelayedPrint++;
      const exit=replayPinnedShortExit({
         evals,penguH1:pH1,entryIndex:i,entryTs,
         entryPrice:open.open,requestedGross:1,exitHorizonTs:TEND,
      });
      if(exit.status!=='NATIVE_EXIT_MODELED'&&
         !exit.status.startsWith('RIGHT_CENSORED'))
         throw Error('UNEXPECTED_NATIVE_EXIT_STATUS');
      const row={
        pathTag,mask_profile:profile.id,price_regime:regime,seed,
        source_mask_start_m5_index:start,
        signalHourIndex:i,entryTs,entryHourOpenPrice:open.open,
        entryHourPositivePrint:sourcePrint,
        firstPrintMinuteOffset:open.firstPrintMinuteOffset,
        native_gross:1,
        native_exit_status:exit.status,
        native_exitTs:exit.exitTs??null,
        native_exitPrice:exit.exitPrice??null,
        native_exitReason:exit.exitReason??null,
        native_exitPriceKind:exit.exitPriceKind??null,
        native_price_net10_pct:null,native_price_net30_pct:null,
        venue_signed_fill:false,actual_executable_fill_proven:false,
      };
      if(exit.status==='NATIVE_EXIT_MODELED'){
         complete++;
         const grossPct=100*(1-exit.exitPrice/open.open);
         row.native_price_net10_pct=grossPct-.10;
         row.native_price_net30_pct=grossPct-.30;
         if(exit.exitReason.includes('HARD_STOP'))hardStopModeled++;
         else if(exit.exitReason.includes('TRAILING_STOP'))trailStopModeled++;
         else nonresidentModeled++;
      }else censored++;
      caseLedger.push(row);
   }
   const pathRow={
       mask_profile:profile.id,regime,seed,
       source_mask_start_m5_index:start,
       maskWrappedToSourceBeginning:wrapped,
       evaluationHours:EVAL_H,warmupHours:WARMUP_H,followupHours:FOLLOWUP_H,
       sourceNaturalShortSignals:sourceShort,completeNativeExits:complete,
       rightCensoredNativeExits:censored,
       h1EntryWithoutPositivePrint:entryNoPrintedH1,
       entryFirstPositivePrintNotAtHourStart:entryDelayedPrint,
       modelHardStops:hardStopModeled,modelTrailingStops:trailStopModeled,
       modelOtherExits:nonresidentModeled,
       zeroVolumeM5:market.noPrintM5,emptyH1:market.emptyH1,
       longestZeroM5Run:market.maxZeroRun,
       priceRngSeed32:market.priceRngId,
   };
   if(complete+censored!==sourceShort)throw Error('SOURCE_SHORT_CANDIDATE_ACCOUNTING_FAIL');
   pathLedger.push(pathRow);
   if(sourceShort>100)throw Error('UNEXPECTED_SYNTH_NATIVE_SHORT_SIGNAL_FLOOD');
  }
 }
}
if(pathLedger.length!==384||prefixChecks!==4*8)
   throw Error('INCOMPLETE_P8_SYNTHETIC_GRID');
// Paired lifecycle economic parity against every original P8 natural signal.
const priorOutput=process.env.PRISM_NATIVE_SYNTH_P8_ORIGINAL;
if(!priorOutput)throw Error('P8B_PRIOR_336H_CASES_REQUIRED');
const oldCases=fs.readFileSync(priorOutput,'utf8')
   .split(/\r?\n/).filter(Boolean).map(JSON.parse);
if(oldCases.length!==157||caseLedger.length!==157)
  throw Error('P8B_157_NATIVE_PAIRING_COUNT_CHANGED');
const keyOf=x=>x.pathTag+'|'+x.signalHourIndex;
const byOld=new Map(oldCases.map(x=>[keyOf(x),x]));
if(byOld.size!==157)throw Error('P8B_ORIGINAL_DUPLICATE_ENTRY_KEYS');
let matchedNativeEntries=0,matchedOldExits=0,censoredRecovered=0;
for(const now of caseLedger){
 const old=byOld.get(keyOf(now));
 if(!old)throw Error('P8B_NEW_NATIVE_ENTRY_NOT_IN_P8:'+keyOf(now));
 if(now.entryTs!==old.entryTs||
   now.source_mask_start_m5_index!==old.source_mask_start_m5_index||
   Math.abs(now.entryHourOpenPrice-old.entryHourOpenPrice)>1e-12||
   now.entryHourPositivePrint!==old.entryHourPositivePrint||
   now.firstPrintMinuteOffset!==old.firstPrintMinuteOffset)
   throw Error('P8B_336H_ORIGINAL_ENTRY_NOT_IDENTICAL:'+keyOf(now));
 matchedNativeEntries++;
 if(old.native_exit_status==='NATIVE_EXIT_MODELED'){
   if(now.native_exit_status!=='NATIVE_EXIT_MODELED'||
       now.native_exitTs!==old.native_exitTs||
       now.native_exitReason!==old.native_exitReason||
       Math.abs(now.native_exitPrice-old.native_exitPrice)>1e-10||
       now.native_exitPriceKind!==old.native_exitPriceKind)
     throw Error('P8B_336H_OLD_NATIVE_EXIT_NOT_IDENTICAL:'+keyOf(now));
   matchedOldExits++;
 }else if(now.native_exit_status==='NATIVE_EXIT_MODELED'){
   censoredRecovered++;
 }
}
if(matchedNativeEntries!==157||matchedOldExits!==86)
 throw Error('P8B_SOURCE_PAIRING_157_86_FAIL');
const pairedVerification={
   old336HSourceSignals:157,
   matchedUnchangedEntries:matchedNativeEntries,
   old336HNativeClosed:86,
   matchedUnchangedOldExits:matchedOldExits,
   old336HRightCensored:71,
   recoveredFromPreviousCensoring:censoredRecovered,
};
const aggregate=[];
for(const profile of PROFILES){
 for(const regime of REGIMES){
  const p=pathLedger.filter(x=>x.mask_profile===profile.id&&x.regime===regime);
  const cases=caseLedger.filter(x=>x.mask_profile===profile.id&&x.price_regime===regime);
  const valid=cases.filter(x=>x.native_exit_status==='NATIVE_EXIT_MODELED');
  for(const feeBps of [10,30]){
   const pnl=valid.map(x=>({
       net_pct:feeBps===10?x.native_price_net10_pct:x.native_price_net30_pct,
   }));
   aggregate.push({
      mask_profile:profile.id,regime,costBps:feeBps,
      paths:p.length,naturalSignals:cases.length,
      completedExits:valid.length,rightCensored:cases.length-valid.length,
      entryNoPositivePrint:cases.filter(x=>!x.entryHourPositivePrint).length,
      entryDelayedFirstPrint:cases.filter(x=>x.entryHourPositivePrint&&x.firstPrintMinuteOffset!==0).length,
      ...metric(pnl),
      source_native_execution_model:true,venue_signed_fills:0,
   });
  }
 }
}
const global=[];
for(const feeBps of [10,30]){
  const valid=caseLedger.filter(x=>x.native_exit_status==='NATIVE_EXIT_MODELED');
  global.push({costBps:feeBps,naturalSignals:caseLedger.length,
      completedExits:valid.length,rightCensored:caseLedger.length-valid.length,
      pathsWithoutAnySignal:pathLedger.filter(x=>x.sourceNaturalShortSignals===0).length,
      ...metric(valid.map(x=>({net_pct:feeBps===10?x.native_price_net10_pct:x.native_price_net30_pct}))),
  });
}
const report={
 schema:'prism7-p8b-paired-157-native-immutable-source-408h-384path/v1',
 pinnedRuntimeSha:PIN,
 originalNative53SignalAndExitParity:'PASS_53_53',
 sharedNativeShortExitCoreParity:'PASS_53_53',
 syntheticPaths:384,prefixNativeFeatureChecks:prefixChecks,
 warmupH:WARMUP_H,evaluationH:EVAL_H,followupH:FOLLOWUP_H,
 pairedVerification,
 sourceMaskEndWrapPaths:pathLedger.filter(x=>x.maskWrappedToSourceBeginning).length,
 metricsNonwrapped30bps:metric(caseLedger.filter(x=>{
   const p=pathLedger.find(z=>z.mask_profile===x.mask_profile&&
         z.regime===x.price_regime&&z.seed===x.seed);
   return p&&!p.maskWrappedToSourceBeginning&&
         x.native_exit_status==='NATIVE_EXIT_MODELED';
 }).map(x=>({net_pct:x.native_price_net30_pct}))),
 metricsWrapped30bps:metric(caseLedger.filter(x=>{
   const p=pathLedger.find(z=>z.mask_profile===x.mask_profile&&
         z.regime===x.price_regime&&z.seed===x.seed);
   return p&&p.maskWrappedToSourceBeginning&&
         x.native_exit_status==='NATIVE_EXIT_MODELED';
 }).map(x=>({net_pct:x.native_price_net30_pct}))),
 marketConstruction:'4 SOURCE PRINT MASKS x 8 FIXED SYNTHETIC PRICE REGIMES x 12 FIXED SEEDS',
 h1Construction:'M5 POSITIVE PRINT RANGES; EMPTY H1 ZERO VOLUME LAST_PRINT PLACEHOLDER',
 sourceMaskInputs:inputHashes,
 metricsAll:global,metricsByMaskAndRegime:aggregate,
 limitations:[
  'P8B follows the identical P8 source natural SHORT candidates for 72h longer; only the 72h entry window emits candidates.',
  '20 of 384 source print-mask paths may wrap around source file boundary, a synthetic seam; separate sensitivity presented.',
  'Original 157 entries / 86 exits must match P8 by exact source timing and price.',
  'H1 OPEN natural source entry is a price model, not a signed venue fill.',
  'Empty H1 is a zero-volume last-print placeholder; source pure engine may signal through it.',
  'An entry hour with first print later than start has unproven execution at H1 opening price.',
  'Pinned resident STOP outputs configured STOP price even if gaps or liquidity would change realized fills.',
  'All natural signals include potentially overlapping standalone positions; no owner admission/cooldown/shared gross.',
  'Source price-mask input is observed historically; synthetic price is stylized and has no external OOS validation.',
  'Right-censored positions are excluded from completed-trade win/PF metrics, not assigned 0 or wins.',
  'No funding, 5m entry order queue, realistic slippage, concurrent Runner PnL or max account DD.',
 ],
};
const base=path.dirname(out);
fs.mkdirSync(base,{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const casesFile=out.replace('.json','_CASES.jsonl');
fs.writeFileSync(casesFile,caseLedger.map(x=>JSON.stringify(x)).join('\n')+'\n');
const pathsFile=out.replace('.json','_PATHS.jsonl');
fs.writeFileSync(pathsFile,pathLedger.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log('PRISM7_P8_PINNED_NATIVE_SYNTH_FINISHED',JSON.stringify({
  syntheticPaths:384,sourceShorts:caseLedger.length,
  complete:global[0].completedExits,censored:global[0].rightCensored,
  prefix:prefixChecks,fee10:global[0],fee30:global[1],
}));
console.log('RESULT',out);
