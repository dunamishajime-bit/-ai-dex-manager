#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path('.research-state/pengu-v18-remaining-loss-diagnostic')
ROOT.mkdir(parents=True, exist_ok=True)
V18_SHA = '42bb6297d893125ad3b2de0a9e26dba342852223'

spec = importlib.util.spec_from_file_location('v18', 'scripts/research_pengu_short_v18_reversible_probation.py')
v18 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v18)


def instrument(venue: str) -> Path:
    temp = v18.source_for(venue)
    text = temp.read_text()
    temp.unlink(missing_ok=True)

    if V18_SHA not in text:
        raise RuntimeError('Frozen V18 preregistration SHA missing')

    old_deadline = '''      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: bar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];'''
    new_deadline = '''      const deadlineBarWouldResume = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;
      let lateResumeTs: number | null = null;
      for (let probe = cursor; probe < originalExitIndex; probe += 1) {
        const probeBar = rows[probe].candle;
        const probeFeatures = rows[probe].features;
        if (!probeFeatures) continue;
        if (probeBar.close < lowWater && probeBar.close < probeFeatures.ema72 && probeFeatures.btcReturn24h >= 0) {
          lateResumeTs = probeBar.openTime;
          break;
        }
      }
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: bar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true,
        diagReason: "DEADLINE", diagDecisionTs: bar.openTime,
        diagProbationTs: rows[probationIndex].candle.openTime, diagLowWater: lowWater,
        diagDecisionClose: bar.close, diagEma72: features.ema72,
        diagRelativeReturn24h: features.relativeReturn24h, diagBtcReturn24h: features.btcReturn24h,
        diagCostCoverPrice: costCoverPrice, diagDeadlineBarWouldResume: deadlineBarWouldResume,
        diagLateResumeTs: lateResumeTs, diagOriginalExitTs: trade.exitTs }];'''
    if text.count(old_deadline) != 1:
        raise RuntimeError(f'Expected exactly one active V18 deadline return, got {text.count(old_deadline)}')
    text = text.replace(old_deadline, new_deadline, 1)

    old_resume = 'if (resumed) return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime }];'
    new_resume = '''if (resumed) return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime,
      diagReason: "RESUME", diagDecisionTs: bar.openTime,
      diagProbationTs: rows[probationIndex].candle.openTime, diagLowWater: lowWater,
      diagDecisionClose: bar.close, diagEma72: features.ema72,
      diagRelativeReturn24h: features.relativeReturn24h, diagBtcReturn24h: features.btcReturn24h,
      diagCostCoverPrice: costCoverPrice, diagDeadlineBarWouldResume: null,
      diagLateResumeTs: bar.openTime, diagOriginalExitTs: trade.exitTs }];'''
    if text.count(old_resume) != 1:
        raise RuntimeError(f'Expected exactly one V18 resume return, got {text.count(old_resume)}')
    text = text.replace(old_resume, new_resume, 1)

    old_final = 'return [{ ...trade, kind: "BASE" as const, progressFail: true }];\n}\n\nfunction metrics('
    new_final = '''return [{ ...trade, kind: "BASE" as const, progressFail: true,
    diagReason: "ORIGINAL_EXIT", diagDecisionTs: trade.exitTs,
    diagProbationTs: rows[probationIndex].candle.openTime, diagLowWater: lowWater,
    diagDecisionClose: null, diagEma72: null, diagRelativeReturn24h: null, diagBtcReturn24h: null,
    diagCostCoverPrice: costCoverPrice, diagDeadlineBarWouldResume: null,
    diagLateResumeTs: null, diagOriginalExitTs: trade.exitTs }];
}

function metrics('''
    if text.count(old_final) != 1:
        raise RuntimeError(f'Expected exactly one V18 final probation return, got {text.count(old_final)}')
    text = text.replace(old_final, new_final, 1)

    marker = '    const candidate = baseline.flatMap((trade) => transformShort(trade, baseline, rows, funding, mode, rowIndex));'
    inject = marker + r'''
    const baselineByEntry = new Map(baseline.map((trade) => [trade.entryTs, trade]));
    output.diagnostic ??= {};
    output.diagnostic[mode.toUpperCase()] = candidate
      .filter((trade: any) => trade.progressFail)
      .map((trade: any) => {
        const baseTrade = baselineByEntry.get(trade.entryTs)!;
        return {
          entryTs: trade.entryTs,
          entryIso: new Date(trade.entryTs).toISOString(),
          baselineExitTs: baseTrade.exitTs,
          baselineExitIso: new Date(baseTrade.exitTs).toISOString(),
          baselineAccountReturn: baseTrade.accountReturn,
          baselineWin: baseTrade.accountReturn > 0,
          candidateExitTs: trade.exitTs,
          candidateExitIso: new Date(trade.exitTs).toISOString(),
          candidateAccountReturn: trade.accountReturn,
          candidateWin: trade.accountReturn > 0,
          outcomeChanged: (baseTrade.accountReturn > 0) !== (trade.accountReturn > 0),
          accountReturnDelta: trade.accountReturn - baseTrade.accountReturn,
          entryAtr24Ratio: trade.entryAtr24Ratio,
          btcEma168Distance: trade.btcEma168Distance,
          btcReturn24h: trade.btcReturn24h,
          reason: trade.diagReason ?? null,
          decisionTs: trade.diagDecisionTs ?? null,
          decisionIso: trade.diagDecisionTs ? new Date(trade.diagDecisionTs).toISOString() : null,
          probationTs: trade.diagProbationTs ?? null,
          probationIso: trade.diagProbationTs ? new Date(trade.diagProbationTs).toISOString() : null,
          lowWater: trade.diagLowWater ?? null,
          decisionClose: trade.diagDecisionClose ?? null,
          ema72: trade.diagEma72 ?? null,
          relativeReturn24h: trade.diagRelativeReturn24h ?? null,
          decisionBtcReturn24h: trade.diagBtcReturn24h ?? null,
          costCoverPrice: trade.diagCostCoverPrice ?? null,
          deadlineBarWouldResume: trade.diagDeadlineBarWouldResume ?? null,
          lateResumeTs: trade.diagLateResumeTs ?? null,
          lateResumeIso: trade.diagLateResumeTs ? new Date(trade.diagLateResumeTs).toISOString() : null,
          originalExitTs: trade.diagOriginalExitTs ?? baseTrade.exitTs,
          candidateLoss: trade.accountReturn <= 0,
        };
      });'''
    if text.count(marker) != 1:
        raise RuntimeError(f'Expected one candidate construction marker, got {text.count(marker)}')
    text = text.replace(marker, inject, 1)

    out = Path(f'scripts/.pengu_v18_remaining_loss_diag_{venue.lower()}.ts')
    out.write_text(text)
    return out


def run(venue: str):
    temp = instrument(venue)
    out = ROOT / f'{venue.lower()}.json'
    env = dict(os.environ)
    env['PENGU_V11_OUT'] = str(out)
    try:
        cp = subprocess.run(['npx', 'tsx', str(temp)], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (ROOT / f'{venue.lower()}.log').write_text(cp.stdout)
        if cp.returncode != 0:
            raise RuntimeError(f'diagnostic {venue} failed code={cp.returncode}\n{cp.stdout[-4000:]}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def normalize_events(venue: str, payload: dict):
    rows = payload['diagnostic']['NORMAL']
    return [dict(x, venue=venue) for x in rows]


def cluster(events_by_venue):
    all_events = []
    for venue, events in events_by_venue.items():
        all_events.extend(events)
    all_events.sort(key=lambda x: x['entryTs'])
    groups = []
    for event in all_events:
        placed = False
        for group in groups:
            if abs(event['entryTs'] - group['anchorTs']) <= 2 * 3_600_000 and event['venue'] not in group['venues']:
                group['events'].append(event)
                group['venues'].add(event['venue'])
                placed = True
                break
        if not placed:
            groups.append({'anchorTs': event['entryTs'], 'events': [event], 'venues': {event['venue']}})
    out = []
    for group in groups:
        events = group['events']
        out.append({
            'anchorTs': group['anchorTs'],
            'anchorIso': events[0]['entryIso'],
            'venues': sorted(group['venues']),
            'venueCount': len(group['venues']),
            'allCandidateLoss': all(x['candidateLoss'] for x in events),
            'allDeadline': all(x['reason'] == 'DEADLINE' for x in events),
            'allDeadlineBarWouldResume': all(x.get('deadlineBarWouldResume') is True for x in events),
            'allBaselineWin': all(x['baselineWin'] for x in events),
            'events': events,
        })
    return out


def main():
    # Use only already-opened venues. KuCoin is intentionally absent.
    v18.v17.v16.v15.v12.v11runner.load_binance_klines('PENGUUSDT')
    v18.v17.v16.v15.v12.v11runner.load_binance_klines('BTCUSDT')
    v18.v17.v16.v15.v12.v11runner.load_binance_funding()
    okx = run('OKX')
    binance = run('Binance')
    bitget = run('Bitget')

    events = {
        'OKX': normalize_events('OKX', okx),
        'Binance': normalize_events('Binance', binance),
        'Bitget': normalize_events('Bitget', bitget),
    }
    groups = cluster(events)
    shared_loss = [g for g in groups if g['venueCount'] == 3 and g['allCandidateLoss']]
    shared_deadline_resume = [g for g in shared_loss if g['allDeadline'] and g['allDeadlineBarWouldResume']]

    result = {
        'status': 'PASS_RESEARCH_ONLY',
        'schema': 'pengu-v18-remaining-loss-diagnostic/v1',
        'diagnosticOnly': True,
        'frozenCandidate': 'COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE',
        'frozenPreRegistrationSha': V18_SHA,
        'candidateCount': 0,
        'thresholdSweep': False,
        'kucoinPerformanceObserved': False,
        'events': events,
        'clusters': groups,
        'sharedThreeVenueCandidateLossClusters': shared_loss,
        'sharedThreeVenueDeadlineBarResumeClusters': shared_deadline_resume,
        'safety': {'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
    }
    (ROOT / 'diagnostic.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({
        'modifiedCounts': {k: len(v) for k, v in events.items()},
        'sharedLossClusters': len(shared_loss),
        'sharedDeadlineBarResumeClusters': len(shared_deadline_resume),
        'kucoinPerformanceObserved': False,
        'safety': result['safety'],
    }, indent=2))


if __name__ == '__main__':
    main()
