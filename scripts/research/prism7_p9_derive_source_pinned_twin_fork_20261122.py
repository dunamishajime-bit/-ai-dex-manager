#!/usr/bin/env python3
"""Deterministically derive P9 two-futures twin fork source from fixed P8B.

Only research harness price regimen and observation window differ; immutable
pinned native source imports and STOP pure functions remain unchanged.
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path

SOURCE_SHA256="b4d3844d6be7d3a324540dfafd5e1cfe91c799194f40b1bcf0ace545c23b92df"

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    a=p.parse_args()
    data=a.source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=SOURCE_SHA256:
        raise ValueError("P8B_SOURCE_SHA_CHANGED_FAIL_CLOSED")
    s=data.decode("utf-8")
    def rep(old,new):
        nonlocal s
        if old not in s:
            raise ValueError("PATCH_ANCHOR_MISSING:"+old[:100])
        s=s.replace(old,new,1)
    rep("const WARMUP_H=264,EVAL_H=72,FOLLOWUP_H=72,ALL_H=WARMUP_H+EVAL_H+FOLLOWUP_H;",
        "const WARMUP_H=264,EVAL_H=30,FOLLOWUP_H=72,ALL_H=WARMUP_H+EVAL_H+FOLLOWUP_H;")
    rep("const P8_PREFIX_N=(WARMUP_H+EVAL_H)*12;",
        "const P8_PREFIX_N=ALL_H*12;")
    start=s.index("const REGIMES=[")
    end=s.index("];",start)
    s=s[:start]+"const REGIMES=['TWIN_DOWN_CONTINUES','TWIN_SQUEEZE'];"+s[end+2:]
    rep("const SEEDS=Array.from({length:12},(_,i)=>2026112280+i);",
        "const SEEDS=Array.from({length:24},(_,i)=>2026112300+i);")
    rep("rng(uintSeed('P8_LIQ_MASK',profile,regime,seed))",
        "rng(uintSeed('P9_TWIN_MASK',profile,'TWIN_COMMON',seed))")
    rep("rng(uintSeed('P8_PRICE',profile,regime,seed))",
        "rng(uintSeed('P9_TWIN_PRICE',profile,'TWIN_COMMON',seed))")
    rep("priceRngId:uintSeed('P8_PRICE',profile,regime,seed)",
        "priceRngId:uintSeed('P9_TWIN_PRICE',profile,'TWIN_COMMON',seed)")
    start=s.index("function priceDynamics(regime,entryIndex){")
    end=s.index("function buildMarket(mask,regime,profile,seed){",start)
    new_drift="""function priceDynamics(regime,entryIndex){
 const h=entryIndex/12;
 if(h<30 || regime==='TWIN_DOWN_CONTINUES')
    return [-.00030,-.00008,.0035,.0017];
 if(regime==='TWIN_SQUEEZE')
    return [.00042,.00015,.0035,.0017];
 throw Error('P9_UNKNOWN_WORLD:'+regime);
}
"""
    s=s[:start]+new_drift+s[end:]
    rep("if(regime==='DOWN_THEN_SQUEEZE'&&relative===30*12)",
        "if(regime==='TWIN_SQUEEZE'&&relative===30*12)")
    rep("const decisionIndex=WARMUP_H+36;",
        "const decisionIndex=WARMUP_H+20;")
    rep("const pathTag=profile.id+'|'+regime+'|'+seed;",
        """const pathTag=profile.id+'|'+regime+'|'+seed;
   const twinPrefixSha=crypto.createHash('sha256').update(JSON.stringify({
     pH1:pH1.slice(0,WARMUP_H+EVAL_H),
     bH1:bH1.slice(0,WARMUP_H+EVAL_H),
   })).digest('hex');""")
    rep("        native_gross:1,\n        native_exit_status:exit.status,",
        """        native_gross:1,
        native_asof_features:{
            referenceTs:signal.features.referenceTs,
            penguReturn24h:signal.features.penguReturn24h,
            penguReturn72h:signal.features.penguReturn72h,
            btcReturn24h:signal.features.btcReturn24h,
            relativeReturn24h:signal.features.relativeReturn24h,
            btcEma168Distance:signal.features.btcEma168Distance,
            volumeRatio6OverPrior36:signal.features.volumeRatio6OverPrior36,
            atr24Ratio:signal.features.atr24Ratio,
            rsi14:signal.features.rsi14,
        },
        native_exit_status:exit.status,""")
    rep("       maskWrappedToSourceBeginning:wrapped,\n       evaluationHours:EVAL_H",
        """       maskWrappedToSourceBeginning:wrapped,
       commonPrefixH1Sha256:twinPrefixSha,
       evaluationHours:EVAL_H""")
    rep("if(pathLedger.length!==384||prefixChecks!==4*8)",
        "if(pathLedger.length!==192||prefixChecks!==4*2)")
    begin=s.index("// Paired lifecycle economic parity against every original P8 natural signal.")
    end=s.index("const aggregate=[];",begin)
    new_pairing="""// P9 twin worlds: EXACTLY the same pre-shock H1 and native entry facts.
const pairsByProfileSeed=new Map();
for(const p of pathLedger){
 const key=p.mask_profile+'|'+p.seed;
 const values=pairsByProfileSeed.get(key)??[];
 values.push(p);
 pairsByProfileSeed.set(key,values);
}
if(pairsByProfileSeed.size!==96)throw Error('NOT_96_TWIN_PREFIX_PAIRS');
let matchedHistory=0;
for(const [key,vals] of pairsByProfileSeed){
 if(vals.length!==2||
    vals[0].commonPrefixH1Sha256!==vals[1].commonPrefixH1Sha256||
    vals[0].source_mask_start_m5_index!==vals[1].source_mask_start_m5_index)
    throw Error('TWIN_PRE_SHOCK_H1_NOT_IDENTICAL:'+key);
 matchedHistory++;
}
const casesByKey=new Map();
for(const row of caseLedger){
 const key=row.mask_profile+'|'+row.seed+'|'+row.signalHourIndex;
 const values=casesByKey.get(key)??[];
 values.push(row);
 casesByKey.set(key,values);
}
let matchedEntries=0,downWinSqueezeLoss=0,downLossSqueezeWin=0,
    sameSign=0,bothExitedBeforeShock=0;
const pairedOutcomes=[];
for(const [key,values] of casesByKey){
 if(values.length!==2)throw Error('TWIN_UNPAIRED_SIGNAL:'+key);
 const left=values.find(x=>x.price_regime==='TWIN_DOWN_CONTINUES');
 const right=values.find(x=>x.price_regime==='TWIN_SQUEEZE');
 if(!left||!right||left.entryTs!==right.entryTs||
    Math.abs(left.entryHourOpenPrice-right.entryHourOpenPrice)>1e-12||
    left.entryHourPositivePrint!==right.entryHourPositivePrint||
    left.firstPrintMinuteOffset!==right.firstPrintMinuteOffset||
    JSON.stringify(left.native_asof_features)!==JSON.stringify(right.native_asof_features))
    throw Error('TWIN_NATIVE_ENTRY_ASOF_NOT_IDENTICAL:'+key);
 if(left.native_exit_status!=='NATIVE_EXIT_MODELED'||
    right.native_exit_status!=='NATIVE_EXIT_MODELED')
    throw Error('TWIN_EXIT_RIGHT_CENSORED:'+key);
 const winA=left.native_price_net30_pct>0;
 const winB=right.native_price_net30_pct>0;
 if(winA&&!winB)downWinSqueezeLoss++;
 else if(!winA&&winB)downLossSqueezeWin++;
 else sameSign++;
 const fork=T0+(WARMUP_H+EVAL_H)*H;
 if(left.native_exitTs<=fork&&right.native_exitTs<=fork){
    bothExitedBeforeShock++;
    if(left.native_exitTs!==right.native_exitTs||
       Math.abs(left.native_exitPrice-right.native_exitPrice)>1e-10)
         throw Error('TWIN_BEFORE_FORK_EXITS_CHANGED:'+key);
 }
 pairedOutcomes.push({
   mask_profile:left.mask_profile,seed:left.seed,
   common_entry_hour_index:left.signalHourIndex,
   identical_prehistory:true,
   entry_ts:left.entryTs,
   entry_price:left.entryHourOpenPrice,
   down_net30_pct:left.native_price_net30_pct,
   squeeze_net30_pct:right.native_price_net30_pct,
   delta_squeeze_minus_down_pct:right.native_price_net30_pct-left.native_price_net30_pct,
   native_down_exit_reason:left.native_exitReason,
   native_squeeze_exit_reason:right.native_exitReason,
   flip_label:winA&&!winB?'DOWN_WIN_SQUEEZE_LOSS':
       !winA&&winB?'DOWN_LOSS_SQUEEZE_WIN':'SAME_SIGN'
 });
 matchedEntries++;
}
const pairedVerification={
 prefixPairs:matchedHistory,
 identicalNativeEntryPairs:matchedEntries,
 downWinnerBecomesSqueezeLoser:downWinSqueezeLoss,
 downLoserBecomesSqueezeWinner:downLossSqueezeWin,
 unchangedSign:sameSign,
 bothNativeExitsBeforeFork:bothExitedBeforeShock,
};
"""
    s=s[:begin]+new_pairing+s[end:]
    rep("schema:'prism7-p8b-paired-157-native-immutable-source-408h-384path/v1'",
        "schema:'prism7-p9-identical-prefix-native-short-forked-futures/v1'")
    rep(" syntheticPaths:384,prefixNativeFeatureChecks:prefixChecks,",
        " syntheticPaths:192,identicalPrefixPairs:96,prefixNativeFeatureChecks:prefixChecks,")
    rep(" marketConstruction:'4 SOURCE PRINT MASKS x 8 FIXED SYNTHETIC PRICE REGIMES x 12 FIXED SEEDS',",
        " marketConstruction:'4 SOURCE PRINT MASKS x 24 SEEDS x TWO IDENTICAL-PREFIX FUTURES',")
    rep("console.log('PRISM7_P8_PINNED_NATIVE_SYNTH_FINISHED'",
        "console.log('PRISM7_P9_IDENTICAL_PREFIX_FORK_PASS'")
    rep("  syntheticPaths:384,sourceShorts:caseLedger.length,",
        "  syntheticPaths:192,sourceShorts:caseLedger.length,")
    marker="console.log('PRISM7_P9_IDENTICAL_PREFIX_FORK_PASS'"
    at=s.index(marker)
    s=s[:at]+"""const twinPairsFile=out.replace('.json','_TWIN_PAIRS.jsonl');
fs.writeFileSync(twinPairsFile,pairedOutcomes.map(x=>JSON.stringify(x)).join('\\n')+'\\n');
"""+s[at:]
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(s,encoding="utf-8")
    print("P9_SOURCE_DERIVED_PASS",len(s),"chars",hashlib.sha256(a.out.read_bytes()).hexdigest())
    print("OUTPUT",a.out)


if __name__=="__main__":
    main()
