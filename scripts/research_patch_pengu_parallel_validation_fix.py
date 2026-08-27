from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

# Compatibility corrections for the parallel validation patch.
src=src.replace('const fs=Date.parse(process.env.PENGU_FORWARD_START||"2026-08-10T00:00:00Z");\n    const fe=Date.parse(process.env.PENGU_FORWARD_END||"2026-08-28T00:00:00Z");\n    validationPayload.forward={start:new Date(fs).toISOString(),end:new Date(fe).toISOString(),baselineNormal:metrics(sliceTrades(baseNormal,fs,fe)),candidateNormal:metrics(sliceTrades(fixedNormal,fs,fe)),baselineStress:metrics(sliceTrades(baseStress,fs,fe)),candidateStress:metrics(sliceTrades(fixedStress,fs,fe))};',
'''const forwardStart=Date.parse(process.env.PENGU_FORWARD_START||"2026-08-10T00:00:00Z");
    const forwardEnd=Date.parse(process.env.PENGU_FORWARD_END||"2026-08-28T00:00:00Z");
    validationPayload.forward={start:new Date(forwardStart).toISOString(),end:new Date(forwardEnd).toISOString(),baselineNormal:metrics(sliceTrades(baseNormal,forwardStart,forwardEnd)),candidateNormal:metrics(sliceTrades(fixedNormal,forwardStart,forwardEnd)),baselineStress:metrics(sliceTrades(baseStress,forwardStart,forwardEnd)),candidateStress:metrics(sliceTrades(fixedStress,forwardStart,forwardEnd))};''')

TARGET.write_text(src)
print(f'PATCHED_PARALLEL_VALIDATION_FIX={TARGET}')
