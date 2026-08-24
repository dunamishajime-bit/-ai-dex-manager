#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path('.research-state/pengu-short-v15')
ROOT.mkdir(parents=True, exist_ok=True)
PRE_SHA = '9873c0b3b345f2273b5fe3c6dde4a08ae741f9ef'
HOUR = 3_600_000

spec = importlib.util.spec_from_file_location('v14', 'scripts/research_pengu_short_v14_probation_bitget.py')
v14 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v14)
v13 = v14.v13
v12 = v14.v12
v12final = v14.v12final


def dense_bitget_candles(symbol):
    """Fetch <=100 hourly bars per request in overlapping short windows; never synthesize bars."""
    by_ts = {}
    cursor = v13.WARM_START
    calls = 0
    while cursor < v13.EVAL_END:
        target_end = min(v13.EVAL_END - HOUR, cursor + 96 * HOUR)
        q_start = max(v13.WARM_START, cursor - HOUR)
        q_end = min(v13.EVAL_END - 1, target_end + HOUR - 1)
        data = v13.bitget_get('/api/v3/market/history-candles', {
            'category':'USDT-FUTURES',
            'symbol':symbol,
            'interval':'1H',
            'startTime':str(q_start),
            'endTime':str(q_end),
            'limit':'100',
            'type':'market',
        }) or []
        calls += 1
        for row in data:
            try:
                ts = int(row[0])
                if v13.WARM_START <= ts < v13.EVAL_END:
                    by_ts[ts] = {
                        'openTime':ts,
                        'open':float(row[1]),
                        'high':float(row[2]),
                        'low':float(row[3]),
                        'close':float(row[4]),
                        'volume':float(row[5]),
                        'closeTime':ts + HOUR - 1,
                    }
            except Exception:
                continue
        cursor = target_end + HOUR
        time.sleep(0.06)

    rows = [by_ts[k] for k in sorted(by_ts)]
    gaps = []
    last_gap_right = None
    for a,b in zip(rows,rows[1:]):
        d=b['openTime']-a['openTime']
        if d != HOUR:
            gaps.append({'left':a['openTime'],'right':b['openTime'],'deltaHours':d/HOUR})
            last_gap_right=b['openTime']
    if last_gap_right is not None:
        rows=[r for r in rows if r['openTime']>=last_gap_right]
    if len(rows)<10_000:
        raise RuntimeError(f'Insufficient continuous Bitget {symbol} rows={len(rows)} calls={calls} gaps={gaps[-20:]}')
    path=v13.ROOT/f'bitget-{symbol}.json'
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(rows,separators=(',',':')))
    return {'rawRows':len(by_ts),'continuousRows':len(rows),'trimStart':rows[0]['openTime'],'last':rows[-1]['openTime'],'calls':calls,'gaps':gaps}


def source_for(venue):
    old_temp=v14.source_for(venue)
    text=old_temp.read_text()
    old_temp.unlink(missing_ok=True)
    text=text.replace('d8c9bbcb513e1ab65ae39a30b3755b1faeb5b22d',PRE_SHA)
    text=text.replace('COUNTERWIND_PROBATION_BREAKEVEN_RESUME','COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME')
    text=text.replace('pengu-short-v14-','pengu-short-v15-')

    fn_start=text.index('function transformShort(')
    fn_end=text.index('\nfunction metrics(',fn_start)
    v15_fn=r'''function transformShort(
  trade: Trade,
  baseline: Trade[],
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  mode: Mode,
  rowIndex: Map<number, number>,
) {
  if (trade.side !== "S") return [{ ...trade, kind: "BASE" as const }];
  const counterwind = trade.btcEma168Distance >= 0 || trade.btcReturn24h >= 0;
  if (!counterwind) return [{ ...trade, kind: "BASE" as const }];

  const entryIndex = rowIndex.get(trade.entryTs);
  const originalExitIndex = rowIndex.get(trade.exitTs);
  assert(entryIndex !== undefined && originalExitIndex !== undefined);
  const unit = Math.min(trade.entryAtr24Ratio, PENGU_DUAL_LS_V2.short.hardStopPct / 2);
  const arm = unit;
  const goal = Math.min(2 * unit, PENGU_DUAL_LS_V2.short.hardStopPct);
  const failLevel = unit / 2;
  let armed = false, progressed = false, lowWater = trade.entryPrice, probationIndex = -1;

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) armed = true;
    if (armed && mfe >= goal) { progressed = true; armed = false; }
    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      probationIndex = cursor + 1;
      break;
    }
  }
  if (probationIndex < 0) return [{ ...trade, kind: "BASE" as const }];

  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  const worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE;
  const costCoverPrice = trade.entryPrice / (1 + 2 * worstCostPerSide);
  const deadlineTs = trade.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;

  for (let cursor = probationIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    const features = rows[cursor].features;
    if (!features) continue;

    if (bar.openTime >= deadlineTs) {
      const raw = trade.entryPrice / bar.open - 1;
      const f = fundingBetween(funding, trade.entryTs, bar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: bar.openTime, exitPrice: bar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];
    }

    // Close-confirmed thesis recovery has priority; this avoids an intrabar stop cutting a recovered large winner.
    const resumed = bar.close < lowWater && bar.close < features.ema72 && features.btcReturn24h >= 0;
    if (resumed) return [{ ...trade, kind: "BASE" as const, progressFail: true, reentryFrom: bar.openTime }];

    // Exit only after the completed H1 close no longer carries the predeclared worst-case round-trip cost buffer.
    if (bar.close >= costCoverPrice) {
      const next = Math.min(cursor + 1, originalExitIndex);
      const exitBar = rows[next].candle;
      const raw = trade.entryPrice / exitBar.open - 1;
      const f = fundingBetween(funding, trade.entryTs, exitBar.openTime);
      const net = raw + f - 2 * costPerSide;
      return [{ ...trade, kind: "BASE" as const, exitTs: exitBar.openTime, exitPrice: exitBar.open,
        accountReturn: trade.requestedGross * net, netUnitReturn: net, progressFail: true }];
    }
  }

  return [{ ...trade, kind: "BASE" as const, progressFail: true }];
}'''
    text=text[:fn_start]+v15_fn+text[fn_end:]
    temp=Path(f'scripts/.pengu_v15_{venue.lower()}.ts')
    temp.write_text(text)
    return temp


def run(venue):
    temp=source_for(venue)
    out=ROOT/f'{venue.lower()}.json'
    env=dict(os.environ); env['PENGU_V11_OUT']=str(out)
    try:
        cp=subprocess.run(['npx','tsx',str(temp)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (ROOT/f'{venue.lower()}.log').write_text(cp.stdout)
        print(cp.stdout)
        if cp.returncode!=0: raise RuntimeError(f'V15 {venue} failed code={cp.returncode}')
        return json.loads(out.read_text())
    finally:
        temp.unlink(missing_ok=True)


def gate_nonworse(x):
    for mode in ('NORMAL','STRESS'):
        b=x['results'][mode]['BASELINE']; c=x['results'][mode]['CANDIDATE']
        pf=lambda z:z.get('profitFactor') or 0; wr=lambda z:z.get('winRatePct') or 0
        if not (c['trades']==b['trades'] and wr(c)>=wr(b) and c['returnPct']>=b['returnPct'] and pf(c)>=pf(b) and c['maxDrawdownPct']>=b['maxDrawdownPct']): return False
    return True


def main():
    v12.v11runner.load_binance_klines('PENGUUSDT'); v12.v11runner.load_binance_klines('BTCUSDT'); v12.v11runner.load_binance_funding()
    okx=run('OKX'); binance=run('Binance')

    gp=v12final.load_gate_klines('PENGU_USDT'); gb=v12final.load_gate_klines('BTC_USDT')
    v12final.write_gate_cache(gp,gb,[])
    gate=run('Gate')

    # Bitget strategy performance is evaluated only after the V15 pre-registration SHA exists.
    bitget_data={
        'pengu':dense_bitget_candles('PENGUUSDT'),
        'btc':dense_bitget_candles('BTCUSDT'),
        'funding':v13.load_bitget_funding(),
    }
    bitget=run('Bitget')
    passes={'OKX':bool(okx['promotion']['pass']),'Binance':bool(binance['promotion']['pass']),'GateDiagnostic':gate_nonworse(gate),'Bitget':bool(bitget['promotion']['pass'])}
    result={'status':'PASS_RESEARCH_ONLY','schema':'pengu-short-v15/v1','candidate':'COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME',
        'preRegistrationSha':PRE_SHA,'candidateCount':1,'thresholdSweep':False,'bitgetPerformanceObservedBeforePreRegistration':False,
        'bitgetData':bitget_data,'venues':{'OKX':okx,'Binance':binance,'Gate':gate,'Bitget':bitget},'venuePasses':passes,
        'promotionPass':all(passes.values()),'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'promotionPass':result['promotionPass'],'venuePasses':passes,'bitgetData':bitget_data},indent=2))

if __name__=='__main__': main()
