from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='const WARM_START = Date.parse("2025-07-01T00:00:00Z");\nconst EVAL_START = Date.parse("2025-08-10T00:00:00Z");\nconst EVAL_END = Date.parse("2026-08-10T00:00:00Z");'
new='const WARM_START = Date.parse(process.env.PENGU_WARM_START || "2025-07-01T00:00:00Z");\nconst EVAL_START = Date.parse(process.env.PENGU_EVAL_START || "2025-08-10T00:00:00Z");\nconst EVAL_END = Date.parse(process.env.PENGU_EVAL_END || "2026-08-10T00:00:00Z");'
if old not in src:
    raise SystemExit('window constants marker missing')
src=src.replace(old,new,1)
TARGET.write_text(src)
print(f'PATCHED_FORWARD_WINDOW={TARGET}')
