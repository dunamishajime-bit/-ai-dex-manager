from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()
old=''' if(mode==="P5BE")return{protectActivationPct:.05,partialStopPct:null,partialAfterHours:null,partialGross:0};
 const h4=mode.includes("_H4_")&&!mode.includes("_H45_");
 const stop=h4?.04:.045;
 const after=mode.includes("_A12_")?12:mode.includes("_A18_")?18:24;
 const gross=mode.endsWith("G25")?.25:.125;
 return{protectActivationPct:.05,partialStopPct:stop,partialAfterHours:after,partialGross:gross};'''
new=''' if(mode==="P5BE")return{protectActivationPct:null,partialStopPct:null,partialAfterHours:null,partialGross:0};
 const h4=mode.includes("_H4_")&&!mode.includes("_H45_");
 const stop=h4?.04:.045;
 const after=mode.includes("_A12_")?12:mode.includes("_A18_")?18:24;
 const gross=mode.endsWith("G25")?.25:.125;
 return{protectActivationPct:null,partialStopPct:stop,partialAfterHours:after,partialGross:gross};'''
if old not in src: raise SystemExit('V7 plan marker missing')
src=src.replace(old,new,1)
src=src.replace('schema:"pengu-recovery-integrated-backtest/v7-delayed-defense"','schema:"pengu-recovery-integrated-backtest/v8-delayed-only"',1)
src=src.replace('predeclared +5% breakeven protection plus delayed partial downside defense grid','delayed partial downside defense only; no +5% breakeven protection',1)
TARGET.write_text(src)
print(f'PATCHED_RECOVERY_V8_DELAYED_ONLY={TARGET}')
