from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

marker = '\nfunction evaluateV57Conditional('
insert = r'''
function winnerReplacementAudit(baselineWinners: RichTrade[], candidateLongs: RichTrade[]) {
  const candidateIds = new Set(candidateLongs.map((t) => t.signalTs));
  const lost = baselineWinners.filter((t) => !candidateIds.has(t.signalTs));
  const replacements = lost.map((winner) => {
    const occupying = candidateLongs.find((t) =>
      t.signalTs < winner.signalTs
      && t.entryTs <= winner.signalTs
      && t.exitTs >= winner.signalTs
    );
    return {
      baselineSignalTs: winner.signalTs,
      baselineSignalIso: new Date(winner.signalTs).toISOString(),
      baselineAccountReturn: winner.accountReturn,
      replacementSignalTs: occupying?.signalTs ?? null,
      replacementSignalIso: occupying ? new Date(occupying.signalTs).toISOString() : null,
      replacementAccountReturn: occupying?.accountReturn ?? null,
      replacementExitReason: occupying?.exitReason ?? null,
      coveredByProfitableEarlierLong: Boolean(occupying && occupying.accountReturn > 0),
    };
  });
  return {
    baselineWinnerCount: baselineWinners.length,
    exactWinnerSignalsRetained: baselineWinners.length - lost.length,
    lostWinnerSignals: lost.length,
    profitableEarlierReplacementCount: replacements.filter((x) => x.coveredByProfitableEarlierLong).length,
    allLostCoveredByProfitableEarlierLong: replacements.every((x) => x.coveredByProfitableEarlierLong),
    replacements,
  };
}
'''
if marker not in src:
    raise SystemExit('evaluate marker missing')
src = src.replace(marker, insert + marker, 1)

needle = '    const protectsTrainingWinners = [...protectedLongWinnerIds].every((id) => trainLongIds.has(id));\n    const trainingEligible ='
replacement = '    const protectsTrainingWinners = [...protectedLongWinnerIds].every((id) => trainLongIds.has(id));\n    const replacementAudit = winnerReplacementAudit(bLongTrain.filter((t) => t.accountReturn > 0), cLongTrainTrades);\n    const trainingEligible ='
if needle not in src:
    raise SystemExit('candidate audit insertion point missing')
src = src.replace(needle, replacement, 1)

needle2 = '      mode, protectsTrainingWinners, trainingEligible, metrics: m,'
replacement2 = '      mode, protectsTrainingWinners, replacementAudit, trainingEligible, metrics: m,'
if needle2 not in src:
    raise SystemExit('candidate output insertion point missing')
src = src.replace(needle2, replacement2, 1)

TARGET.write_text(src)
print(f'PATCHED={TARGET} bytes={TARGET.stat().st_size}')
