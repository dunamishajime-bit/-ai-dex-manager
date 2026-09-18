from __future__ import annotations
import csv
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import research_flat_boost_preemption_20260918 as residual
import research_all_sleeves_dynamic_gross_20260918 as all_sleeves

Q102_CAPS = {"HIGH_VOL":1.665,"MR":1.0,"BRK":2.475,"REV":2.5,"PB":2.5}
BASE_V12_GROSS = 1.5
V12_PER_POSITION = 1.0
PENGU_GROSS = 0.85
STOCK_GROSS = 1.98
STOCK_SLOT = 1.64
CRYPTO_GROSS = 3.0
TOTAL_GROSS = 3.5

def replace_once(source: str, old: str, new: str) -> str:
    if old not in source:
        raise RuntimeError("PATCH_MISSING:" + old[:120])
    return source.replace(old, new, 1)

def patched_source(canonical_runner: Path) -> str:
    src = residual.build_exact_source(canonical_runner)
    src = replace_once(
        src,
        'PENGU_MAX_GROSS = 0.85\nSTOCK_GROSS_CAP = 1.5',
        'PENGU_MAX_GROSS = 0.85\n'
        'V12_BASE_GROSS_CAP = 1.5\nV12_DYNAMIC_GROSS_CAP = 2.0\n'
        'V12_DYNAMIC_FEE = 0.0005\nV12_DYNAMIC_SLIP = 0.0\n'
        'V12_FUNDING_BY_SYMBOL = {}\n_V12_DAY_OPEN_CACHE = {}\n'
        'STOCK_GROSS_CAP = 1.5',
    )
    needle = '''    def supp_gross() -> float:
        return sum(position_gross(p) for p in active_supp.values())

    def record_gross_snapshot(ts: int) -> None:
'''
    replacement = '''    def supp_gross() -> float:
        return sum(position_gross(p) for p in active_supp.values())

    def v12_base_gross() -> float:
        return sum(max(0.0, finite(p.get("baseAllocatedGross", p.get("allocatedGrossAtEntry", 0.0)))) for p in active_v12.values())

    def v12_daily_open(symbol: str, ts: int) -> float:
        when = dt.datetime.fromtimestamp(ts / 1000, tz=UTC)
        ex = f"{symbol}USDT"
        day = when.strftime("%Y-%m-%d")
        key = (ex, day)
        rows = _V12_DAY_OPEN_CACHE.get(key)
'''
    replacement += '''        if rows is None:
            url = f"https://data.binance.vision/data/futures/um/daily/klines/{ex}/1m/{ex}-1m-{day}.zip"
            req = urllib.request.Request(url, headers={"User-Agent":"v12-dynamic-residual/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = resp.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as zf:
                names=[n for n in zf.namelist() if n.lower().endswith(".csv")]
                if len(names)!=1: raise RuntimeError(f"V12 archive members {names}")
                text=zf.read(names[0]).decode("utf-8")
            rows={}
            for row in csv.reader(io.StringIO(text)):
                if row and row[0].lstrip("-").isdigit():
                    raw=int(row[0]); raw = raw//1000 if raw>10_000_000_000_000 else raw
                    rows[raw]=float(row[1])
            _V12_DAY_OPEN_CACHE[key]=rows
        price=rows.get(int(ts))
        if price is None or price<=0: raise RuntimeError(f"V12 1m open missing {symbol} {ts}")
        return price

    def v12_funding_sum(symbol: str, entry_ts: int, exit_ts: int) -> float:
        return sum(finite(x.get("rate")) for x in V12_FUNDING_BY_SYMBOL.get(symbol, [])
                   if int(x.get("ts",0)) > entry_ts and int(x.get("ts",0)) <= exit_ts)

    def v12_partial_return(p: dict, ts: int) -> tuple[float,float]:
        mark=v12_daily_open(str(p["symbol"]),ts)
        side=str(p.get("side"))
        entry=finite(p.get("entryPrice"))
'''
    replacement += '''        exit_px=mark*(1.0-V12_DYNAMIC_SLIP if side=="long" else 1.0+V12_DYNAMIC_SLIP)
        gross=(exit_px/entry-1.0) if side=="long" else (1.0-exit_px/entry)
        funding=v12_funding_sum(str(p["symbol"]),int(p["entryTs"]),ts)
        funding_cost=funding*(1.0 if side=="long" else -1.0)
        net=gross-V12_DYNAMIC_FEE-(exit_px/entry)*V12_DYNAMIC_FEE-funding_cost
        return net, mark

    def trim_v12_boost(ts: int, reason: str) -> bool:
        nonlocal equity, crypto_day_pnl, crypto_latched, twr_index, twr_peak, max_drawdown
        trimmed_any=False
        for p in active_v12.values():
            boost_notional=max(0.0,finite(p.get("boostNotionalJpy")))
            boost_gross=max(0.0,finite(p.get("boostAllocatedGross")))
            if boost_notional<=1e-9 or boost_gross<=1e-12: continue
            net,mark=v12_partial_return(p,ts)
            before=max(0.001,equity); pnl=boost_notional*net; er=pnl/before
            equity=max(0.001,equity+pnl); twr_index*=max(0.000001,1.0+er)
            twr_peak=max(twr_peak,twr_index); max_drawdown=min(max_drawdown,twr_index/twr_peak-1.0)
            key=dt.datetime.fromtimestamp(ts/1000,tz=UTC).strftime("%Y-%m")
            monthly_event_returns[key].append(er)
            crypto_day_pnl+=pnl
            if not crypto_latched and crypto_day_pnl/max(0.001,day_start_equity)<=CRYPTO_DAILY_LOSS_LIMIT:
                crypto_latched=True; stats["CRYPTO_DAILY_LOSS_LATCHES"]+=1
            p["entryNotional"]=max(0.0,finite(p.get("entryNotional"))-boost_notional)
            p["allocatedGrossAtEntry"]=max(0.0,finite(p.get("allocatedGrossAtEntry"))-boost_gross)
            p["boostNotionalJpy"]=0.0; p["boostAllocatedGross"]=0.0
            stats["V12_DYNAMIC_BOOST_TRIMS"]+=1
            trimmed_any=True
'''
    replacement += '''            events.append({"ts":ts,"entryTs":p.get("entryTs"),"exitTs":ts,
                "strategy":"V12_DYNAMIC_BOOST_TRIM","sleeve":"V12","symbol":p.get("symbol"),
                "pnlJpy":pnl,"eventReturn":er,"allocatedGrossAtEntry":boost_gross,
                "requestedGross":p.get("requestedGross"),"exitReason":reason,
                "markPrice":mark,"priceSource":"BINANCE_VISION_USDM_1M_OPEN"})
        return trimmed_any

    def add_v12_boost(pid: str, ts: int) -> None:
        p=active_v12.get(pid)
        if p is None: return
        base_alloc=max(0.0,finite(p.get("allocatedGrossAtEntry")))
        p["baseAllocatedGross"]=base_alloc
        p["boostAllocatedGross"]=0.0; p["boostNotionalJpy"]=0.0
        head=max(0.0,finite(p.get("requestedGross"))-base_alloc)
        vg,pg,sg,ug=v12_gross(),pengu_gross(),stock_gross(),supp_gross()
        extra=min(head,max(0.0,V12_DYNAMIC_GROSS_CAP-vg),
                  max(0.0,CRYPTO_GROSS_CAP-vg-pg-ug),
                  max(0.0,TOTAL_GROSS_CAP-vg-pg-sg-ug))
        if extra<=1e-12: return
        notional=max(0.001,equity)*extra
        p["allocatedGrossAtEntry"]=base_alloc+extra
        p["boostAllocatedGross"]=extra; p["boostNotionalJpy"]=notional
        p["entryNotional"]=finite(p.get("entryNotional"))+notional
        stats["V12_DYNAMIC_BOOST_ENTRIES"]+=1
        stats["V12_DYNAMIC_BOOST_GROSS_MILLI"]+=int(round(extra*1000))

    def record_gross_snapshot(ts: int) -> None:
'''
    src = replace_once(src, needle, replacement)
    src = replace_once(
        src,
        '''            requested = min(V12_PER_POSITION_GROSS_CAP, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
''',
        '''            trim_v12_boost(ts, "V12_BASE_ENTRY_PREEMPT")
            requested = min(V12_PER_POSITION_GROSS_CAP, max(0.0, finite(trade.get("requestedGross"))))
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
''',
    )
    old = '''            active_v12[pid] = {"strategy": "V12", "symbol": symbol, "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated, "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")), "exitReason": trade.get("exitReason")}
'''
    new = '''            active_v12[pid] = {"strategy": "V12", "symbol": symbol, "entryTs": int(trade["entryTs"]),
                "side": str(trade.get("side")), "entryPrice": finite(trade.get("entryPrice")),
                "entryNotional": equity * allocated, "allocatedGrossAtEntry": allocated,
                "baseAllocatedGross": allocated, "boostAllocatedGross": 0.0, "boostNotionalJpy": 0.0,
                "requestedGross": requested, "netUnitReturn": finite(trade.get("netUnitReturn")),
                "exitReason": trade.get("exitReason")}
'''
    src = replace_once(src, old, new)
    src = replace_once(
        src,
        '''            stats["V12_ENTERED"] += 1
            observe_entry(kind, ts)
            continue
''',
        '''            stats["V12_ENTERED"] += 1
            observe_entry(kind, ts)
            add_v12_boost(pid, ts)
            record_gross_snapshot(ts)
            continue
''',
    )
    src = replace_once(
        src,
        '''            if active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                continue
            requested = min(PENGU_MAX_GROSS''',
        '''            if active_pengu is not None:
                stats["PENGU_SLOT_OCCUPIED"] += 1
                continue
            trim_v12_boost(ts, "PENGU_ENTRY_PREEMPT")
            requested = min(PENGU_MAX_GROSS''',
    )
    old = '''            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
            available = min(slot_cap, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - vg - pg - sg))
            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS
            if available + 1e-12 < minimum:
'''
    new = '''            slot_cap = V11_GROSS_CAP if strategy == "V11_EQ" else V50_GROSS_CAP
            pg, sg = pengu_gross(), stock_gross()
            minimum = FIRST_STOCK_MIN_GROSS if not active_stock else SECOND_STOCK_MIN_GROSS
            baseline_available=min(slot_cap,max(0.0,STOCK_GROSS_CAP-sg),
                max(0.0,TOTAL_GROSS_CAP-v12_base_gross()-pg-sg))
            trimmed_boost=False
            if baseline_available + 1e-12 >= minimum:
                trimmed_boost=trim_v12_boost(ts, "STOCK_ENTRY_PREEMPT")
            vg=v12_gross()
            dynamic_buffer=0.001 if trimmed_boost else 0.0
            available = min(slot_cap, max(0.0, STOCK_GROSS_CAP - sg), max(0.0, TOTAL_GROSS_CAP - dynamic_buffer - vg - pg - sg))
            if available + 1e-12 < minimum:
'''
    src = replace_once(src, old, new)
    return src

def load_dynamic_engine(canonical_runner: Path, funding_path: Path):
    os.environ.setdefault("SUPPLEMENT_GROSS_CAP","2.5")
    source=patched_source(canonical_runner)
    generated=ROOT/"scripts"/f".generated-v12-dynamic-{os.getpid()}.py"
    generated.write_text(source,encoding="utf-8")
    spec=importlib.util.spec_from_file_location("v12_dynamic_engine",generated)
    if spec is None or spec.loader is None:
        raise RuntimeError("IMPORT_SPEC_FAILED")
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    funding=json.loads(funding_path.read_text(encoding="utf-8"))
    mod.V12_FUNDING_BY_SYMBOL=funding["fundingBySymbol"]
    return mod,generated

def run_case(engine,v12,pengu,frozen,v11,v50,scenario: str,dynamic_cap: float):
    engine.V12_GROSS_CAP=BASE_V12_GROSS
    engine.V12_BASE_GROSS_CAP=BASE_V12_GROSS
    engine.V12_DYNAMIC_GROSS_CAP=dynamic_cap
    engine.V12_PER_POSITION_GROSS_CAP=V12_PER_POSITION
    engine.PENGU_MAX_GROSS=PENGU_GROSS
    engine.STOCK_GROSS_CAP=STOCK_GROSS
    engine.V11_GROSS_CAP=STOCK_SLOT
    engine.V50_GROSS_CAP=STOCK_SLOT
    engine.CRYPTO_GROSS_CAP=CRYPTO_GROSS
    engine.TOTAL_GROSS_CAP=TOTAL_GROSS
    engine.SUPPLEMENT_GROSS_CAP=max(Q102_CAPS.values())
    engine.SUPPLEMENT_AGGREGATE_GROSS_CAP=engine.SUPPLEMENT_GROSS_CAP
    if scenario=="NORMAL":
        engine.V12_DYNAMIC_FEE=0.0005
        engine.V12_DYNAMIC_SLIP=0.0
    else:
        engine.V12_DYNAMIC_FEE=0.0010
        engine.V12_DYNAMIC_SLIP=0.0005
    assumptions=engine.SCENARIOS[scenario]
    mode=str(assumptions["ledgerMode"])
    supp=all_sleeves.supplement_rows(engine,frozen,scenario,Q102_CAPS)
    return engine.simulate(
        v12["modes"][mode]["trades"],pengu["modes"][mode]["trades"],
        v11,v50,engine.finite(assumptions["stockCostBps"]),supp,
    )

def main():
    src=Path(os.environ.get("RESEARCH_SOURCE_ROOT", str(ROOT)))
    v12_path=src/".research-state/btc-q102x1-sweep/v12-q54-atr0p014.json"
    pengu_path=src/".research-state/btc-q102x1-sweep/pengu-hard-cooldown/pengu-hard-cd24.json"
    q102_path=src/".research-state/btc-q102x1-sweep/candidate-1slot.csv"
    stock_path=src/".research-state/q102-2slot-compare/inputs/stock-cache"
    runner=src/".research-state/btc-q102x1-sweep/run_canonical_margin_compare.py"
    funding=Path(os.environ.get("V12_DYNAMIC_FUNDING", str(ROOT/".research-state/v12-dynamic-residual/funding.json")))
    engine,generated=load_dynamic_engine(runner,funding)
    try:
        v12=json.loads(v12_path.read_text(encoding="utf-8"))
        pengu=json.loads(pengu_path.read_text(encoding="utf-8"))
        v11,v50,_,diag=engine.build_stock(stock_path)
        with q102_path.open(newline="",encoding="utf-8") as f:
            frozen=list(csv.DictReader(f))
        rows=[]
        expected={
            "NORMAL":{"V12_ENTERED":874,"PENGU_ENTERED":66,"V11_EQ_ENTERED":50,"V50_POST_OPEN_BASIS_ENTERED":93,"SUPPLEMENT_ENTERED":69},
            "SEVERE":{"V12_ENTERED":871,"PENGU_ENTERED":66,"V11_EQ_ENTERED":0,"V50_POST_OPEN_BASIS_ENTERED":0,"SUPPLEMENT_ENTERED":69},
        }
        for cap in (1.515,):
            for scenario in ("NORMAL","SEVERE"):
                result=run_case(engine,v12,pengu,frozen,v11,v50,scenario,cap)
                routing=result["routingDiagnostics"]
                gross=result["grossVerification"]
                parity=all(int(routing.get(k,0))==v for k,v in expected[scenario].items())
                rows.append({
                    "dynamicCap":cap,"scenario":scenario,
                    "endingAssetJpy":result["endingAssetJpy"],
                    "profitFactor":result["profitFactor"],
                    "maxDrawdownPct":result["maxDrawdownPctClosedEventTwr"],
                    "trades":result["trades"],"coreFillParity":parity,
                    "grossConflicts":len(gross["supplementGrossConflicts"]),
                    "grossConflictRows":gross["supplementGrossConflicts"][:10],
                    "maxCryptoGross":gross["entryTimeMaxCryptoGross"],
                    "maxTotalGross":gross["entryTimeMaxTotalGross"],
                    "maxV12Gross":gross["entryTimeMaxV12Gross"],
                    "boostEntries":int(routing.get("V12_DYNAMIC_BOOST_ENTRIES",0)),
                    "boostTrims":int(routing.get("V12_DYNAMIC_BOOST_TRIMS",0)),
                    "boostGrossAllocated":int(routing.get("V12_DYNAMIC_BOOST_GROSS_MILLI",0))/1000.0,
                    "routing":{k:int(routing.get(k,0)) for k in expected[scenario]},
                })
        payload={
            "schema":"v12-dynamic-residual-boost/v1","researchOnly":True,
            "q102Caps":Q102_CAPS,"v52":{"aggregate":STOCK_GROSS,"slot":STOCK_SLOT},
            "caps":{"crypto":CRYPTO_GROSS,"total":TOTAL_GROSS,"v12Base":BASE_V12_GROSS},
            "rows":rows,"stockDiagnostics":diag,
            "safety":{"ordersSent":False,"liveChanged":False,"vpsChanged":False,"productionChanged":False},
        }
        out=ROOT/"docs/research-results/v12-dynamic-residual-boost-20260919.json"
        out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps(rows,ensure_ascii=False,indent=2))
    finally:
        generated.unlink(missing_ok=True)

if __name__=="__main__":
    main()
