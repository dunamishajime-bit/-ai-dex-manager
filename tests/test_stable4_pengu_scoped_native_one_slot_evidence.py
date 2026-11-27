"""Fail-closed checks for PENGU source-native H1 exit and conditional one-slot research.

All three inputs are Git-pinned source-only evidence, NEVER venue fills or LIVE approvals.
"""
from __future__ import annotations
import copy
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
INPUTS={
    "native":("STABLE4_PENGU_ALL_ROUTES_NATIVE_H1_POSITION_HELPER_REPLAY_20261128.json","93b4c4dd203da5394b77e58a7a23eaa359d3978ee27a6df5973aaddafde84e00"),
    "slot":("STABLE4_PENGU_NATIVE_ONE_SLOT_COOLDOWN_20261128.json","dd7b990c8c828780af70409c9914f893c6c541ce113f7466975a1a545af3c9c2"),
    "refetch":("STABLE4_PENGU_BINANCE_INDEPENDENT_H1_NATIVE_ENTRY_PARITY_20261128.json","cfb7b6e46b8b3543778c1ed519a62918f17eed28fa9e9afb67496281dfbe7a56"),
}

def load():
    out={}
    for key,(name,pin) in INPUTS.items():
        path=ROOT/"docs/research"/name
        data=path.read_bytes()
        if sha256(data).hexdigest()!=pin:raise ValueError("PINNED_RESEARCH_SHA_MISMATCH:"+key)
        out[key]=json.loads(data)
    return out


def verify(docs):
    n,s,r=docs["native"],docs["slot"],docs["refetch"]
    if (n.get("schema")!="stable4-pengu-all-routes-native-h1-position-helper-replay/v1"
        or s.get("schema")!="stable4-pengu-isolated-native-one-slot-cooldown/v1"
        or r.get("schema")!="stable4-pengu-binance-independent-h1-native-entry-parity/v1"):
        raise ValueError("RESEARCH_EVIDENCE_SCHEMA")
    for doc in (n,s,r):
        if (doc.get("orderAuthority") is not False
            or doc.get("fullPenguAnnualTradeReplay") is not False
            or doc.get("productionEligible") is not False):
            raise ValueError("LIVE_OR_FULL_BT_SCOPE_FORGED")
    if s.get("sharedWalletCompleted") is not False or n.get("fullSevenRunnerWalletReplay") is not False:
        raise ValueError("SHARED_WALLET_SCOPE_FORGED")
    if s["sourceLedgerSha256"]!=INPUTS["native"][1] or n["oldLedgerSha256"]!=r["frozenSourceLedgerSha256"]:
        raise ValueError("CHAIN_OF_CUSTODY_MISMATCH")
    if n["refetchedNativeEntryLedgerSha256"]!=r["privateInputNewReplaySha256"]:
        raise ValueError("PRIVATE_H1_SOURCE_LINEAGE")
    if (r.get("semanticParity")!={
        "sourceNativeRawEventsExact":True,"allNativeArmsExact":True,
        "missingFeaturesExact":True,"ambiguousExact":True}):
        raise ValueError("NATIVE_H1_PARITY_UNVERIFIED")
    if not (r["dataDigests"]["pengu"]["oldBytePinMatched"] is False
            and r["dataDigests"]["btc"]["oldBytePinMatched"] is False
            and r["dataDigests"]["funding"]["oldBytePinMatched"] is True):
        raise ValueError("SOURCE_BYTE_EQUIVALENCE_FALSE_CLAIM")
    for p,pin in n["sourcePins"].items():
        f=ROOT/p
        if not p.startswith(("config/","lib/","scripts/research/")) or not f.is_file() or sha256(f.read_bytes()).hexdigest()!=pin:
            raise ValueError("SOURCE_PIN:"+p)
    expected={
        "BASE":(54,32,22,23,16,15,0),
        "V8_V64":(112,69,43,46,31,30,5),
    }
    for arm,(count,priced,missing,admitted,occupied,no_m5,cooled) in expected.items():
        summary=n["summary"][arm]
        if summary["rawCandidates"]!=count or summary["modelStatus"]!={
            "SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL":priced,
            "FIRST_M5_CONFIRMATION_UNAVAILABLE":missing}:
            raise ValueError("NATIVE_EXIT_ARMS_INCOMPLETE:"+arm)
        entries=n["results"][arm]
        if len(entries)!=count or len({x["entryTs"] for x in entries})!=count:
            raise ValueError("SOURCE_ENTRY_CLOCKS_CORRUPT")
        for e in entries:
            if e["modelExecutionTs"]!=e["entryTs"]+300000 or e.get("actualVenueFillVerified") is not False:
                raise ValueError("M5_CAUSAL_CLOCK_OR_FILL_CLAIM")
            if e["status"]=="SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL":
                x=e["exit"]
                if (x["actualReduceOnlyFillVerified"] is not False or x["modelExitClock"]<=e["entryTs"]
                    or x["cooldownHours"] not in (6,24)):
                    raise ValueError("NATIVE_EXIT_NOT_PROVEN")
        decisions=s["decisions"][arm]
        if len(decisions)!=count or len({x["sourceSignalTs"] for x in decisions})!=count:
            raise ValueError("SLOT_CLOCKS_INCOMPLETE")
        counts=Counter(x["decision"] for x in decisions)
        expected_decisions={
            "MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT":admitted,
            "BLOCKED_OCCUPIED_MODEL_SLOT":occupied,
            "NO_M5_ENTRY_CONFIRMATION":no_m5}
        if cooled:expected_decisions["BLOCKED_NATIVE_COOLDOWN"]=cooled
        if counts!=expected_decisions or dict(counts)!=s["summary"][arm]["decisionCounts"]:
            raise ValueError("ONE_SLOT_MODEL_COUNTS")
        native_by_clock={x["entryTs"]:x for x in entries}
        active_until=0;cooldown_until=0
        for row in decisions:
            ts=row["sourceSignalTs"]
            evidence=native_by_clock.get(ts)
            if evidence is None or row["sourcePriceModel"]!=evidence["status"]:
                raise ValueError("SLOT_UNBOUND_SOURCE")
            if row.get("orderAuthority") is not False:
                raise ValueError("SLOT_ORDER_AUTHORITY_FORGED")
            if row["decision"]=="MODELED_ONE_SLOT_ADMIT_AND_SOURCE_EXIT":
                if ts<max(active_until,cooldown_until) or evidence["status"]!="SOURCE_NATIVE_EXIT_WITH_ASTER_PRICE_PROXY_NO_FILL":
                    raise ValueError("SLOT_OVERLAP_OR_SOURCE_UNPROVEN")
                if row["exitModelTs"]!=evidence["exit"]["modelExitClock"]:
                    raise ValueError("SLOT_EXIT_CLOCK_PARITY")
                active_until=row["exitModelTs"]
                cooldown_until=row["cooldownUntilTs"]
                if cooldown_until!=active_until+evidence["exit"]["cooldownHours"]*3600000:
                    raise ValueError("NATIVE_COOLDOWN_MISMATCH")
            elif row["decision"]=="BLOCKED_OCCUPIED_MODEL_SLOT":
                if ts>=active_until:raise ValueError("FALSE_OCCUPIED")
            elif row["decision"]=="BLOCKED_NATIVE_COOLDOWN":
                if not (active_until<=ts<cooldown_until):raise ValueError("FALSE_COOLDOWN")
            elif row["decision"]=="NO_M5_ENTRY_CONFIRMATION":
                if ts<max(active_until,cooldown_until) or evidence["firstConfirmedM5VolumePositive"] is not False:
                    raise ValueError("ENTRY_CONFIRMATION_SCOPE")
            else:
                raise ValueError("UNKNOWN_PENGU_SLEEVE_DECISION")


class PenguScopedNativeSourceEvidence(unittest.TestCase):
    def test_pinned_provenance_and_model_transitions(self):verify(load())
    def test_reject_live_or_complete_wallet_status(self):
        for obj,field in (("native","orderAuthority"),("native","fullPenguAnnualTradeReplay"),
                          ("slot","sharedWalletCompleted"),("slot","productionEligible"),
                          ("refetch","productionEligible")):
            d=copy.deepcopy(load());d[obj][field]=True
            with self.subTest(obj=obj,field=field),self.assertRaises(ValueError):verify(d)
    def test_reject_slot_overlap_and_false_venue_fill(self):
        d=load();d["slot"]["decisions"]["BASE"][0]["exitModelTs"]+=3600000
        with self.assertRaises(ValueError):verify(d)
        d=load();next(x for x in d["native"]["results"]["BASE"] if x.get("exit"))["exit"]["actualReduceOnlyFillVerified"]=True
        with self.assertRaises(ValueError):verify(d)
    def test_reject_private_h1_source_relabel(self):
        d=load();d["refetch"]["dataDigests"]["pengu"]["oldBytePinMatched"]=True
        with self.assertRaises(ValueError):verify(d)

if __name__=="__main__":unittest.main()
