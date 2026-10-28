#!/usr/bin/env python3
"""Offline Q102 fail-closed audit tests. No venue connection or VPS mutation."""
import importlib.util
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

P = Path(__file__).with_name("q102-cutover-readiness-audit.py")
spec = importlib.util.spec_from_file_location("q102_cutover_preflight", P)
mod = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
A = "a" * 40
B = "b" * 40

def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")

with tempfile.TemporaryDirectory(prefix="q102-readonly-ci-") as d:
    root = Path(d)
    old, target = root/"releases"/A, root/"staging"/B
    old.mkdir(parents=True)
    target.mkdir(parents=True)
    (old/".disdex-release-sha").write_text(A)
    (target/".disdex-release-sha").write_text(B)
    write(target/"docs/production/current-implementation-readiness.json", {
        "schema":"disdex-current-implementation-readiness/v1",
        "implementationStatus":"READY", "blockers":["OPERATOR_LIVE_ACTIVATION_REQUIRED"],
        "target":"DD1296_FINAL_ALLIN_10BPS"})
    state = root/"q102-state.json"
    global_approval = root/"global.json"
    q102_approval = root/"q102-operator.json"
    kill = root/"kill.json"
    risk = root/"risk.json"
    write(state, {"runtimeCommitSha":A,"mode":"LIVE","position":None,"pending":None})
    write(global_approval, {"approvedSha":A,"approvedRunners":["QUALITY102_CAUSAL_V1","PENGU_V8"],"ordersEnabled":True})
    write(q102_approval, {"schema":"disdex-live-operator-activation/v1",
                           "approvedSha":B,"approvedRunners":["QUALITY102_CAUSAL_V1"],
                           "ordersEnabled":True,"target":"DD1296_FINAL_ALLIN_10BPS",
                           "operatorAcknowledgement":"I_ACK_REAL_MONEY_LIVE_ACTIVATION"})
    write(kill,{"active":False})
    write(risk,{"tripped":False,"lossPct":0.4,"maximumLossPct":7.5})
    inputs = mod.Inputs(A,B,old,target,state,global_approval,q102_approval,kill,risk)
    original_stat = Path.stat
    def fake_root_owned_stat(self, *a, **k):
        st = original_stat(self,*a,**k)
        if self != q102_approval:
            return st
        values = list(st)
        values[4] = 0 # uid root in stat_result
        values[5] = 0 # gid root
        return type(st)(values)

    with patch.object(Path,"stat",fake_root_owned_stat):
        passed = mod.audit(inputs)
        assert passed["status"] == "Q102_LOCAL_PRECHECK_PASS_NOT_AUTHORIZED_TO_DEPLOY", passed
        assert not passed["deploymentAuthorized"] and not passed["venueCertified"]
        assert not passed["economicBtCertified"]
        cases = [
          (state,{"runtimeCommitSha":A,"mode":"LIVE","pending":{"id":"unsafe"}},"Q102_EXPOSURE_OR_PENDING_NOT_FLAT"),
          (global_approval,{"approvedSha":B,"approvedRunners":["QUALITY102_CAUSAL_V1"],"ordersEnabled":True},"SHARED_OPERATOR_GATE_CHANGED_OR_UNEXPECTED"),
          (q102_approval,{"schema":"disdex-live-operator-activation/v1","approvedSha":B,"approvedRunners":["QUALITY102_CAUSAL_V1","PENGU_V8"],"ordersEnabled":True},"Q102_SCOPED_OPERATOR_MUST_ONLY_APPROVE_Q102"),
          (kill,{"active":True},"SHARED_KILL_SWITCH_ACTIVE_OR_UNPROVEN"),
          (risk,{"tripped":True,"lossPct":8.0,"maximumLossPct":7.5},"SHARED_DAILY_RISK_UNSAFE"),
        ]
        for path, bad, expected in cases:
            original = path.read_text()
            write(path,bad)
            got = mod.audit(inputs)
            assert got["status"] == "Q102_LOCAL_PRECHECK_BLOCKED" and expected in got["blockers"], (expected,got)
            path.write_text(original)
        (target/".disdex-release-sha").write_text(A)
        got=mod.audit(inputs)
        assert "TARGET_STAGE_MARKER_SHA_MISMATCH" in got["blockers"]
        print("Q102_CUTOVER_READONLY_FAIL_CLOSED_SELFTEST_PASS",
              "positive=1", "negative=6", "ordersSent=0")
