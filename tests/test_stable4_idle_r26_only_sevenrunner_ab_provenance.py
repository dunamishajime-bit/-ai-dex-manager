"""Offline exact-source guard for unchanged-six-runner IDLE R26/legacy A/B.

This test never reads private raw tapes or calls an exchange. Source replay
itself was completed on the owner's PC, using archived immutable hashes.
"""
from __future__ import annotations
from hashlib import sha256
from pathlib import Path
import copy
import json
import math
import unittest

ROOT=Path(__file__).resolve().parents[1]
REPORT="docs/research/STABLE4_IDLE_R26_197_VS_OLD849_FROZEN_SEVEN_RUNNER_SHARED_WALLET_AB_20261128.json"
REPORT_SHA="96e3d459f10c99d6e1d4bbf5273c7201853b5840ee105240bbbc9df93441c6ce"
SCRIPT="scripts/research/stable4_idle_r26_only_all_runner_ab_replay.py"
SCRIPT_SHA="064fc23e65e269918f1b848ec0b8cf8239ebc26e8b1bdb9a80b93db1507159e5"
EXPECTED={
 "30": {"old":5699299.333642679,"r26":6574419.518648017,
       "oldDd":-23.086190282664422,"r26Dd":-23.086190282664422,
       "oldN":1096,"r26N":1080,"oldWin":58.3941605839416,"r26Win":58.51851851851851,
       "idleOld":31,"idleR26":10,"v4Old":800,"v4R26":804,
       "penguOld":42,"penguR26":43},
 "10": {"old":19801166.660116512,"r26":22247848.470790964,
       "oldDd":-22.211052959077193,"r26Dd":-22.211052959077193,
       "oldN":1098,"r26N":1082,"oldWin":61.74863387978142,"r26Win":61.92236598890942,
       "idleOld":31,"idleR26":10,"v4Old":803,"v4R26":807,
       "penguOld":42,"penguR26":43},
}
PIN_SHAS={
 "engine":"d39f1bdaeda85f453a1bf6987ffdc97e00af8ee2015282341997215eb13a0c43",
 "wrapper":"ddafe69b010b68864edf0f644f92d94f115dc32cd96db864664fd9d23bd7d191",
 "reference":"91decaf83f3ff84e05391ae943a49363ac949b6efc359c4e6c85fdbae1670ff1",
 "protocol":"251422208c73917a167dbf3202fb4d64ae3c37871bd3851df2fe952861cd5855",
 "r21":"84d5c1a1b9cc792200b83c267d0425411d1b5c74a1ea8f1d0115f0c078efb92e",
 "parent":"5f56241f465fd2351c9370302499bb132fa780d9c267fd0d3b8128dbf12ccb1e",
}
def load():
    report=(ROOT/REPORT).read_bytes()
    code=(ROOT/SCRIPT).read_bytes()
    if sha256(report).hexdigest()!=REPORT_SHA:
        raise ValueError("IDLE_R26_A_B_SOURCE_MODEL_REPORT_SHA_CHANGED")
    if sha256(code).hexdigest()!=SCRIPT_SHA:
        raise ValueError("IDLE_R26_A_B_COMPARISON_SOURCE_CHANGED")
    return json.loads(report)
def validate(j):
    if (j.get("schema")!="stable4-idle-r26-only-849-vs-197-sevenrunner-wallet-frozen-bt-ab/v1"
        or j.get("status")!="ARCHIVED_FROZEN_SEVEN_RUNNER_PRICE_MODEL_COMPARISON_NOT_SOURCE_NATIVE_LIVE_CUTOVER_CERTIFICATE"
        or j.get("periodUtc")!=["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"]
        or j.get("initialCapitalJPY")!=10000
        or j.get("modelsBpsRoundTrip")!=[10,30]
        or j.get("fixedR21")!="R21_ONE 0.30x one slot original native exit"
        or j.get("r26HistoricalReferenceReproduced") is not True
        or j.get("sameNonIdleSourceTapeAndAllOtherSixPolicies") is not True):
        raise ValueError("UNFROZEN_OR_NONEXACT_SIX_OTHER_RUNNER_A_B")
    if {k:x["sha256"] for k,x in j["sourceSha256"].items()}!=PIN_SHAS:
        raise ValueError("ORIGINAL_STABLE4_R26_REPLAY_ENGINE_PIN_INVALID")
    if j["candidateCounts"]!={"old":849,"r26":197,"removedByR26":652,
                               "unchangedOtherSixBeforeR21":1508,
                               "fixedR21Candidates":378}:
        raise ValueError("IDLE_OTHER6_FROZEN_ENTRY_CANDIDATES_CHANGED")
    for f in ("liveOrderAuthority","completeActualSevenRunnerNativeReplay",
              "actualVenueFillsProven","realFutureReturnGuaranteed"):
        if j.get(f) is not False:raise ValueError("SOURCE_MODEL_MISREPRESENTED_AS_LIVE:"+f)
    if len(j.get("caveats",[]))<5:
        raise ValueError("ARCHIVED_NATIVE_AND_FILL_GAPS_NOT_DISCLOSED")
    for fee,ref in EXPECTED.items():
        old=j["results"][f"OLD849/{fee}"]
        new=j["results"][f"R26_197/{fee}"]
        for x,label in ((old,"old"),(new,"r26")):
            if not math.isclose(x["final_compounded_jpy"],ref[label],rel_tol=1e-12,abs_tol=1e-6):
                raise ValueError("ARCHIVED_WALLET_FINAL_NOT_MATCHED:"+fee+":"+label)
            if not math.isclose(x["max_hourly_dd_pct"],ref[label+"Dd"],abs_tol=1e-8):
                raise ValueError("ARCHIVED_WALLET_DD_NOT_MATCHED:"+fee+":"+label)
            if x["modeled_fills"]!=ref[label+"N"]:
                raise ValueError("ARCHIVED_WALLET_FILLS_NOT_MATCHED:"+fee+":"+label)
            if not math.isclose(x["win_rate_pct"],ref[label+"Win"],abs_tol=1e-8):
                raise ValueError("ARCHIVED_WALLET_WINS_NOT_MATCHED:"+fee+":"+label)
            if x["admitted_by_runner"].get("IDLE")!=ref["idle"+("Old" if label=="old" else "R26")]:
                raise ValueError("ARCHIVED_WALLET_IDLE_ADMISSIONS_CHANGED")
            if x["admitted_by_runner"].get("V4")!=ref["v4"+("Old" if label=="old" else "R26")]:
                raise ValueError("PEER_RUNNER_GROSS_OPPORTUNITY_INTERACTION_CHANGED")
            if x["admitted_by_runner"].get("PENGU")!=ref["pengu"+("Old" if label=="old" else "R26")]:
                raise ValueError("P91_PEER_OPPORTUNITY_INTERACTION_CHANGED")
            if not x["allObservedFillsArePriceModels"]:
                raise ValueError("UNSIGNED_MODELED_FILL_RELABELED_EXCHANGE_FILL")
            n=sum(row["trades"] for row in x["resultByRunner"].values())
            # A modeled terminal OPEN position is not included in closed fills.
            if n!=x["modeled_fills"]:
                raise ValueError("MODELED_FILLS_RUNNER_SUM_DIFF")
        d=j["differencesR26MinusOld"][fee]
        if (not math.isclose(d["r26MinusOldFinalJPY"],
                             round(new["final_compounded_jpy"]-old["final_compounded_jpy"],6),abs_tol=1e-5)
           or d["r26MinusOldFinalJPY"]<=0
           or not math.isclose(d["maxDdPercentPointsR26MinusOld"],0,abs_tol=1e-7)
           or d["perRunner"]["IDLE"]["tradeCountDelta"]!=-21
           or d["perRunner"]["V4"]["tradeCountDelta"]!=4
           or d["perRunner"]["PENGU"]["tradeCountDelta"]!=1):
            raise ValueError("UNACCOUNTED_R26_DISPLACED_PEERS_OR_PORTFOLIO_DIFF")
        pnl_delta=sum(row["netPnlJPYDelta"] for row in d["perRunner"].values())
        remaining_mtm=d["r26MinusOldFinalJPY"]-pnl_delta
        if not 0<remaining_mtm<110000:
            raise ValueError("MODEL_CASH_AND_TERMINAL_OPEN_MTM_NOT_RECONCILED")
        if len({*old["resultByRunner"],*new["resultByRunner"]})!=7:
            raise ValueError("SEVEN_RUNNER_SLEEVE_MISSING")
class TestR26OnlyFrozenWalletAB(unittest.TestCase):
    def test_sha_pinned_10_and_30bps_seven_sleeves(self):
        validate(load())
    def test_forged_live_or_native_parity_rejected(self):
        for key in ("liveOrderAuthority","completeActualSevenRunnerNativeReplay",
                    "actualVenueFillsProven","realFutureReturnGuaranteed"):
            doc=copy.deepcopy(load());doc[key]=True
            with self.subTest(key=key),self.assertRaises(ValueError):validate(doc)
    def test_false_result_or_peer_displacement_rejected(self):
        doc=load();doc["differencesR26MinusOld"]["30"]["r26MinusOldFinalJPY"]=0
        with self.assertRaises(ValueError):validate(doc)
        doc=load();doc["results"]["R26_197/30"]["admitted_by_runner"]["V4"]=800
        with self.assertRaises(ValueError):validate(doc)
    def test_false_exit_fills_and_frozen_other_sleeves_rejected(self):
        doc=load();doc["results"]["OLD849/30"]["allObservedFillsArePriceModels"]=False
        with self.assertRaises(ValueError):validate(doc)
        doc=load();doc["sameNonIdleSourceTapeAndAllOtherSixPolicies"]=False
        with self.assertRaises(ValueError):validate(doc)
if __name__=="__main__":unittest.main()
