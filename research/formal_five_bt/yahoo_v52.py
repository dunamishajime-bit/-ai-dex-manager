"""Yahoo-only V52 *assumed-fill* research. NO live Aster basis or L2 parity.

Historical Yahoo Finance 60m OHLC data are used as a transparent equity-price
displacement proxy. Live V11/V50 trigger on Aster perp-versus-equity BASIS,
which Yahoo shares alone cannot supply. This file must never report its proxy
events as real V52 LIVE signals or its fills as actual venue executions.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import argparse
import csv
import json
import math
from pathlib import Path
import time
from typing import Any, Iterable, Mapping
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from .calendars import nyse_close_utc
from .datasets import load_fred_fx
from .portfolio import monthly_deposit_events

NY=ZoneInfo("America/New_York")
HOUR=3600_000
SOURCE_START=datetime(2025,8,1,tzinfo=timezone.utc)
BT_START=datetime(2025,8,10,tzinfo=timezone.utc)
BT_END=datetime(2026,8,11,tzinfo=timezone.utc)
TICKERS=("AMZN","META","MSFT","NVDA","TSLA")
RUNTIME_SHA="a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
PROXY_ID="YAHOO_HOURLY_DISPLACEMENT_NOT_V52_ASTER_BASIS"
ASSUMED_COSTS={"NORMAL":20.0,"SEVERE":50.0}
SLOTS=("V11_EQ","V50_POST_OPEN_BASIS")

class YahooSourceBlocked(RuntimeError):pass

def json_bytes(obj:Any)->bytes:
    return (json.dumps(obj,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode()

def digest(raw:bytes)->str:return sha256(raw).hexdigest()

@dataclass(frozen=True)
class HourBar:
    symbol:str
    start_ms:int
    end_ms:int
    open:float
    high:float
    low:float
    close:float
    volume:float
    ny_day:str
    start_ny:str
    provider:str="YAHOO_FINANCE_CHART_60M"

@dataclass(frozen=True)
class StockSignal:
    slot:str
    symbol:str
    side:str
    entry_ms:int
    entry_price:float
    reference_price:float
    yahoo_displacement_bps:float
    rank:int
    route:str
    source_sha256:str
    model_id:str=PROXY_ID

def clean_bar(symbol:str,start_ms:int,values:Mapping[str,Any],provider:str="YAHOO_FINANCE_CHART_60M")->HourBar|None:
    local=datetime.fromtimestamp(start_ms/1000,tz=timezone.utc).astimezone(NY)
    session_end=nyse_close_utc(local.date())
    if session_end is None:return None
    if not ((local.hour==9 and local.minute==30) or (10<=local.hour<=15 and local.minute==30)):
        # Don't shift Yahoo bars to fit a schedule it didn't actually provide.
        return None
    start_dt=datetime.fromtimestamp(start_ms/1000,tz=timezone.utc)
    if start_dt>=session_end:return None
    end_ms=min(start_ms+HOUR,int(session_end.timestamp()*1000))
    try:
        o,h,l,c,v=(float(values[k]) for k in ("open","high","low","close","volume"))
    except (TypeError,KeyError,ValueError,OverflowError):return None
    if (not all(math.isfinite(x) for x in (o,h,l,c,v)) or
        min(o,h,l,c)<=0 or v<0 or h<max(o,c,l) or l>min(o,c,h)):return None
    return HourBar(symbol,start_ms,end_ms,o,h,l,c,v,local.date().isoformat(),local.strftime("%H:%M"),provider)

def parse_chart(symbol:str,raw:bytes)->tuple[list[HourBar],dict[str,Any]]:
    try:
        root=json.loads(raw)
        error=root["chart"]["error"]
        result=(root["chart"]["result"] or [None])[0]
        if error or not result:raise YahooSourceBlocked("YAHOO_CHART_ERROR:"+str(error)[:120])
        meta=result["meta"]
        tz=meta.get("exchangeTimezoneName")
        granularity=meta.get("dataGranularity")
        if tz not in ("America/New_York","US/Eastern") or granularity not in ("60m","1h"):
            raise ValueError("YAHOO_EXCHANGE_TZ_OR_INTERVAL_UNEXPECTED")
        if meta.get("currency")!="USD":raise ValueError("YAHOO_NON_USD_SYMBOL")
        timestamps=result["timestamp"]
        quote=result["indicators"]["quote"][0]
    except (KeyError,IndexError,TypeError,ValueError) as e:
        if isinstance(e,YahooSourceBlocked) or (isinstance(e,ValueError) and str(e).startswith("YAHOO_")):raise
        raise ValueError("YAHOO_INVALID_CHART_SCHEMA") from e
    if not isinstance(timestamps,list) or not timestamps:
        raise ValueError("YAHOO_EMPTY_TIMESTAMP_ARRAY")
    if any(not isinstance(quote.get(k),list) or len(quote[k])!=len(timestamps)
           for k in ("open","high","low","close","volume")):
        raise ValueError("YAHOO_OHLC_ARRAY_MISMATCH")
    times=[int(ts)*1000 for ts in timestamps]
    if times!=sorted(set(times)):raise ValueError("YAHOO_NON_MONOTONIC_OR_DUPLICATE_TIME")
    bars=[];skipped=Counter()
    for i,ts in enumerate(times):
        row={k:quote[k][i] for k in ("open","high","low","close","volume")}
        bar=clean_bar(symbol,ts,row)
        if bar and SOURCE_START.timestamp()*1000<=ts<BT_END.timestamp()*1000:
            bars.append(bar)
        else:skipped["OUT_OF_SESSION_OR_INVALID_OHLC"]+=1
    if not bars:raise ValueError("YAHOO_NO_VALID_60M_CORE_SESSION_BARS")
    split_events=(result.get("events") or {}).get("splits") or {}
    splits=[int(v.get("date") or k)*1000 for k,v in split_events.items()]
    return bars,{"source":"YAHOO_FINANCE_CHART_60M","symbol":symbol,"raw_sha256":digest(raw),
        "bytes":len(raw),"rows":len(bars),"skipped":dict(skipped),
        "first_start_ms":bars[0].start_ms,"last_start_ms":bars[-1].start_ms,
        "timezone":tz,"currency":"USD","interval":granularity,
        "split_event_count":len(splits),"split_event_times":sorted(splits),
        "status":"ACQUIRED"}

def download_chart(symbol:str,start:datetime=SOURCE_START,end:datetime=BT_END,timeout:float=18)->bytes:
    if symbol not in TICKERS:raise ValueError("YAHOO_SYMBOL_NOT_ALLOWLISTED")
    query=urllib.parse.urlencode({"period1":int(start.timestamp()),"period2":int(end.timestamp()),
        "interval":"60m","includePrePost":"false","events":"history,div,splits"})
    url="https://query1.finance.yahoo.com/v8/finance/chart/"+symbol+"?"+query
    req=urllib.request.Request(url,headers={
        "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept":"application/json","Accept-Language":"en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req,timeout=timeout) as stream:
            if stream.status!=200:raise YahooSourceBlocked("YAHOO_HTTP_"+str(stream.status))
            raw=stream.read(12_000_001)
    except urllib.error.HTTPError as e:
        if e.code in (401,403,429):raise YahooSourceBlocked("YAHOO_ACCESS_BLOCKED_HTTP_"+str(e.code)) from e
        raise YahooSourceBlocked("YAHOO_UPSTREAM_HTTP_"+str(e.code)) from e
    except (urllib.error.URLError,TimeoutError) as e:
        raise YahooSourceBlocked("YAHOO_NETWORK_UNAVAILABLE") from e
    if len(raw)>12_000_000:raise YahooSourceBlocked("YAHOO_RESPONSE_EXCESS_BYTES")
    return raw

def load_chart_or_csv(symbol:str,source_root:Path,*,download:bool=False,csv_root:Path|None=None)->tuple[list[HourBar],dict[str,Any]]:
    """An explicitly supplied CSV is NOT automatically authenticated as Yahoo."""
    raw_path=source_root/"raw-yahoo"/(symbol+".json")
    if raw_path.is_file():
        return parse_chart(symbol,raw_path.read_bytes())
    if csv_root is not None:
        path=csv_root/(symbol+".csv")
        if path.is_file():
            bars=[];raw=path.read_bytes()
            with path.open(newline="",encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    stamp=row.get("Datetime") or row.get("Date") or row.get("date")
                    if not stamp:raise ValueError("YAHOO_CSV_REQUIRES_UTC_OFFSET_DATETIME")
                    at=datetime.fromisoformat(stamp.replace("Z","+00:00"))
                    if at.tzinfo is None:raise ValueError("YAHOO_CSV_NAIVE_DATETIME_REJECTED")
                    row_data={k:row.get(k) or row.get(k.capitalize()) for k in ("open","high","low","close","volume")}
                    bar=clean_bar(symbol,int(at.timestamp()*1000),row_data,"USER_SUPPLIED_YAHOO_CSV_UNVERIFIED")
                    if bar:bars.append(bar)
            if bars!=sorted(bars,key=lambda x:x.start_ms) or len({x.start_ms for x in bars})!=len(bars):
                raise ValueError("CSV_TIMESTAMP_ORDER_OR_DUPLICATES")
            if len(bars)<100:raise ValueError("INSUFFICIENT_USER_YAHOO_CSV_BARS")
            return bars,{"source":"USER_SUPPLIED_YAHOO_CSV_UNVERIFIED","symbol":symbol,
                "raw_sha256":digest(raw),"rows":len(bars),"status":"UNVERIFIED_USER_ORIGIN"}
    if not download:raise YahooSourceBlocked("YAHOO_SOURCE_MISSING_NOT_DOWNLOADED")
    raw=download_chart(symbol)
    source_root.joinpath("raw-yahoo").mkdir(parents=True,exist_ok=True)
    raw_path.write_bytes(raw)
    return parse_chart(symbol,raw)

def load_universe(root:Path,*,download:bool=False,csv_root:Path|None=None)->tuple[dict[str,list[HourBar]],dict[str,Any]]:
    root.mkdir(parents=True,exist_ok=True)
    universe={};files={}
    for symbol in TICKERS:
        rows,meta=load_chart_or_csv(symbol,root,download=download,csv_root=csv_root)
        universe[symbol]=rows;files[symbol]=meta
        # Save derived, source-attributed bars separately from raw HTTP response.
        output=root/"normalized-yahoo"/(symbol+".jsonl")
        output.parent.mkdir(parents=True,exist_ok=True)
        raw=b"".join(json_bytes(asdict(x)) for x in rows)
        output.write_bytes(raw)
        meta["normalized_path"]=str(output.relative_to(root))
        meta["normalized_sha256"]=digest(raw)
    manifest={"schema":1,"type":"V52_YAHOO_60M_PRICE_RESEARCH_INPUT",
        "source_sha":RUNTIME_SHA,"expected_symbols":list(TICKERS),
        "period_start":BT_START.isoformat(),"period_end_exclusive":BT_END.isoformat(),
        "files":files,"status":"ACQUIRED" if all(v["status"]=="ACQUIRED" for v in files.values())
                                   else "USER_ORIGIN_UNVERIFIED",
        "raw_market_data_public_artifact":False}
    (root/"yahoo-acquisition-manifest.json").write_bytes(json_bytes(manifest))
    return universe,manifest

def verify_saved(root:Path)->tuple[dict[str,list[HourBar]],dict[str,Any]]:
    manifest=json.loads((root/"yahoo-acquisition-manifest.json").read_text())
    if manifest.get("source_sha")!=RUNTIME_SHA or manifest.get("expected_symbols")!=list(TICKERS):
        raise ValueError("YAHOO_SAVED_INPUT_MANIFEST_SHA_OR_UNIVERSE_MISMATCH")
    universe={}
    for symbol in TICKERS:
        meta=manifest["files"][symbol]
        norm=(root/meta["normalized_path"]).resolve()
        norm.relative_to(root.resolve())
        raw=norm.read_bytes()
        if digest(raw)!=meta["normalized_sha256"]:raise ValueError("YAHOO_NORMALIZED_SHA256_MISMATCH")
        bars=[HourBar(**json.loads(line)) for line in raw.decode().splitlines() if line]
        if not bars or any(x.symbol!=symbol for x in bars) or bars!=sorted(bars,key=lambda x:x.start_ms):
            raise ValueError("YAHOO_SAVED_CANDLE_INVALID")
        universe[symbol]=bars
    return universe,manifest

def signals(universe:Mapping[str,list[HourBar]],cost_bps:float)->tuple[list[StockSignal],dict[str,int]]:
    """Yahoo share displacement surrogate; not the real Aster basis decision."""
    if not 0<=cost_bps<=60:raise ValueError("UNSUPPORTED_ASSUMED_COSTS")
    by_day=defaultdict(dict)
    for symbol,rows in universe.items():
        for bar in rows:
            if bar.start_ms<int(BT_START.timestamp()*1000) and bar.ny_day<BT_START.astimezone(NY).date().isoformat():
                continue
            by_day[bar.ny_day].setdefault(symbol,{})[bar.start_ny]=bar
    selected=[];skips=Counter()
    for day,prices in sorted(by_day.items()):
        if not (BT_START.astimezone(NY).date().isoformat()<=day<BT_END.astimezone(NY).date().isoformat()):
            continue
        # Without all five symbols and exactly the needed completed bars, a
        # top-ranked trade cannot be called independently reproducible.
        morning={}
        for sym in TICKERS:
            bars=prices.get(sym,{})
            x=bars.get("09:30")
            if not x or not x.open:break
            morning[sym]=x.open
        if len(morning)!=len(TICKERS):
            skips["INCOMPLETE_FIVE_STOCK_0930_OPEN"]+=1;continue
        for slot,window,minimum,convergence,edge in (
            ("V11_EQ","09:30",50.,15.,10.),
            ("V50_POST_OPEN_BASIS","10:30",60.,20.,7.5),
            ("V50_POST_OPEN_BASIS","11:30",60.,20.,7.5),
            ("V50_POST_OPEN_BASIS","12:30",60.,20.,7.5)):
            # Candidate at END of the hourly bar that STARTS at window;
            # 09:30->10:30 for V11, 10:30->11:30 etc for V50.
            observations=[]
            for sym in TICKERS:
                b=prices[sym].get(window)
                if not b:break
                basis=(b.close/morning[sym]-1)*10000
                observations.append((abs(basis),sym,b,basis))
            if len(observations)!=len(TICKERS):
                skips["MISSING_COMPLETE_FIVE_STOCK_WINDOW_"+window]+=1;continue
            observations.sort(key=lambda x:(-x[0],x[1]))
            magnitude,symbol,bar,proxy_basis=observations[0]
            if magnitude<minimum:
                skips[slot+"_BELOW_PRICE_DISPLACEMENT"]+=1;continue
            if magnitude>0 and slot=="V11_EQ" and cost_bps/magnitude>0.75:
                skips["V11_MODEL_COST_TO_DISPLACEMENT_OVER_75PCT"]+=1;continue
            if magnitude-convergence-cost_bps<edge:
                skips[slot+"_NET_EDGE_BELOW_MODEL_THRESHOLD"]+=1;continue
            if not (int(BT_START.timestamp()*1000)<=bar.end_ms<int(BT_END.timestamp()*1000)):
                skips["OUTSIDE_BT_PERIOD"]+=1;continue
            selected.append(StockSignal(slot,symbol,"SHORT" if proxy_basis>0 else "LONG",
                bar.end_ms,bar.close,morning[symbol],proxy_basis,1,
                ("V11_YAHOO_0930_TO_1030" if slot=="V11_EQ" else "V50_YAHOO_"+window.replace(":","")),
                digest(json_bytes(asdict(bar)))))
    return selected,dict(skips)

def bar_end_index(universe:Mapping[str,list[HourBar]])->dict[str,dict[int,HourBar]]:
    result={}
    for symbol,rows in universe.items():
        index={}
        for bar in rows:
            if bar.end_ms in index:raise ValueError("DUPLICATE_YAHOO_BAR_CLOSE:"+symbol)
            index[bar.end_ms]=bar
        result[symbol]=index
    return result

def replay(universe:Mapping[str,list[HourBar]],fx_series:Iterable[Any],cost_bps:float)->dict[str,Any]:
    events=bar_end_index(universe)
    candidates,gate_skips=signals(universe,cost_bps)
    groups=defaultdict(list)
    for x in candidates:groups[x.entry_ms].append(x)
    rates=tuple(sorted(fx_series,key=lambda r:r.event_time_ms))
    deposits=monthly_deposit_events(rates,start_date=BT_START.date(),months=12)
    event_times=sorted({ts for d in events.values() for ts in d if int(BT_START.timestamp()*1000)<=ts<int(BT_END.timestamp()*1000)})
    equity=0.0;deposit_count=0;contributed=0.0
    positions={};marks={};ledger=[];rejected=Counter()
    model_name=next((k for k,v in ASSUMED_COSTS.items() if v==cost_bps),str(cost_bps))
    net_by_slot=Counter();realized_stock_today=0;daily_equity_base=0;current_day=None
    units=0.0;high_unit_nav=1.0;dd=0.0;monthly=[];peak_gross=0.0
    v50_trade_days=Counter()
    for ts in event_times:
        local=datetime.fromtimestamp(ts/1000,timezone.utc).astimezone(NY)
        today=local.date().isoformat()
        if today!=current_day:
            current_day=today
            realized_stock_today=0
            daily_equity_base=max(equity,0)
        for d in deposits[deposit_count:]:
            if d.timestamp_ms>ts:break
            nav_before=equity
            if units==0:units+=d.amount_usdt
            else:units+=d.amount_usdt/(nav_before/units) if nav_before>0 else 0
            equity+=d.amount_usdt
            contributed+=d.amount_usdt
            deposit_count+=1
        # Bookkeeping uses the last actually observed Yahoo close. At a close
        # timestamp, no price from a later Yahoo interval is visible.
        for symbol,series in events.items():
            bar=series.get(ts)
            if bar:marks[symbol]=bar.close
        for slot,p in list(positions.items()):
            bar=events[p["symbol"]].get(ts)
            if not bar:
                # No valid quote for managed symbol at this decision: a complete
                # historical ledger cannot assume a same-time exit price.
                raise ValueError("MISSING_YAHOO_MANAGED_SYMBOL_BAR:"+p["symbol"]+":"+str(ts))
            if ts<=p["entry_ms"]:continue
            displacement=(bar.close/p["reference_price"]-1)*10000
            crossed=p["entry_basis_bps"]*displacement<=0
            converged=abs(displacement)<=(15 if slot=="V11_EQ" else 20) or crossed
            stopped=(displacement*p["entry_basis_bps"]>0 and
                     abs(displacement)>=abs(p["entry_basis_bps"])*(1.5 if slot=="V11_EQ" else 1.75))
            max_time=(slot=="V50_POST_OPEN_BASIS" and ts>=p["entry_ms"]+3*HOUR)
            hard_time=(local.hour>15 or (local.hour==15 and local.minute>=30)
                       or ts>=int(nyse_close_utc(local.date()).timestamp()*1000))
            reason=("MODEL_DISPLACEMENT_STOP" if stopped else "MODEL_DISPLACEMENT_CONVERGED" if converged
                    else "MODEL_THREE_HOUR" if max_time else "SESSION_EXIT" if hard_time else None)
            if reason:
                direction=1 if p["side"]=="LONG" else -1
                gross=direction*p["qty"]*(bar.close-p["entry_price"])
                exit_fee=p["qty"]*bar.close*(cost_bps/2)/10000
                net=gross-exit_fee-p["entry_fee"]
                equity+=gross-exit_fee
                net_by_slot[slot]+=net
                realized_stock_today+=net
                ledger.append({**p,"exit_ms":ts,"exit_price":bar.close,
                    "gross_pnl_usd":round(gross,9),"net_pnl_usd":round(net,9),
                    "exit_fee_usd":round(exit_fee,9),"exit_reason":reason,
                    "fill_assumption":"EXACT_YAHOO_COMPLETED_60M_CLOSE_AT_DECISION_TIMESTAMP_NO_L2"})
                del positions[slot]
        # Yahoo price-only model cannot observe stock inside the candle.
        # Its signal is known at the close. Assume instant fill at that CLOSE.
        if ts in groups:
            for c in sorted(groups[ts],key=lambda x:(x.slot!="V11_EQ",x.symbol)):
                if c.slot in positions:
                    rejected["SLOT_OCCUPIED"]+=1;continue
                if any(p["symbol"]==c.symbol for p in positions.values()):
                    rejected["SYMBOL_ALREADY_OWNED"]+=1;continue
                if daily_equity_base>0 and realized_stock_today<=-0.035*daily_equity_base:
                    rejected["STOCK_DAILY_LOSS_GATE"]+=1;continue
                if c.slot=="V50_POST_OPEN_BASIS" and v50_trade_days[today]>=3:
                    rejected["V50_MAX_THREE_TRADES_PER_DAY"]+=1;continue
                if any(p["side"] not in ("LONG","SHORT") for p in positions.values()):
                    raise ValueError("CORRUPT_POSITION_SIDE")
                if c.entry_ms!=ts or c.entry_price<=0:
                    rejected["BAD_EVENT_ALIGNMENT"]+=1;continue
                mark=marks.get(c.symbol)
                if mark is None or abs(mark-c.entry_price)>1e-7:
                    rejected["YAHOO_PRICE_NOT_ASOF_DECISION"]+=1;continue
                marked_equity=equity+sum((1 if p["side"]=="LONG" else -1)*p["qty"]*
                    (marks[p["symbol"]]-p["entry_price"]) for p in positions.values())
                gross_other=sum(p["qty"]*marks[p["symbol"]] for p in positions.values())
                available=max(0,4.0-gross_other/max(marked_equity,1e-9)-0.02)
                desired=min(2.0,available)
                if desired<0.1 or equity<=0:
                    rejected["STOCK_GROSS_CAP_OR_EQUITY"]+=1;continue
                notional=marked_equity*desired
                qty=notional/c.entry_price
                fee=notional*(cost_bps/2)/10000
                if fee>=equity:rejected["FEE_GREATER_THAN_EQUITY"]+=1;continue
                equity-=fee
                positions[c.slot]={"slot":c.slot,"symbol":c.symbol,"side":c.side,
                    "entry_ms":ts,"entry_price":c.entry_price,"reference_price":c.reference_price,
                    "entry_basis_bps":c.yahoo_displacement_bps,"qty":qty,"gross_at_entry":desired,
                    "entry_fee":fee,"route":c.route,"runtime_sha":RUNTIME_SHA,"model_id":PROXY_ID}
                if c.slot=="V50_POST_OPEN_BASIS":v50_trade_days[today]+=1
        stock_notional=sum(p["qty"]*marks[p["symbol"]] for p in positions.values())
        marked_nav=equity+sum((1 if p["side"]=="LONG" else -1)*p["qty"]*
          (marks[p["symbol"]]-p["entry_price"]) for p in positions.values())
        if marked_nav>0:peak_gross=max(peak_gross,stock_notional/marked_nav)
        unit_nav=marked_nav/max(units,1e-12)
        high_unit_nav=max(high_unit_nav,unit_nav)
        dd=min(dd,unit_nav/high_unit_nav-1)
        # Save as-of previous available FX, never assume a later ECB observation.
        month=local.strftime("%Y-%m")
        if not monthly or monthly[-1]["month"]!=month:
            monthly.append({"month":month,"last_event_ms":ts,"nav_usd_model":round(marked_nav,6),
                "contributions_usd":round(contributed,6),
                "open_stock_positions":len(positions),"nav_per_unit":round(unit_nav,8)})
        else:monthly[-1].update({"last_event_ms":ts,"nav_usd_model":round(marked_nav,6),
            "contributions_usd":round(contributed,6),
            "open_stock_positions":len(positions),"nav_per_unit":round(unit_nav,8)})
    if positions:raise ValueError("V52_POSITIONS_OPEN_AT_BT_END_NO_SYNTHETIC_LIQUIDATION")
    final_fx=next((r for r in reversed(rates) if r.event_time_ms<=event_times[-1]),None)
    if final_fx is None:raise ValueError("NO_ASOF_FX_FOR_FINAL_EQUITY")
    gains=sum(t["net_pnl_usd"] for t in ledger if t["net_pnl_usd"]>0)
    losses=-sum(t["net_pnl_usd"] for t in ledger if t["net_pnl_usd"]<0)
    for r in monthly:
        at=r["last_event_ms"]
        fx=next((x for x in reversed(rates) if x.event_time_ms<=at),None)
        r["fx_jpy_per_usd"]=round(fx.rate_jpy_per_usd,6) if fx else None
        r["nav_jpy_model"]=round(r["nav_usd_model"]*fx.rate_jpy_per_usd,2) if fx else None
    return {"type":"V52_YAHOO_PRICE_ONLY_MODEL_NOT_ASTER_LIVE_PARITY",
        "source_sha":RUNTIME_SHA,"model":model_name,
        "entry_fill_assumption":"EXACT_YAHOO_60M_COMPLETED_CLOSE_AT_1030_1130_1230_1330_NY",
        "orderbook_required":False,"actual_aster_basis_measured":False,"actual_v52_live_gate_parity":False,
        "historical_exact_fills_verified":False,"independent_stock_only_not_shared_five_logic":True,
        "selected_yahoo_proxy_candidates":len(candidates),
        "proxy_signal_count_by_slot":dict(Counter(x.slot for x in candidates)),
        "gate_rejections":gate_skips,"portfolio_rejections":dict(rejected),
        "modeled_completed_trades":len(ledger),
        "wins":sum(r["net_pnl_usd"]>0 for r in ledger),
        "losses":sum(r["net_pnl_usd"]<0 for r in ledger),
        "win_rate_pct":round(100*sum(r["net_pnl_usd"]>0 for r in ledger)/len(ledger),5) if ledger else None,
        "profit_factor_model":round(gains/losses,6) if losses>0 else None,
        "final_usd_model":round(equity,6),
        "final_jpy_model":round(equity*final_fx.rate_jpy_per_usd,2),
        "net_after_contributions_usd_model":round(equity-contributed,6),
        "contributions_jpy":deposit_count*10000,"contributions_usd":round(contributed,6),
        "max_drawdown_pct_model":round(dd*100,5),"max_stock_gross_model":round(peak_gross,5),
        "by_slot_net_pnl_usd_model":{k:round(net_by_slot[k],6) for k in SLOTS},
        "monthly":monthly,"ledger":ledger}

def run(data_root:Path,yahoo_root:Path,out_root:Path,*,download:bool=False,csv_root:Path|None=None)->dict[str,Any]:
    source_manifest=json.loads(Path(__file__).with_name("runtime_source_manifest.json").read_text())
    if source_manifest.get("runtime_sha")!=RUNTIME_SHA or source_manifest.get("verified_repository_commit")!=RUNTIME_SHA:
        raise ValueError("ACTIVE_RELEASE_NOT_PINNED")
    universe,manifest=load_universe(yahoo_root,download=download,csv_root=csv_root)
    fx,issues=load_fred_fx(data_root)
    if issues or not fx:raise ValueError("CANNOT_REPLAY_WITHOUT_VALID_ASOF_FX")
    out_root.mkdir(parents=True,exist_ok=True)
    scenarios=[]
    for name,cost in ASSUMED_COSTS.items():
        result=replay(universe,fx,cost)
        ledger=result.pop("ledger")
        path=out_root/(name+"-v52-yahoo-assumed-fill-ledger.jsonl")
        payload=b"".join(json_bytes(row) for row in ledger)
        path.write_bytes(payload)
        result["ledger"]={"path":path.name,"sha256":digest(payload),"rows":len(ledger)}
        (out_root/(name+"-v52-yahoo-assumed-fill.json")).write_bytes(json_bytes(result))
        scenarios.append(result)
    report={"status":"YAHOO_SHARE_PRICE_ASSUMED_FILL_RESEARCH_NOT_LIVE_PARITY",
        "pin_sha":RUNTIME_SHA,"source":manifest,
        "limitations":["Aster perp/share basis cannot be derived from Yahoo share OHLC; gate is explicitly a displacement substitute.",
          "Yahoo 60m price at the decision bar close is assumed immediately fillable by user instruction; no L2, spread, queue or actual crypto venue fills.",
          "V11 10:00 signal capture and V50 10-second pre-window observation cannot be reconstructed from Yahoo hourly bars.",
          "Stock-only model: shared crypto Gross competition and real V52 daily margin-risk/preemption are not replayed.",
          "Fee models are research assumptions, not the verified historical account Aster fee tier."],
        "scenarios":scenarios,"raw_data_public_artifacts":False}
    (out_root/"v52-yahoo-research-report.json").write_bytes(json_bytes(report))
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data-root",type=Path,required=True,help="Existing validated Aster acquisition root for as-of ECB FX")
    p.add_argument("--yahoo-root",type=Path,required=True)
    p.add_argument("--out-root",type=Path,required=True)
    p.add_argument("--download",action="store_true",help="Access Yahoo only on explicit invocation; fail on 429")
    p.add_argument("--csv-root",type=Path,help="User-supplied Yahoo 60m CSV; provenance labeled unverified")
    a=p.parse_args()
    try:
        r=run(a.data_root,a.yahoo_root,a.out_root,download=a.download,csv_root=a.csv_root)
    except YahooSourceBlocked as e:
        print(json.dumps({"status":"YAHOO_SOURCE_BLOCKED","reason":str(e),
            "verified_performance_available":False,"synthetic_returns_fabricated":False}))
        raise SystemExit(3)
    for s in r["scenarios"]:
        print("YAHOO_V52_RESEARCH_ONLY",json.dumps({k:s[k] for k in (
            "model","selected_yahoo_proxy_candidates","modeled_completed_trades","win_rate_pct",
            "profit_factor_model","final_jpy_model","max_drawdown_pct_model",
            "by_slot_net_pnl_usd_model","historical_exact_fills_verified")},sort_keys=True))
    print("YAHOO_V52_PROVENANCE_STATUS="+r["source"]["status"])
    print("NOT_ASTER_V52_LIVE_SIGNAL_OR_FORMAL_5LOGIC_PARITY=TRUE")
if __name__=="__main__":main()
