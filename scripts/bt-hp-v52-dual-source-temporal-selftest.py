"""V52 source-exact V50 selection across invented two-source microquote timelines.

Runs original 85-line Python method in a no-I/O fake shell on observations
from synthetic stock candles and additional modeled Aster/reference microquotes.
The quote sources and any selected candidate are FICTIONAL; no fills/PnL.

Usage: python scripts/bt-hp-v52-dual-source-temporal-selftest.py [trace.json]
Without file: launch local already-installed tsx CLI using node, no network.
"""
from __future__ import annotations
import collections,hashlib,importlib.util,json,subprocess,sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/"lib"/"bt-verification"/"pinned-native-v52"
m=json.loads((SRC/"v50-source-manifest.json").read_text(encoding="utf-8"))
module_file=SRC/"v50_candidate_original_method.py"
src=module_file.read_text(encoding="utf-8").replace("\r\n","\n")
assert hashlib.sha256(src.split("class V52NativeCandidateOfflineShell:\n",1)[1].encode()).hexdigest()==m["methodSha256NormalLf"]
spec=importlib.util.spec_from_file_location("bt_v52_native_v50_source",module_file)
assert spec is not None and spec.loader is not None
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
spec=importlib.util.spec_from_file_location("bt_v52_native_amzn_yahoo",SRC/"amzn_yahoo_gate_pure.py")
assert spec is not None and spec.loader is not None
amzn=importlib.util.module_from_spec(spec);spec.loader.exec_module(amzn)

if len(sys.argv)==2:
 data=Path(sys.argv[1]).read_bytes()
 text=data.decode("utf-8-sig")
else:
 cli=ROOT/"node_modules"/"tsx"/"dist"/"cli.mjs"
 assert cli.is_file(),"OFFLINE_TYPESCRIPT_CLI_REQUIRED"
 data=subprocess.check_output(["node",str(cli),"scripts/bt-hp-v52-dual-source-synthetic-input.ts",
   "20261115","rotation"],cwd=ROOT,timeout=125)
 text=data.decode("utf-8-sig")
trace=json.loads(text)
assert trace["schema"]=="disdex-bt-v52-dual-source-input-v1"
assert trace["stockReferenceTruth"] is False and trace["venueTruth"] is False
assert trace["fills"]==0 and trace["fullV52Parity"] is False
assert trace["sessionCalendar"]=="NY_WEEKDAY_RTH_ONLY_NO_HOLIDAYS"
assert trace["sourceTiming"]=="five-second-before-and-after-scheduled-NY-entry"
assert len(trace["inputs"])==39
universe={"AMZN","META","MSFT","NVDA","TSLA"}
clock={"now":0}
def finite(val,default=0.0):
    try:
        f=float(val)
        return f if f==f and abs(f)<float("inf") else default
    except (TypeError,ValueError):
        return default
native.base=SimpleNamespace(
 now_ms=lambda:clock["now"],finite=finite,
 V11_MAX_DATA_AGE_MS=120_000,V11_MAX_SOURCE_CLOCK_DIFF_MS=60_000
)
telemetry=[]
native.append_v52_diagnostic=lambda state,*,ny_day,row:telemetry.append(row.copy())

class Book:
    def __init__(self,quote:dict):
        self.mid=quote["asterMid"]
        self.bid=quote["asterBid"]
        self.ask=quote["asterAsk"]
        self.received_ms=quote["asterReceivedMs"]
        self.spread_bps=quote["spreadBps"]
        self._depth=quote["depthUsd"]
        self.cost_bps=quote["roundTripCostBps"]
    def depth_usd(self,action):
        assert action in ("SELL","BUY")
        return self._depth
class Ref:
    def __init__(self,quote:dict):
        self.price=quote["referencePrice"]
        self.received_ms=quote["referenceReceivedMs"]
class Engine(native.V52NativeCandidateOfflineShell):
    def __init__(self,signal:dict):
        self.state={"v50SignalBasis":{signal["window"]:signal["basis"]}}
        self.aster_maker_fee_bps=2.0;self.aster_taker_fee_bps=4.0
        self.v11_safety_buffer_bps=3.0;self.stock_gross_cap=1.5
        self.saves=0;self.logs=[]
    def current_local_time(self):
        return datetime.fromtimestamp(clock["now"]/1000,tz=ZoneInfo("America/New_York"))
    def positions(self):
        return {}
    def gross_snapshot(self):
        # No reservation, orders, or portfolio interaction is modeled.
        return {"equityUsd":1000.0,"stockGross":0.2,"totalGross":0.8}
    def estimate_v11_cost(self,book,action,notional):
        return book.cost_bps,{"spreadBps":book.spread_bps,
                              "safetyBufferBps":self.v11_safety_buffer_bps}
    def save(self):self.saves+=1
    def log(self,name,**kw):self.logs.append(name)
    def _amzn_short_yahoo_gate(self,ms):
        # No confirmed independently sourced Yahoo H1 bars have been supplied.
        # It is correct to reject AMZN SHORT entry; don't manufacture a PASS.
        return amzn.evaluate_amzn_short_yahoo_gate(decision_ms=ms,bars=[])

windows={"11:30","12:30","13:30"}
counts=collections.Counter()
rejections=collections.Counter()
candidates=[]
last=-1
for event in trace["inputs"]:
    assert event["window"] in windows
    capture=event["captureAtMs"];decision=event["decisionAtMs"]
    observed=int(datetime.fromisoformat(event["lastObserved5m"].replace("Z","+00:00")).timestamp()*1000)
    assert capture-observed==295_000
    assert decision-capture==10_000
    assert capture<decision and decision>last
    last=decision
    assert len(event["pairs"])==5
    assert {p["symbol"] for p in event["pairs"]}==universe
    signal={}
    rows={}
    for p in event["pairs"]:
        sym=p["symbol"]
        before=p["capture"];after=p["decision"]
        for quote,asof in ((before,capture),(after,decision)):
            assert quote["referenceReceivedMs"]<=asof
            assert quote["asterReceivedMs"]<=asof
            assert asof-quote["referenceReceivedMs"]<=120_000
            assert asof-quote["asterReceivedMs"]<=120_000
            assert quote["referencePrice"]>0 and quote["asterBid"]>0
            assert quote["asterBid"]<quote["asterMid"]<quote["asterAsk"]
            assert quote["spreadBps"]>0 and quote["depthUsd"]>0
        signal[sym]=(before["asterMid"]/before["referencePrice"]-1)*10000
        rows[sym]=(Book(after),None,Ref(after))
    clock["now"]=decision
    engine=Engine({"window":event["window"],"basis":signal})
    candidate,rejected=engine.v50_candidate(event["window"],rows,500.0)
    assert set(rejected)==universe
    assert engine.saves==1 and len(engine.logs)==5
    assert all(isinstance(v,list) for v in rejected.values())
    counts["windows"]+=1
    for sym,reasons in rejected.items():
        if not reasons:counts["source_eligible_rows"]+=1
        for reason in reasons:rejections[reason]+=1
    if candidate:
        assert not rejected[candidate["symbol"]]
        assert candidate["symbol"] in universe
        assert candidate["side"] in ("BUY","SELL")
        assert candidate["route"]=="POST_"+event["window"].replace(":","")
        counts["selected_native_candidates"]+=1
        candidates.append({"at":datetime.fromtimestamp(decision/1000,ZoneInfo("America/New_York")).isoformat(),
                           "symbol":candidate["symbol"],
                           "side":candidate["side"],"window":event["window"],
                           "basisBps":round(candidate["basisBps"],5)})
    if event["window"]=="11:30":counts["1130"]+=1
    if event["window"]=="12:30":counts["1230"]+=1
    if event["window"]=="13:30":counts["1330"]+=1
assert counts["windows"]==39
assert all(counts[k]==13 for k in ("1130","1230","1330"))
assert counts["selected_native_candidates"]>0
assert sum(rejections.values())>0
assert rejections["BASIS_BELOW_60"]>0
assert rejections["AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE"]>0
assert len(telemetry)==39*5
assert len(candidates)==counts["selected_native_candidates"]
print("PASS V52 source-exact V50 temporal dual-source fixture (artificial) "+json.dumps({
 "schema":"disdex-bt-v52-dual-source-audit-v1",
 "inputFrames":counts["windows"],"candidateRows":39*5,
 "selectedNativeCandidatesNotTrades":counts["selected_native_candidates"],
 "sourceEligibleRowsNotTrades":counts["source_eligible_rows"],
 "rejections":dict(sorted(rejections.items())),
 "traceSha256":hashlib.sha256(text.encode("utf-8")).hexdigest(),
 "orders":0,"fills":0,"stockProfit":None,"fullV52Parity":False,
 "examples":candidates[:5]
},ensure_ascii=False,separators=(",",":")))
