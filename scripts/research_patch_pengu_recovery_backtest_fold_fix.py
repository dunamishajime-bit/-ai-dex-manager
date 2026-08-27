from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()
old = 'metrics(sliceByTime(trades,undefined,a,b)),recoveryTrades:recoveryTradeCount(sliceByTime(trades,undefined,a,b))'
new = 'metrics(sliceByTime(trades,a,b)),recoveryTrades:recoveryTradeCount(sliceByTime(trades,a,b))'
if old not in src:
    raise SystemExit('recovery fold slicing marker missing')
src = src.replace(old, new, 1)
TARGET.write_text(src)
print(f'PATCHED_RECOVERY_FOLD_SLICING={TARGET}')
