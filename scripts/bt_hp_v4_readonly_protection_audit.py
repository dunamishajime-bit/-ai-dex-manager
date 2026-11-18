#!/usr/bin/env python3
"""Read-only reconciliation of V4 open legs, resident STOP and venue GET.

No network client, credentials, order sends or production writes are included.
Caller supplies an unmodified V4 orders.json, signed GET diagnostic JSON,
and a read-only systemd snapshot. This is not authorization to trade.
"""
from __future__ import annotations
import argparse,json,re,sys,math
from pathlib import Path

def num(value):
    try: v=float(value)
    except (TypeError,ValueError): raise ValueError("INVALID_QUANTITY")
    if not math.isfinite(v): raise ValueError("NONFINITE_QUANTITY")
    return v

def near(a,b):
    return abs(a-b)<=max(1e-8,abs(b)*1e-8)

def audit(ledger:dict,venue:dict,systemd:str,stop_detail:dict|None=None)->dict:
    if venue.get("status")!="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS":
        raise ValueError("SIGNED_GET_NOT_VERIFIED")
    if any(venue.get(k)!=0 for k in ("ordersSent","cancelsSent","positionChangesSent")):
        raise ValueError("SIGNED_GET_MUST_BE_READ_ONLY")
    sha=ledger.get("releaseSha")
    if not isinstance(sha,str) or not re.fullmatch("[a-f0-9]{40}",sha):
        raise ValueError("LEDGER_RELEASE_SHA_INVALID")
    unit="disdex-v12-v4@"+sha+".service"
    units=[line.split() for line in systemd.splitlines() if line.split() and line.split()[0]==unit]
    if len(units)!=1 or len(units[0])<4: raise ValueError("SERVICE_IDENTITY_MISSING_OR_AMBIGUOUS")
    runner_active=units[0][1:4]==["loaded","active","running"]
    s=ledger.get("state",{})
    legs=s.get("legs",{})
    if not isinstance(legs,dict) or not isinstance(ledger.get("intents"),dict) or not isinstance(ledger.get("protections"),dict):
        raise ValueError("INVALID_V4_LEDGER_STRUCTURE")
    actual=venue.get("positions",[])
    orders=venue.get("openOrders",[])
    if not isinstance(actual,list) or not isinstance(orders,list):raise ValueError("INVALID_VENUE_RESPONSE")
    out=[]
    price_verified=True
    for legid,leg in legs.items():
        if leg.get("status")!="OPEN" or num(leg.get("qty",0))<=0:continue
        c=leg.get("candidate",{})
        symbol=c.get("symbol");side=c.get("effectiveSide")
        qty=num(leg.get("qty"))
        if not isinstance(symbol,str) or not symbol or side not in ("LONG","SHORT"):
            raise ValueError("OPEN_LEG_IDENTITY_INVALID")
        protection=ledger["protections"].get(legid,{})
        if protection.get("phase")!="STOP_CONFIRMED" or not near(num(protection.get("protectedQty")),qty):
            raise ValueError("LEDGER_PROTECTION_MISSING_OR_SIZE_DRIFT:"+symbol)
        stopid=protection.get("stopClientOrderId")
        if not isinstance(stopid,str) or not stopid:raise ValueError("MISSING_STOP_ORDER_ID")
        intents=[x for x in ledger["intents"].values() if x.get("legId")==legid and x.get("action")=="STOP" and x.get("clientOrderId")==stopid]
        if len(intents)!=1:raise ValueError("STOP_INTENT_MISSING_OR_DUPLICATE")
        venuepos=[x for x in actual if x.get("symbol")==symbol and abs(num(x.get("positionAmt",0)))>1e-12]
        signed=qty if side=="LONG" else -qty
        if len(venuepos)!=1 or not near(num(venuepos[0].get("positionAmt")),signed):
            raise ValueError("VENUE_POSITION_LEDGER_MISMATCH:"+symbol)
        matched=[x for x in orders if x.get("clientOrderId")==stopid]
        if len(matched)!=1:raise ValueError("VENUE_STOP_MISSING_OR_DUPLICATE:"+symbol)
        order=matched[0]
        if (order.get("symbol")!=symbol or order.get("side")!=("SELL" if side=="LONG" else "BUY") or
           order.get("type")!="STOP_MARKET" or order.get("status")!="NEW" or order.get("reduceOnly") is not True):
            raise ValueError("VENUE_STOP_PROTECTION_INVALID:"+symbol)
        if not near(num(order.get("origQty")),qty) or not near(num(order.get("executedQty")),0):
            raise ValueError("VENUE_STOP_QUANTITY_INVALID:"+symbol)
        stop_price=None
        if stop_detail is not None:
            detail=stop_detail
            if detail.get("status")!="READ_ONLY_ORDER" or detail.get("ordersSent")!=0 or detail.get("cancelsSent")!=0:
                raise ValueError("STOP_PRICE_READ_ONLY_EVIDENCE_INVALID")
            if detail.get("id")!=stopid or detail.get("symbol")!=symbol or detail.get("orderStatus")!="NEW" or detail.get("reduceOnly") is not True or detail.get("type")!="STOP_MARKET":
                raise ValueError("STOP_DETAIL_IDENTITY_OR_TYPE_MISMATCH")
            if detail.get("side")!=("BUY" if side=="SHORT" else "SELL") or not near(num(detail.get("quantity")),qty) or not near(num(detail.get("executed")),0):
                raise ValueError("STOP_DETAIL_QUANTITY_OR_DIRECTION_MISMATCH")
            intent_price=num(intents[0]["command"]["price"])
            stop_price=num(detail.get("stopPrice"))
            if intent_price<=0 or stop_price<=0 or not near(stop_price,intent_price):
                raise ValueError("STOP_PRICE_LEDGER_VENUE_MISMATCH")
            entry_price=num(leg.get("entryNotional",0))/qty
            if entry_price<=0 or not (stop_price>entry_price if side=="SHORT" else stop_price<entry_price):
                raise ValueError("STOP_PRICE_NOT_PROTECTIVE")
        else:
            price_verified=False
        out.append({"symbol":symbol,"side":side,"qty":qty,"stopOrderId":stopid,
                    "stopStatus":"NEW","stopPrice":stop_price,"venueQty":num(venuepos[0]["positionAmt"])})
    if not out:raise ValueError("NO_OPEN_V4_LEG_FOR_PROTECTION_AUDIT")
    if len(out)!=1 and stop_detail is not None:raise ValueError("MULTI_LEG_STOP_DETAIL_INCOMPLETE")
    status=("PROTECTED_BUT_RUNNER_NOT_RUNNING" if not runner_active else
            "PROTECTION_MATCHED_RUNNER_RUNNING_NOT_TRADE_CERTIFIED") if price_verified else (
            "RUNNER_NOT_RUNNING_STOP_PRICE_UNVERIFIED" if not runner_active else
            "RUNNER_RUNNING_STOP_PRICE_UNVERIFIED")
    return {"schema":"disdex-v4-readonly-protection-audit/v1",
            "status":status,"stopPriceVerified":price_verified,
            "runnerActive":runner_active,"releaseSha":sha,"venueTime":venue.get("venueTime"),
            "positions":out,"ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
            "tradeAuthorityProvided":False}

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ledger",type=Path,required=True)
    p.add_argument("--venue",type=Path,required=True)
    p.add_argument("--systemd",type=Path,required=True)
    p.add_argument("--stop-detail",type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args(argv)
    detail=json.loads(a.stop_detail.read_text("utf-8-sig")) if a.stop_detail else None
    result=audit(json.loads(a.ledger.read_text("utf8")),json.loads(a.venue.read_text("utf-8-sig")),a.systemd.read_text("utf-8-sig"),detail)
    payload=json.dumps(result,ensure_ascii=False,indent=2)+"\n"
    if a.output:a.output.write_text(payload,encoding="utf8")
    print(payload)
    return 2 if not result["runnerActive"] else 0

if __name__=="__main__": sys.exit(main())
