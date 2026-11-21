#!/usr/bin/env python3
"""PRISM VII P8/P8B: immutable native source, all signals, full economic parity.

Audits generated experiment artifacts read-only. Signed fills, account risk
and production parity are explicitly NOT inferred from these tests.
"""
from __future__ import annotations
import json
import math
import unittest
from collections import Counter,defaultdict
from pathlib import Path
from statistics import mean

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/"results"
ADAPTER=ROOT/"pin_native_harness_20261122"/"adapter"
BASE="PRISM7_P8_NATIVE384_336H_SYNTHETIC_SUMMARY_20261122"
EXT="PRISM7_P8B_NATIVE384_408H_FOLLOWUP_SUMMARY_20261122"


def j(name):
    return json.loads((RESULTS/name).read_text(encoding="utf-8"))


def ledger(prefix,suffix):
    p=RESULTS/(prefix+suffix)
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


def k(x):
    return (x["pathTag"],x["signalHourIndex"])


class NativeP8Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.real=j("PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122.json")
        cls.real_cases=j("PRISM7_P8_PINNED_NATIVE53_REAL_PARITY_20261122_53_CASES.json")
        cls.pin=json.loads((ADAPTER/"manifest.json").read_text(encoding="utf-8"))
        cls.p8=j(BASE+".json")
        cls.p8b=j(EXT+".json")
        cls.old=ledger(BASE,"_CASES.jsonl")
        cls.new=ledger(EXT,"_CASES.jsonl")
        cls.old_paths=ledger(BASE,"_PATHS.jsonl")
        cls.new_paths=ledger(EXT,"_PATHS.jsonl")

    def test_pinned_git_blob_source_exact(self):
        self.assertEqual(self.pin["pinned_commit"],"1657e173d250ad58f53e62f7bb0a3428fb405496")
        self.assertEqual(len(self.pin["files"]),11)
        import hashlib
        for name,v in self.pin["files"].items():
            raw=(ADAPTER.parent/"original"/name).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),v["original_sha256"])
            self.assertEqual(hashlib.sha256(
                b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest() if False else
                hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest(),
                v["pinned_git_blob_sha1"])
            adapter=(ADAPTER/name).read_bytes()
            self.assertEqual(hashlib.sha256(adapter).hexdigest(),v["adapted_sha256"])

    def test_53_native_entries_and_exits_exact(self):
        self.assertEqual(self.real["entryAndExitParity"],"PASS_53_53")
        self.assertEqual(self.real["sharedNativeExitCoreParity"],"PASS_53_53")
        self.assertEqual(self.real["pinnedNativeCandidateCoverage"],"PASS_53_53_IN_SOURCE_OWN_ENTRY_PERIOD")
        self.assertEqual(len(self.real_cases),53)
        self.assertEqual([p["sourceShortCount"] for p in self.real["perPeriod"]],[6,40,7])
        self.assertEqual([p["pinnedShortSignalsWithinPeriod"] for p in self.real["perPeriod"]],[6,40,7])
        self.assertTrue(all(p["rawShortSignalsAbsentFromSourceExitTape"]==[]
                            for p in self.real["perPeriod"]))
        self.assertTrue(all(x["parity"]=="EXACT" for x in self.real_cases))

    def test_p8b_157_signal_identity_and_old_86_exits(self):
        self.assertEqual(len(self.old),len(self.new))
        self.assertEqual(len(self.new),157)
        self.assertEqual(len({k(x) for x in self.new}),157)
        old={k(x):x for x in self.old}
        unchanged=0
        for newer in self.new:
            older=old[k(newer)]
            for key in ["signalHourIndex","entryTs","entryHourOpenPrice",
                        "source_mask_start_m5_index","entryHourPositivePrint",
                        "firstPrintMinuteOffset","pathTag"]:
                self.assertEqual(newer[key],older[key],(key,k(newer)))
            if older["native_exit_status"]=="NATIVE_EXIT_MODELED":
                unchanged+=1
                for key in ["native_exitTs","native_exitPrice",
                            "native_exitReason","native_exitPriceKind"]:
                    self.assertEqual(newer[key],older[key],(key,k(newer)))
        self.assertEqual(unchanged,86)
        self.assertEqual(self.p8b["pairedVerification"]["matchedUnchangedEntries"],157)
        self.assertEqual(self.p8b["pairedVerification"]["matchedUnchangedOldExits"],86)
        self.assertEqual(self.p8b["pairedVerification"]["recoveredFromPreviousCensoring"],71)

    def test_full_157_native_exits_and_economic_metrics(self):
        self.assertEqual(len(self.old_paths),384)
        self.assertEqual(len(self.new_paths),384)
        self.assertEqual(self.p8["metricsAll"][1]["rightCensored"],71)
        self.assertTrue(all(x["native_exit_status"]=="NATIVE_EXIT_MODELED" for x in self.new))
        self.assertEqual(self.p8b["metricsAll"][1]["naturalSignals"],157)
        self.assertEqual(self.p8b["metricsAll"][1]["completedExits"],157)
        self.assertEqual(self.p8b["metricsAll"][1]["rightCensored"],0)
        self.assertEqual(self.p8b["prefixNativeFeatureChecks"],32)
        self.assertEqual(sum(x["sourceNaturalShortSignals"] for x in self.new_paths),157)
        pnl=[x["native_price_net30_pct"] for x in self.new]
        w=[x for x in pnl if x>0]
        self.assertEqual(len(w),77)
        self.assertAlmostEqual(mean(pnl),self.p8b["metricsAll"][1]["mean_net_pct"],places=10)
        pf=sum(x for x in pnl if x>0)/-sum(x for x in pnl if x<0)
        self.assertAlmostEqual(pf,self.p8b["metricsAll"][1]["price_pf"],places=10)
        for x in self.new:
            self.assertAlmostEqual(x["native_price_net10_pct"]-
                                   x["native_price_net30_pct"],.20,places=8)

    def test_source_mask_wrap_and_no_fill_claim(self):
        self.assertEqual(self.p8b["sourceMaskEndWrapPaths"],20)
        wraps={(x["mask_profile"],x["regime"],x["seed"])
               for x in self.new_paths if x["maskWrappedToSourceBeginning"]}
        self.assertEqual(len(wraps),20)
        in_wrap=[x for x in self.new if
                 (x["mask_profile"],x["price_regime"],x["seed"]) in wraps]
        self.assertEqual(len(in_wrap),15)
        self.assertEqual(self.p8b["metricsWrapped30bps"]["n"],15)
        self.assertEqual(self.p8b["metricsNonwrapped30bps"]["n"],142)
        self.assertEqual(sum(not x["entryHourPositivePrint"] for x in self.new),10)
        self.assertEqual(sum(x["entryHourPositivePrint"] and
                             x["firstPrintMinuteOffset"]!=0 for x in self.new),59)
        self.assertTrue(all(x["venue_signed_fill"] is False and
                            x["actual_executable_fill_proven"] is False for x in self.new))

    def test_synthetic_direction_falsification(self):
        grouped=defaultdict(list)
        for x in self.new:
            grouped[x["price_regime"]].append(x)
        self.assertEqual(len(grouped["PERSISTENT_DOWN"]),32)
        self.assertEqual(sum(x["native_price_net30_pct"]>0
                             for x in grouped["PERSISTENT_DOWN"]),32)
        self.assertEqual(len(grouped["DOWN_THEN_SQUEEZE"]),28)
        self.assertEqual(sum(x["native_price_net30_pct"]>0
                             for x in grouped["DOWN_THEN_SQUEEZE"]),2)
        self.assertEqual(len(grouped["PERSISTENT_UP"]),5)
        self.assertEqual(sum(x["native_price_net30_pct"]>0
                             for x in grouped["PERSISTENT_UP"]),0)

if __name__=="__main__":
    unittest.main(verbosity=2)
