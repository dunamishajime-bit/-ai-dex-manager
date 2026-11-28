"""Render the adopted policy monitor connection for an exact release.
No systemctl, root writes, certificates, approval redemption, or venue calls.
This is not the historic fixed-SHA cutover helper and never activates a runner.
"""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
from disdex_stable4_dd30_monitor_cutover import dropin_text

ROOT = Path(__file__).resolve().parents[3]
SHA = re.compile(r"^[a-f0-9]{40}$")

def render(sha: str) -> dict:
    if not SHA.fullmatch(sha):
        raise ValueError("EXACT_CANDIDATE_SHA_REQUIRED")
    source = f"/var/lib/disdex/stable4-observation/{sha}/snapshot.json"
    timer = f"disdex-stable4-market-observer@{sha}.timer"
    policies = {
        "V12_V4": (f"disdex-v12-v4@{sha}.service", {
            "DISDEX_STABLE4_V4_ENTRY_POLICY": "R21_ONE",
            "V12_V4_OPERATION_MODE": "MONITOR_ONLY",
            "V12_V4_ORDERS_ENABLED": "false",
            "DISDEX_STABLE4_RESEARCH_OBSERVATION_PATH": source,
        }),
        "PENGU_V8": (f"disdex-pengu-dual-ls-v2@{sha}.service", {
            "DISDEX_STABLE4_PENGU_ENTRY_POLICY": "P91",
            "PENGU_DUAL_LS_V2_MODE": "SHADOW",
            "PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED": "false",
            "PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED": "false",
            "DISDEX_STABLE4_RESEARCH_OBSERVATION_PATH": source,
        }),
        "IDLE_PRIORITY_SHORT": (f"disdex-idle-priority-short@{sha}.service", {
            "DISDEX_STABLE4_IDLE_ENTRY_POLICY": "R26",
            "DISDEX_IDLE_PRIORITY_MODE": "SHADOW",
            "DISDEX_IDLE_R26_LIVE_CERTIFIED": "false",
            "DISDEX_IDLE_PRIORITY_OPERATOR_ARMED": "false",
        }),
    }
    files = {}
    for runner, (unit, env) in policies.items():
        env = {**env, "DISDEX_RELEASE_SHA": sha, "DISDEX_RUNTIME_COMMIT_SHA": sha}
        lines = dropin_text(runner, sha, unit).splitlines()
        launches = [i for i, x in enumerate(lines) if x.startswith("ExecStart=/usr/bin/env ")]
        if len(launches) != 1:
            raise ValueError("MONITOR_EXEC_BOUNDARY_NOT_UNIQUE:" + runner)
        # The inherited monitor script's shell exports are no-order too.
        i = launches[0]
        line = lines[i]
        for key, value in env.items():
            matches = re.findall(r"(?<![A-Za-z0-9_])" + key + r"=([^ ;]+)", line)
            if any(x != value for x in matches):
                raise ValueError("CONFLICTING_MONITOR_SETTING:" + key)
        lines[i] = "ExecStart=/usr/bin/env " + " ".join(k+"="+v for k,v in env.items()) + " " + line.removeprefix("ExecStart=/usr/bin/env ")
        lines += ["Environment="+k+"="+v for k,v in env.items()]
        if runner != "IDLE_PRIORITY_SHORT":
            lines.insert(lines.index("[Service]"), "Wants="+timer)
        files[unit+".d/90-adopted-monitor.conf"] = "\n".join(lines)+"\n"
    names=("disdex-stable4-market-observer@.service",
           "disdex-stable4-market-observer@.timer","disdex-h48-stop8-shadow@.service")
    for name in names:
        files[name] = (ROOT/"ops/systemd"/name).read_text(encoding="utf8")
    return {
        "schema": "stable4-adopted-monitor-bundle/v1",
        "sourceSha": sha,
        "status": "RENDERED_ONLY_NOT_INSTALLED",
        "ordersEnabled": False,
        "formalCertificateIssued": False,
        "productionInstalled": False,
        "observerTimer": timer,
        "h48ShadowUnit": f"disdex-h48-stop8-shadow@{sha}.service",
        "files": files,
    }

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--sha",required=True)
    print(json.dumps(render(parser.parse_args().sha),indent=2,sort_keys=True))
