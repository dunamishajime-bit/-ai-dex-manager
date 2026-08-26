from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()
needle = '''    const trainingEligible =\n      protectsTrainingWinners\n      && m.longTrain.trades > base.longTrain.trades'''
replacement = '''    const economicallyPreservesTrainingWinners = protectsTrainingWinners || replacementAudit.replacements.every((x) =>\n      x.replacementAccountReturn !== null\n      && x.replacementAccountReturn + 1e-12 >= x.baselineAccountReturn\n    );\n    const trainingEligible =\n      economicallyPreservesTrainingWinners\n      && m.longTrain.trades > base.longTrain.trades'''
if needle not in src:
    raise SystemExit('training eligibility marker missing')
src = src.replace(needle, replacement, 1)
needle2 = '      mode, protectsTrainingWinners, replacementAudit, trainingEligible, metrics: m,'
replacement2 = '      mode, protectsTrainingWinners, economicallyPreservesTrainingWinners, replacementAudit, trainingEligible, metrics: m,'
if needle2 not in src:
    raise SystemExit('candidate output marker missing')
src = src.replace(needle2, replacement2, 1)
TARGET.write_text(src)
print(f'PATCHED_ECONOMIC_GUARD={TARGET} bytes={TARGET.stat().st_size}')
