#!/usr/bin/env python3
"""Derive P10 PENGU original natural-ENTRY source synthetic runner from immutable P8B.

Pinned source PENGU files/STOP unchanged; only a research shadow exit hook
compares native original 157 cases without reoptimizing on them.
"""
import argparse,hashlib
from pathlib import Path
SOURCE_SHA256="b4d3844d6be7d3a324540dfafd5e1cfe91c799194f40b1bcf0ace545c23b92df"
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--source",type=Path,required=True)
 p.add_argument("--out",type=Path,required=True)
 a=p.parse_args()
 raw=a.source.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=SOURCE_SHA256:raise ValueError("SOURCE_P8B_CHANGED")
 s=raw.decode()
 def sub(old,new):
  nonlocal s
  if old not in s:raise ValueError("ANCHOR_NOT_FOUND:"+old[:90])
  s=s.replace(old,new,1)
 sub("import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';",
     "import {replayPinnedShortWithP10} from './prism7_p10_native_reversal_sentinel_core.mjs';")
 sub("const exit=replayPinnedShortExit({","const exit=replayPinnedShortWithP10({")
 sub("         evals,penguH1:pH1,entryIndex:i,entryTs,",
     "         evals,penguH1:pH1,btcH1:bH1,entryIndex:i,entryTs,")
 sub("        native_exitKind:exit.exitPriceKind??null,","        native_exitKind:exit.exitPriceKind??null,") if False else None
 sub("        native_exitReason:exit.exitReason??null,",
     "        native_exitReason:exit.exitReason??null,\n        researchP10Triggered:exit.researchP10Triggered??false,\n        researchP10Evidence:exit.p10Evidence??null,")
 begin=s.index("// Paired lifecycle economic parity against every original P8 natural signal.")
 end=s.index("const aggregate=[];",begin)
 block="""// P10 native original 157-case comparison, source natural ENTRY remains intact.
const priorOutput=process.env.PRISM_NATIVE_SYNTH_P8B_ORIGINAL;
if(!priorOutput)throw Error('P10_PRIOR_P8B_CASES_REQUIRED');
const oldCases=fs.readFileSync(priorOutput,'utf8').split(/\\r?\\n/).filter(Boolean).map(JSON.parse);
if(oldCases.length!==157||caseLedger.length!==157)
 throw Error('P10_SOURCE_CANDIDATE_COUNT_CHANGED');
const keyOf=x=>x.pathTag+'|'+x.signalHourIndex;
const byOld=new Map(oldCases.map(x=>[keyOf(x),x]));
if(byOld.size!==157)throw Error('P10_SOURCE_DUPLICATE_CANDIDATES');
let checked=0,activated=0,oldWinnersBecomeLosers=0,oldLosersBecomeWinners=0,
    unchangedSign=0,profitDifference=0,earlyExitNoPrintedNextHour=0,
    earlyExitDelayedNextHour=0;
for(const now of caseLedger){
  const old=byOld.get(keyOf(now));
  if(!old)throw Error('P10_SOURCE_CANDIDATE_NOT_IN_NATIVE_P8B');
  for(const field of ['entryTs','entryHourOpenPrice','source_mask_start_m5_index',
     'entryHourPositivePrint','firstPrintMinuteOffset']){
    if(now[field]!==old[field])throw Error('P10_SOURCE_ENTRY_NOT_IDENTICAL:'+field);
  }
  if(old.native_exit_status!=='NATIVE_EXIT_MODELED')
     throw Error('P10_OLD_NATIVE_NOT_CLOSED');
  if(now.native_exit_status!=='NATIVE_EXIT_MODELED')
     throw Error('P10_RESEARCH_EXIT_LEFT_CENSORED');
  // New shadow EXIT MUST not occur after native original exit, or modify native
  // outcome except an earlier observable new protective price-model action.
  if(now.native_exitTs>old.native_exitTs)
     throw Error('P10_RESEARCH_EXIT_LATER_THAN_NATIVE_SOURCE');
  if(now.native_exitTs===old.native_exitTs &&
     now.researchP10Triggered)
     throw Error('P10_NATIVE_EXIT_PRIORITY_BROKEN');
  if(now.native_exitTs===old.native_exitTs){
      if(now.native_exitReason!==old.native_exitReason||
         Math.abs(now.native_exitPrice-old.native_exitPrice)>1e-10)
        throw Error('P10_NATIVE_EXIT_PARITY_WHEN_NO_EARLY');
  }
  const pOrig=old.native_price_net30_pct,pNew=now.native_price_net30_pct;
  if(pOrig>0 && pNew<=0)oldWinnersBecomeLosers++;
  else if(pOrig<=0 && pNew>0)oldLosersBecomeWinners++;
  else unchangedSign++;
  profitDifference+=pNew-pOrig;
  if(now.researchP10Triggered){
    activated++;
    if(now.researchP10Evidence.nextH1PositivePrint===false)earlyExitNoPrintedNextHour++;
    else if(now.researchP10Evidence.nextH1HasImmediatePrint===false)
       earlyExitDelayedNextHour++;
  }
  checked++;
}
if(checked!==157)throw Error('P10_NOT_ALL_NATIVE_157_CHECKED');
const pairedVerification={
 sourceNaturalIntentsUnchanged:checked,
 researchP10EarlyExits:activated,
 oldNativeWinnersToNewLoss:oldWinnersBecomeLosers,
 oldNativeLosersToNewWin:oldLosersBecomeWinners,
 unchangedOutcomeSigns:unchangedSign,
 totalNet30ProfitPctPointDifference:profitDifference,
 earlyExitNoPrintedNextHour,earlyExitDelayedNextHour,
 originalNativeBaseline30bpsMeanPct:oldCases.reduce((a,x)=>a+x.native_price_net30_pct,0)/157,
 originalNativeBaseline30bpsWins:oldCases.filter(x=>x.native_price_net30_pct>0).length,
};
"""
 s=s[:begin]+block+s[end:]
 sub("schema:'prism7-p8b-paired-157-native-immutable-source-408h-384path/v1'",
     "schema:'prism7-p10-native-entry-unchanged-shadow-reversal-exit-384path/v1'")
 sub(" console.log('PRISM7_P8_PINNED_NATIVE_SYNTH_FINISHED'", " console.log('PRISM7_P10_RESEARCH_SHADOW_EXIT_COMPLETE'") if " console.log('PRISM7_P8_PINNED_NATIVE_SYNTH_FINISHED'" in s else sub("console.log('PRISM7_P8_PINNED_NATIVE_SYNTH_FINISHED'","console.log('PRISM7_P10_RESEARCH_SHADOW_EXIT_COMPLETE'")
 sub("  'Original 157 entries / 86 exits must match P8 by exact source timing and price.',",
     "  'Original 157 source entries and original price-model outcomes are compared unchanged.',")
 a.out.parent.mkdir(parents=True,exist_ok=True)
 a.out.write_text(s,encoding="utf-8")
 print("PRISM7_P10_DERIVED_SOURCE_HARNESS_PASS",len(s),hashlib.sha256(a.out.read_bytes()).hexdigest())
if __name__=="__main__":
 main()
