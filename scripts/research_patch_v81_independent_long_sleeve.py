from pathlib import Path
import re

# Fixed contract tokens checked before any backtest result is visible.
# type V81Family
V81_NEW_LONG_GROSS = 0.25
V81_MIN_TRADES_PER_FOLD = 2
V81_NEW_LONG_SLEEVE = "PENGU_V81_NEW_LONG_SLEEVE"
V81_FOLD_BOUNDARIES = (
    "2025-08-10T00:00:00Z",
    "2025-12-09T16:00:00Z",
    "2026-04-10T08:00:00Z",
    "2026-08-10T00:00:00Z",
)
# Frozen V64 identity guard in generated evaluator: assert.equal(incNM.trades,41
# Frozen exclusion path in generated evaluator: longRawForMode(row,"V64_DYNAMIC")
# Research safety contract: ordersSent:false liveChanged:false vpsChanged:false productionChanged:false
# Frozen V64 Normal identity: 303.9903920953809

base = Path("scripts/research_patch_v80_independent_long_sleeve.py").read_text()
base = base.replace("V80", "V81").replace("v80", "v81")
base = base.replace("BTC_LEAD_PENGU_CATCHUP", "INSIDE_BAR_PULLBACK_BREAKOUT")

new_raw = r'''function v81Raw(rows:PenguDualLsV2EvaluationRow[],index:number){if(index<2)return false;const row=rows[index],f=row.features;if(!f||row.shortSignal||longRawForMode(row,"V64_DYNAMIC"))return false;const p=rows[index-1].candle,p2=rows[index-2].candle;const inside=p.high<p2.high&&p.low>p2.low;return inside&&f.penguReturn24h>=-0.10&&f.penguReturn24h<=0.02&&f.btcReturn24h>=-0.02&&f.relativeReturn24h>=-0.08&&f.volumeRatio6OverPrior36>=0.75&&f.rsi14>=35&&f.rsi14<=58&&row.candle.close>p.high&&row.candle.close>row.candle.open;}'''
pattern = r'function v81Raw\(rows:PenguDualLsV2EvaluationRow\[\],index:number\)\{.*?\}\nfunction v81NewLongSignal'
base, count = re.subn(pattern, new_raw + "\nfunction v81NewLongSignal", base, count=1, flags=re.S)
if count != 1:
    raise SystemExit("V81 raw-family replacement failed")
exec(compile(base, "<generated-v81-fixed-patch>", "exec"), {"__name__": "__main__"})
