"""Offline parity tests for the source-exact V52 V50 candidate METHOD.
Venue-book and external reference prices are independently injected test
objects; all save/log/yahoo calls are memory-only stubs. No live imports.
"""
from __future__ import annotations
import ast,hashlib,importlib.util,json,sys
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/"lib"/"bt-verification"/"pinned-native-v52"
manifest=json.loads((SRC/"v50-source-manifest.json").read_text(encoding="utf-8"))
path=SRC/"v50_candidate_original_method.py"
content=path.read_text(encoding="utf-8").replace("\r\n","\n")
method='class V52NativeCandidateOfflineShell:\n'
assert content.count(method)==1
method_body=content.split(method,1)[1]
assert hashlib.sha256(method_body.encode("utf-8")).hexdigest()==manifest["methodSha256NormalLf"]
assert manifest["upstreamSha256"]=="5f7b5299b50ac2b85bfab6cef1dd746d7e114ce70c442f5f6fcadbe47dc78762"
assert manifest["realOrderEntryEnabled"] is False and manifest["fullV52Parity"] is False
assert "place_limit(" not in method_body and "flatten_all(" not in method_body
assert "import " not in method_body

spec=importlib.util.spec_from_file_location("pinned_v52_v50_no_io",path)
assert spec is not None and spec.loader is not None
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

spec2=importlib.util.spec_from_file_location("pinned_v52_amzn_pure",SRC/"amzn_yahoo_gate_pure.py")
assert spec2 is not None and spec2.loader is not None
amzn=importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(amzn)

NOW=int(datetime.fromisoformat("2026-10-19T16:30:00+00:00").timestamp()*1000)
MILLI=1000
BASE=SimpleNamespace(
 now_ms=lambda:NOW,finite=lambda x,default=0.0:float(x) if x is not None else default,
 V11_MAX_DATA_AGE_MS=120_000,V11_MAX_SOURCE_CLOCK_DIFF_MS=60_000
)
module.base=BASE
telemetry=[]
def record(state,*,ny_day,row):telemetry.append(dict(row))
module.append_v52_diagnostic=record

class Book:
 def __init__(self,mid=100.70,spread=4,depth=2000,received_ms=NOW):
  self.mid=mid;self.bid=mid-.02;self.ask=mid+.02
  self.spread_bps=spread;self._depth=depth;self.received_ms=received_ms
 def depth_usd(self,action:str):
  assert action in {"BUY","SELL"}
  return self._depth
class Reference:
 def __init__(self,price=100,received_ms=NOW):
  self.price=price;self.received_ms=received_ms
def t(ts:str)->int:
 return int(datetime.fromisoformat(ts.replace("Z","+00:00")).timestamp()*1000)
def yahoo_bar(start:str,close:float):
 return {"start_ms":t(start),"close":close}

class FakeV52(module.V52NativeCandidateOfflineShell):
 def __init__(self):
  self.state={"v50SignalBasis":{"11:30":{"AAPL":68.0}}}
  self.active={}
  self.stock_gross_cap=1.5
  self.aster_maker_fee_bps=2
  self.aster_taker_fee_bps=4
  self.v11_safety_buffer_bps=3
  self.net_cost=5.0
  self.saved=0
  self.logs=[]
  self.stockGross=.2
  self.totalGross=.8
  self.equity=1000.0
  self.amzn_short_gate_override=None
  self.amzn_gate_calls=0
 def current_local_time(self):
  return datetime.fromtimestamp(NOW/1000,tz=timezone.utc)
 def positions(self):
  return self.active
 def gross_snapshot(self):
  return {"equityUsd":self.equity,"stockGross":self.stockGross,"totalGross":self.totalGross}
 def estimate_v11_cost(self,book,action,notional):
  return self.net_cost,{"spreadBps":book.spread_bps,"safetyBufferBps":self.v11_safety_buffer_bps}
 def save(self):
  self.saved+=1
 def log(self,name,**kwargs):
  self.logs.append(name)
 def _amzn_short_yahoo_gate(self,now):
  self.amzn_gate_calls+=1
  if self.amzn_short_gate_override is not None:
   return self.amzn_short_gate_override
  # Explicit missing Yahoo input must block. No fetch is ever attempted.
  return amzn.evaluate_amzn_short_yahoo_gate(decision_ms=now,bars=[])

def check(symbol="AAPL",mid=100.70,reference=100,signal=68,cost=5,spread=4,
 depth=2000,book_time=NOW,reference_time=NOW,active=False):
 fixture=FakeV52()
 fixture.state["v50SignalBasis"]={"11:30":{symbol:signal}}
 fixture.net_cost=cost
 if active:fixture.active["V11_EQ"]={"symbol":symbol}
 rows={symbol:(Book(mid=mid,spread=spread,depth=depth,received_ms=book_time),
               None,Reference(price=reference,received_ms=reference_time))}
 candidate,rejections=fixture.v50_candidate("11:30",rows,500.0)
 assert fixture.saved==1 and fixture.logs==["v52-cost-telemetry"]
 assert len(telemetry)>0 and telemetry[-1]["symbol"]==symbol
 return candidate,rejections[symbol],fixture

candidate,reasons,fixture=check()
assert candidate is not None and reasons==[]
assert candidate["side"]=="SELL"
assert candidate["route"]=="POST_1130"
assert abs(candidate["basisBps"]-70)<1e-9
assert candidate["estimatedRoundTripCostBps"]==5
assert abs(telemetry[-1]["calculatedNetEdgeBps"]-45)<1e-9
assert telemetry[-1]["grossRequested"]==.5

candidate,reasons,_=check(mid=99.30,signal=-68)
assert candidate is not None and reasons==[] and candidate["side"]=="BUY"
candidate,reasons,_=check(mid=100.50)
assert candidate is None and "BASIS_BELOW_60" in reasons
candidate,reasons,_=check(mid=100.70,signal=-68)
assert candidate is None and "SIGN_CHANGED" in reasons
candidate,reasons,_=check(mid=100.81,signal=68)
assert candidate is None and "ADVERSE_BASIS_MOVE" in reasons
candidate,reasons,_=check(cost=61)
assert candidate is None and "ROUND_TRIP_COST_OVER_60" in reasons
candidate,reasons,_=check(cost=50)
assert candidate is None and "NET_EDGE_BELOW_7_5" in reasons
candidate,reasons,_=check(depth=999)
assert candidate is None and "DEPTH_BELOW_2X" in reasons
candidate,reasons,_=check(spread=20.01)
assert candidate is None and "SPREAD_OVER_20" in reasons
candidate,reasons,_=check(active=True)
assert candidate is None and "SAME_SYMBOL_ACTIVE" in reasons
candidate,reasons,_=check(book_time=NOW-200_000)
assert candidate is None and "STALE_DATA" in reasons
candidate,reasons,_=check(reference_time=NOW-90_000)
assert candidate is None and "SOURCE_CLOCK_MISMATCH" in reasons

# AMZN has an additional exact native reference gate for SHORT only.
fixture=FakeV52()
fixture.state["v50SignalBasis"]={"11:30":{"AMZN":68}}
fixture.amzn_short_gate_override=amzn.evaluate_amzn_short_yahoo_gate(
 decision_ms=NOW,bars=[yahoo_bar("2026-10-16T13:30:00Z",100),
                       yahoo_bar("2026-10-19T15:30:00Z",101.000001)])
candidate,failures=fixture.v50_candidate("11:30",{"AMZN":(Book(),None,Reference())},500)
assert candidate is None and "AMZN_SHORT_YAHOO_PREV_CLOSE_GT_1PCT" in failures["AMZN"]
assert fixture.amzn_gate_calls==1
fixture.amzn_short_gate_override=amzn.evaluate_amzn_short_yahoo_gate(
 decision_ms=NOW,bars=[yahoo_bar("2026-10-16T13:30:00Z",100),
                       yahoo_bar("2026-10-19T15:30:00Z",101)])
candidate,failures=fixture.v50_candidate("11:30",{"AMZN":(Book(),None,Reference())},500)
assert candidate is not None and failures["AMZN"]==[]
fixture.amzn_short_gate_override=None
candidate,failures=fixture.v50_candidate("11:30",{"AMZN":(Book(),None,Reference())},500)
assert candidate is None and "AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE" in failures["AMZN"]
fixture=FakeV52()
fixture.state["v50SignalBasis"]={"11:30":{"AMZN":-68}}
candidate,failures=fixture.v50_candidate("11:30",{"AMZN":(Book(mid=99.30),None,Reference())},500)
assert candidate is not None and candidate["side"]=="BUY" and fixture.amzn_gate_calls==0

# Native source compares actual candidate basis magnitudes; same fixture.
fixture=FakeV52()
fixture.state["v50SignalBasis"]={"11:30":{"AAPL":68,"MSFT":68}}
cand,rej=fixture.v50_candidate("11:30",{
 "AAPL":(Book(mid=100.70),None,Reference()),
 "MSFT":(Book(mid=100.74),None,Reference())},500)
assert cand is not None and cand["symbol"]=="MSFT"
assert rej["AAPL"]==rej["MSFT"]==[]
assert fixture.saved==1
print("PASS source-exact V52 V50 candidate method on independent offline Aster/reference quote fixtures; 60bps entry, signal sign, adverse shift, costs, spread, depth, age, stock active, Yahoo AMZN SHORT, ranking; zero actual orders")
