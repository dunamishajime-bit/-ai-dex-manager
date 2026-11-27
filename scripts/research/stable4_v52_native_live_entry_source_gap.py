"""Exact-source V52 stock native-entry data requirements vs archived annual OHLC.

A read-only research contract. Rejects inventing L2 books from M5/H1 bars.
Never invokes StockEngine or any account/order method.
"""
from __future__ import annotations
import ast
from hashlib import sha256
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/"scripts/disdex_v13d_v11eq_stock_live_engine.py"
DOCS={
 "m5_yahoo":ROOT/"docs/research/STABLE4_V52_STOCK_ASTER5M_YAHOO1H_COVERAGE_20261128.json",
 "session":ROOT/"docs/research/STABLE4_V52_REGULAR_SESSION_LIQUIDITY_20261128.json",
}
BASES=("AMZN","META","MSFT","NVDA","TSLA")
REQUIRED={
 "V13D":{
  "ASTER_L2_ORDER_BOOK":"bid/ask and maker-side queue, adverse flow from Aster current depth",
  "HYPERLIQUID_XYZ_L2_ORDER_BOOK":"bid/ask and hedge-side top notional on XYZ with fresh clock",
  "SYNCHRONIZED_BOOK_TIME":"native freshness and reference-move checks, not 5m candle time",
  "MAKER_HEDGE_LIVE_EXECUTION":"maker fill, hedge IOC fill, quantity and resident risk recheck",
 },
 "V11EQ":{
  "ASTER_L2_ORDER_BOOK":"mid, spread, depth VWAP and slippage for chosen side",
  "CONTEMPORANEOUS_REFERENCE_QUOTE":"fresh reference for basis now, not delayed Yahoo H1 candle",
  "ASTER_30S_SPREAD_HISTORY":"recent observed spread median, not one H1 price",
  "ASTER_2S_MID_HISTORY":"intra-second adverse movement and stale-data gate",
  "PRIOR_NY_SESSION_SIGNAL_SNAPSHOT":"recorded universe top1 daily v11 signal basis from source books and reference",
  "EXECUTION_QUOTE_AND_FILL":"post-only maker and taker fallback quote/order/fill sequence",
 },
}

def check_method(source_ast,method):
    classes=[n for n in source_ast.body if isinstance(n,ast.ClassDef) and n.name=="StockEngine"]
    if len(classes)!=1:raise ValueError("V52_STOCK_ENGINE_MISSING")
    methods=[n for n in classes[0].body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
    present={n.name for n in methods}
    if method not in present:raise ValueError("V52_NATIVE_METHOD_MISSING:"+method)
    return next(n for n in methods if n.name==method)

def analyze():
    source_bytes=SOURCE.read_bytes()
    code=source_bytes.decode('utf8')
    tree=ast.parse(code,filename=SOURCE.name)
    for name in ("books_and_refs","update_history","record_v11_signal","candidate_v13d","v11_candidates","open_v13d","open_v11","reconcile"):
        check_method(tree,name)
    tokens={
     "books_and_refs":("pool.submit(self.aster.book,","pool.submit(self.xyz.book,","pool.submit(self.reference.quote,"),
     "candidate_v13d":("maker_queue","hedge_top","adverse_imbalance","basis", "V13D_MAX_BOOK_AGE_MS"),
     "record_v11_signal":("v11SignalBasis","v11SignalSelectedSymbol"),
     "v11_candidates":("self.estimate_v11_cost(","v11SignalBasis","30_000","2200","depth_multiple","adverse_basis"),
    }
    for method,keywords in tokens.items():
        node=check_method(tree,method)
        segment=ast.get_source_segment(code,node)
        if not segment or any(word not in segment for word in keywords):
            raise ValueError("NATIVE_V52_REQUIREMENTS_CHANGED:"+method)
    docs={}
    for name,path in DOCS.items():
        b=path.read_bytes();docs[name]={"sha256":sha256(b).hexdigest(),"data":json.loads(b)}
    c=docs["m5_yahoo"]["data"]
    s=docs["session"]["data"]
    if c.get("schema")!="stable4-v52-stock-m5-h1-coverage-audit/v1" or c.get("orderAuthority") is not False:
        raise ValueError("V52_MARKET_SOURCE_SCOPE")
    if s.get("schema")!="stable4-v52-regular-session-liquidity-audit/v1" or s.get("orderAuthority") is not False or s.get("v52SourceEntryOrFillParityProven") is not False:
        raise ValueError("V52_LIQUIDITY_SOURCE_SCOPE")
    if set(c["perTicker"])!=set(BASES) or set(s["perTicker"])!=set(BASES):
        raise ValueError("STOCK_SOURCE_UNIVERSE")
    coverage={}
    for symbol in BASES:
        d=c["perTicker"][symbol]
        a=d["asterM5"];y=d["yahooH1"];l=s["perTicker"][symbol]
        if a["rows"]!=105120 or y["rows"]!=1742 or a["completeClockCoverage"] is not True or a["sha256"]!=l["sourceSha256"]:
            raise ValueError("ANNUAL_SOURCE_RECEIPT_CONFLICT:"+symbol)
        if l["signedQuoteOrFillProven"] is not False or l["positiveVolumeMeansExecutable"] is not False:
            raise ValueError("V52_FALSE_EXECUTABLE_CANDLE_CLAIM")
        coverage[symbol]={
          "aster5mRows":a["rows"],"yahooH1Rows":y["rows"],
          "aster5mByteSha256":a["sha256"],"yahooH1ByteSha256":y["sha256"],
          "regularSessionZeroVolumePct":l["regularSessionZeroVolumePct"],
          "nativeCurrentBookCoverageProven":False,"nativeVenueFillCoverageProven":False}
    return {"schema":"stable4-v52-native-entry-required-market-data-gap/v1",
      "status":"BLOCKED_NATIVE_ANNUAL_ENTRY_REPLAY_L2_AND_TIME_SYNC_UNAVAILABLE",
      "sourceEngine":"scripts/disdex_v13d_v11eq_stock_live_engine.py",
      "engineSourceSha256":sha256(source_bytes).hexdigest(),
      "pinnedReceiptSha256":{k:docs[k]["sha256"] for k in docs},
      "studyPeriodUtc":c["windowUtc"],
      "symbols":list(BASES),"routeRequirements":REQUIRED,
      "providedArchivedClasses":["ASTER 5-minute OHLCV historical candles","Yahoo 1-hour underlying OHLCV historical reference"],
      "unavailableInProvidedAnnualArchives":["historical synchronized ASTER and Hyperliquid XYZ level-2 order books","native 2s/30s price-spread windows","contemporaneous exact reference quotes","signed maker/follower hedge fill and resident STOP lifecycle"],
      "perTicker":coverage,
      "nativeEntryReplayComplete":False,"sevenRunnerSharedWalletBtComplete":False,
      "rootCertificateIssued":False,"orderAuthority":False,"productionEligible":False,
      "limitations":[
        "This is an exact StockEngine source-contract and historical archive scope analysis, not a claim that no data exists in other accounts or providers.",
        "V13D candidate requires two venue L2 books plus a contemporaneous hedge/adverse-flow gate, and V11EQ uses precise spread/mid history and prior NY session signal; no OHLC-only substitute is source-native.",
        "Zero-volume ASTER 5m candles remain non-executable evidence. Even positive-volume historical OHLC cannot imply bid/ask depth or executable maker/hedge fills.",
        "No actual V52 native entry/exit replay, 10/30bps economic outcomes, shared DD, formal certification, production or order authority."
      ]}

if __name__=='__main__':
    if len(sys.argv)!=2:raise ValueError('NEW_RESEARCH_OUTPUT_REQUIRED')
    report=analyze()
    with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f:json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    print(json.dumps({"status":report['status'],"engineSourceSha256":report['engineSourceSha256'],"perTicker":{k:{"m5":v['aster5mRows'],"referenceH1":v['yahooH1Rows'],"regularZeroVolPct":v['regularSessionZeroVolumePct']} for k,v in report['perTicker'].items()}},sort_keys=True))
