"""Portfolio Profit Engine V19 — frozen V15 + idle narrow-breakout sleeve.

V17 showed that mean reversion adds only a small return increment. V19 tests a
causally different idle source: narrow leadership that is too concentrated to
activate V15's 4-of-6 broad LONG regime. V15 remains unchanged and always has
priority. Exactly three distinct breakout families are Development-selected;
V/E are frozen. No overlap, leverage, per-symbol parameters, or Fresh OOS.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_portfolio_profit_engine_v17 as core
import research_portfolio_profit_engine_v17_takeover_fix as fix

FAMILIES = ('NARROW_LEADER', 'LONG_HORIZON_OWNERSHIP', 'VOL_EXPANSION_BREAKOUT')
MAX_HOLD_HOURS = 84
HARD_STOP_PCT = -8.0


def candidate(family: str, ts: int, p12, hourly) -> dict[str, Any] | None:
    snap = core._snapshot(ts, p12, hourly)
    if snap is None:
        return None
    # Sleeve exists only outside V15 broad-long and outside broad-short panic.
    if snap['longCount'] >= core.v14.CONSENSUS_COUNT or snap['shortCount'] >= core.v14.CONSENSUS_COUNT:
        return None
    rows=[]
    for symbol,a,h in snap['rows']:
        nm=float(a['normalizedMomentum20']); z24=float(h['z24']); z72=float(h['z72']); z168=float(h['z168']); z720=float(h['z720']); eff=float(h['eff168']); volr=float(h['volRatio24to168'])
        score=None
        if family=='NARROW_LEADER':
            # One/few assets lead even though market breadth is not yet broad.
            if a['close']>a['sma50'] and nm>=0.70 and z168>=0.35 and z24>=0.0:
                score=nm+0.35*z168+0.15*z24
        elif family=='LONG_HORIZON_OWNERSHIP':
            # Persistent 30d ownership with positive 7d/3d continuation.
            if a['close']>a['sma50'] and z720>=0.45 and z168>=0.35 and z72>=0.10 and eff>=0.15:
                score=0.45*z720+0.40*z168+0.15*z72+0.20*eff
        elif family=='VOL_EXPANSION_BREAKOUT':
            # Short-horizon directional expansion from otherwise non-broad market.
            if a['close']>a['sma50'] and z24>=0.55 and z72>=0.20 and volr>=1.10:
                score=z24+0.35*z72+0.20*(volr-1.0)
        else:
            raise RuntimeError(f'UNKNOWN_V19_FAMILY:{family}')
        if score is not None:
            rows.append({'symbol':symbol,'sideSign':1,'score':float(score)})
    rows.sort(key=lambda x:(-float(x['score']),x['symbol']))
    return rows[0] if rows else None


def simulate_breakout(family: str, candles, index, p12, hourly, trend_records, start: int, end: int, cost_bps: float, delay_bars: int):
    timeline=[ts for ts in sorted(p12['BTC']) if start<=ts<end and (ts-core.base.START_2023)%core.CHECK_MS==0]
    records=[]; position=None

    def close(exit_ts:int, exit_price:float, reason:str):
        nonlocal position
        if position is None:return
        gross=(exit_price/float(position['entryPrice'])-1.0)*100.0
        records.append({'symbol':position['symbol'],'side':'LONG','sideSign':1,'entryTs':int(position['entryTs']),'exitTs':exit_ts,'entryPrice':float(position['entryPrice']),'exitPrice':exit_price,'grossReturnPct':gross,'netReturnPct':gross-cost_bps/100.0,'entryScore':float(position['entryScore']),'exitReason':reason,'holdingHours':int((exit_ts-int(position['entryTs']))//core.HOUR),'sleeve':'IDLE_BREAKOUT','rangeFamily':family})
        position=None

    for ts in timeline:
        if position is not None and position.get('takeoverTs') is not None and int(position['takeoverTs'])<=ts:
            px=core._price(candles,index,str(position['symbol']),int(position['takeoverTs']),'open')
            if px is None: raise RuntimeError('V19_TAKEOVER_PRICE_MISSING')
            close(int(position['takeoverTs']),float(px),'TREND_TAKEOVER')
        if position is not None:
            symbol=str(position['symbol']); held=int((ts-int(position['entryTs']))//core.HOUR); px=core._price(candles,index,symbol,ts,'close')
            if px is None:continue
            pnl=(px/float(position['entryPrice'])-1.0)*100.0
            stop=pnl<=HARD_STOP_PCT; timeout=held>=MAX_HOLD_HOURS
            if stop or timeout:
                i=index[symbol].get(ts)
                if i is None:continue
                ei=min(i+delay_bars,len(candles[symbol])-1); exit_ts=int(candles[symbol][ei]['ts']); exit_price=float(candles[symbol][ei]['open'])
                takeover=position.get('takeoverTs')
                if takeover is not None and exit_ts>int(takeover):
                    exit_ts=int(takeover); x=core._price(candles,index,symbol,exit_ts,'open');
                    if x is None: raise RuntimeError('V19_DELAY_TAKEOVER_PRICE_MISSING')
                    exit_price=float(x); reason='TREND_TAKEOVER'
                else: reason='BREAKOUT_STOP' if stop else 'FIXED_84H_RELEASE'
                close(exit_ts,exit_price,reason)
            if position is not None:continue
        if core._trend_occupied(trend_records,ts):continue
        cand=candidate(family,ts,p12,hourly)
        if cand is None:continue
        symbol=str(cand['symbol']); i=index[symbol].get(ts)
        if i is None:continue
        ei=i+1+delay_bars
        if ei>=len(candles[symbol]):continue
        entry_ts=int(candles[symbol][ei]['ts'])
        if entry_ts>=end or core._trend_occupied(trend_records,entry_ts):continue
        next_trend=core._next_trend_entry(trend_records,entry_ts)
        if next_trend is not None and next_trend-entry_ts<12*core.HOUR:continue
        position={'symbol':symbol,'entryTs':entry_ts,'entryPrice':float(candles[symbol][ei]['open']),'entryScore':float(cand['score']),'takeoverTs':next_trend}
    if position is not None:
        symbol=str(position['symbol']); takeover=position.get('takeoverTs')
        if takeover is not None and int(takeover)<end:
            px=core._price(candles,index,symbol,int(takeover),'open');
            if px is None: raise RuntimeError('V19_FINAL_TAKEOVER_PRICE_MISSING')
            close(int(takeover),float(px),'TREND_TAKEOVER')
        else:
            final_ts=max(int(r['ts']) for r in candles[symbol] if start<=int(r['ts'])<end); px=core._price(candles,index,symbol,final_ts,'close')
            if px is not None:close(final_ts,float(px),'PERIOD_END')
    return records


def main():
    core.FAMILIES=FAMILIES
    core.RANGE_MAX_HOURS=MAX_HOLD_HOURS
    core._candidate=candidate
    core.simulate_range=simulate_breakout
    core.main()
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'))
    old=root/'portfolio-profit-engine-v17.json'; d=json.loads(old.read_text())
    d['researchLine']='PORTFOLIO_PROFIT_ENGINE_V19_V15_PLUS_IDLE_BREAKOUT'
    d['architecture']='Frozen V15 broad Trend priority -> idle-only narrow Breakout sleeve -> exact Trend takeover'
    d['rangeFamilies']=list(FAMILIES); d['selectedBreakoutFamily']=d.pop('selectedRangeFamily',None)
    d['breakoutLifecycle']={'maxHoldHours':MAX_HOLD_HOURS,'hardStopPct':HARD_STOP_PCT,'checkHours':12}
    d['diagnosisBasis']['v17RangeImported']=False
    (root/'portfolio-profit-engine-v19.json').write_text(json.dumps(d,indent=2,sort_keys=True),encoding='utf-8')
    old_trades=root/'portfolio-profit-engine-v17-trades.jsonl'
    (root/'portfolio-profit-engine-v19-trades.jsonl').write_text(old_trades.read_text(),encoding='utf-8')
    print(json.dumps(d,indent=2,sort_keys=True))

if __name__=='__main__':main()
