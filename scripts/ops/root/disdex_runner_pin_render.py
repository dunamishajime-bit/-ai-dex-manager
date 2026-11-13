#!/usr/bin/env python3
"""Render runner-specific monitoring configuration from a validated manifest.

This tool is source/staging only. It never writes /etc, /var/lib, systemd, orders,
risk state, or exchange state. A caller must provide an ordinary output directory.
"""
import argparse
import json
from pathlib import Path
import re

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PREFIX = {
    "V12_V4": "disdex-v12-v4",
    "PENGU_V8": "disdex-pengu-dual-ls-v2",
    "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1",
    "V52": "disdex-v52-aster-only",
    "FET_BRK48_RESIDUAL": "disdex-fet-brk48",
    "HYPE_TREND_LONG": "disdex-hype-long",
    "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short",
    "SHARED_CRYPTO_RISK": "disdex-shared-crypto-risk",
    "MARGIN_GUARD": "disdex-v12-v52-margin-guard",
}

PATH_DEFAULTS = {
    "V12_V4": {"statePath": "/var/lib/disdex/v12-v4/heartbeat.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/v12-v4.json", "tickPath": "/var/lib/disdex/runner-health/ticks/v12-v4.json"},
    "PENGU_V8": {"statePath": "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/pengu-v8.json", "tickPath": "/var/lib/disdex/runner-health/ticks/pengu-v8.json"},
    "QUALITY102_CAUSAL_V1": {"statePath": "/var/lib/disdex/quality102-causal-v1/state.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json", "tickPath": "/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json"},
    "V52": {"statePath": "/var/lib/disdex/v52-aster-only/runner-live.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/v52.json", "tickPath": "/var/lib/disdex/runner-health/ticks/v52.json"},
    "FET_BRK48_RESIDUAL": {"statePath": "/var/lib/disdex/fet-brk48-residual/state.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/fet-brk48-residual.json", "tickPath": "/var/lib/disdex/runner-health/ticks/fet-brk48-residual.json"},
    "HYPE_TREND_LONG": {"statePath": "/var/lib/disdex/hype-zec-long/runner.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/hype-trend-long.json", "tickPath": "/var/lib/disdex/runner-health/ticks/hype-trend-long.json"},
    "IDLE_PRIORITY_SHORT": {"statePath": "/var/lib/disdex/idle-priority/state.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/idle-priority-short.json", "tickPath": "/var/lib/disdex/runner-health/ticks/idle-priority-short.json"},
    "SHARED_CRYPTO_RISK": {"statePath": "/var/lib/disdex/shared/crypto-daily-risk.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/shared-crypto-risk.json", "tickPath": "/var/lib/disdex/runner-health/ticks/shared-crypto-risk.json"},
    "MARGIN_GUARD": {"statePath": "/var/lib/disdex/shared/margin-risk/guard-live.json", "healthPath": "/var/lib/disdex/runner-health/heartbeats/margin-guard.json", "tickPath": "/var/lib/disdex/runner-health/ticks/margin-guard.json"},
}


def validate(raw):
    schema = raw.get("schema")
    if schema not in ("disdex-runner-pin-manifest/v1", "disdex-runner-pin-manifest/v2"):
        raise RuntimeError("RUNNER_PIN_SCHEMA")
    if raw.get("target") != "professional-dismanager.net":
        raise RuntimeError("RUNNER_PIN_TARGET")
    if schema == "disdex-runner-pin-manifest/v2" and raw.get("operatorTarget") != "DD1296_FINAL_ALLIN_10BPS":
        raise RuntimeError("RUNNER_PIN_OPERATOR_TARGET")
    if "operatorTarget" in raw and raw["operatorTarget"] != "DD1296_FINAL_ALLIN_10BPS":
        raise RuntimeError("RUNNER_PIN_OPERATOR_TARGET")
    runners = raw.get("runners")
    if not isinstance(runners, dict) or set(runners) != set(PREFIX):
        raise RuntimeError("RUNNER_PIN_SET")
    for key, prefix in PREFIX.items():
        pin = runners[key]
        sha = str(pin.get("sha") or "")
        root = str(pin.get("releaseRoot") or "")
        unit = str(pin.get("serviceUnit") or "")
        if not SHA_RE.fullmatch(sha):
            raise RuntimeError("RUNNER_PIN_SHA:" + key)
        if root != "/home/deploy/disdex-trading/releases/" + sha:
            raise RuntimeError("RUNNER_PIN_ROOT:" + key)
        if unit != f"{prefix}@{sha}.service":
            raise RuntimeError("RUNNER_PIN_UNIT:" + key)
        if pin.get("evidenceMode") not in ("legacy", "heartbeat_v1", "tick_v1"):
            raise RuntimeError("RUNNER_PIN_MODE:" + key)
        for field in ("statePath", "healthPath", "tickPath"):
            value = pin.get(field)
            if schema == "disdex-runner-pin-manifest/v2" and not value:
                raise RuntimeError(f"RUNNER_PIN_{field.upper()}:{key}")
            value = str(value if value is not None else PATH_DEFAULTS[key][field])
            if not value.startswith("/var/lib/disdex/") or ".." in Path(value).parts:
                raise RuntimeError(f"RUNNER_PIN_{field.upper()}:{key}")
    return raw


def runtime_path(runners, key, field):
    value = runners[key].get(field)
    return value if value is not None else PATH_DEFAULTS[key][field]


def env_line(name, value):
    if any(ch in str(value) for ch in "\r\n"):
        raise RuntimeError("ENV_VALUE_NEWLINE")
    return f"{name}={value}"

def render(manifest):
    r = manifest["runners"]
    v4 = r["V12_V4"]
    health = [
        env_line("DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA", v4["sha"]),
        env_line("DISDEX_HEALTH_SNAPSHOT_RELEASE_ROOT", v4["releaseRoot"]),
        env_line("DISDEX_HEALTH_SNAPSHOT_V12_EXPECTED_SHA", v4["sha"]),
        env_line("DISDEX_HEALTH_SNAPSHOT_V12_RELEASE_ROOT", v4["releaseRoot"]),
        "DISDEX_HEALTH_SNAPSHOT_V12_MODE=V4",
    ]
    watchdog = [
        env_line("DISDEX_WATCHDOG_EXPECTED_SHA", v4["sha"]),
        env_line("DISDEX_WATCHDOG_APPROVED_SHA", v4["sha"]),
        env_line("DISDEX_WATCHDOG_RELEASE_ROOT", v4["releaseRoot"]),
        "DISDEX_WATCHDOG_V12_MODE=V4",
    ]
    mapping = {
        "PENGU_V8": "PENGU",
        "V52": "V52",
        "QUALITY102_CAUSAL_V1": "Q102",
        "FET_BRK48_RESIDUAL": "FET",
        "HYPE_TREND_LONG": "HYPE",
        "IDLE_PRIORITY_SHORT": "IDLE",
    }
    for key, suffix in mapping.items():
        pin = r[key]
        health += [
            env_line(f"DISDEX_HEALTH_SNAPSHOT_{suffix}_EXPECTED_SHA", pin["sha"]),
            env_line(f"DISDEX_HEALTH_SNAPSHOT_{suffix}_RELEASE_ROOT", pin["releaseRoot"]),
        ]
        watchdog += [
            env_line(f"DISDEX_WATCHDOG_{suffix}_EXPECTED_SHA", pin["sha"]),
            env_line(f"DISDEX_WATCHDOG_{suffix}_RELEASE_ROOT", pin["releaseRoot"]),
            env_line(f"DISDEX_WATCHDOG_{suffix}_SERVICE_UNIT", pin["serviceUnit"]),
        ]
    health += [
        env_line("DISDEX_HEALTH_SNAPSHOT_V12_STATE_PATH", runtime_path(r, "V12_V4", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_PENGU_STATE_PATH", runtime_path(r, "PENGU_V8", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_V52_STATE_PATH", runtime_path(r, "V52", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_Q102_STATE_PATH", runtime_path(r, "QUALITY102_CAUSAL_V1", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_FET_STATE_PATH", runtime_path(r, "FET_BRK48_RESIDUAL", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_HYPE_STATE_PATH", runtime_path(r, "HYPE_TREND_LONG", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_IDLE_STATE_PATH", runtime_path(r, "IDLE_PRIORITY_SHORT", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_STATE_PATH", runtime_path(r, "SHARED_CRYPTO_RISK", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT", r["SHARED_CRYPTO_RISK"]["serviceUnit"]),
        env_line("DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT", r["SHARED_CRYPTO_RISK"]["releaseRoot"]),
        env_line("DISDEX_HEALTH_SNAPSHOT_MARGIN_STATE_PATH", runtime_path(r, "MARGIN_GUARD", "statePath")),
        env_line("DISDEX_HEALTH_SNAPSHOT_MARGIN_SERVICE_UNIT", r["MARGIN_GUARD"]["serviceUnit"]),
        env_line("DISDEX_HEALTH_SNAPSHOT_MARGIN_RELEASE_ROOT", r["MARGIN_GUARD"]["releaseRoot"]),
    ]
    watchdog += [
        env_line("DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA", r["SHARED_CRYPTO_RISK"]["sha"]),
        env_line("DISDEX_WATCHDOG_MARGIN_GUARD_EXPECTED_SHA", r["MARGIN_GUARD"]["sha"]),
    ]
    v52 = [
        env_line("DISDEX_V52_RUNTIME_SHA", r["V52"]["sha"]),
        env_line("DISDEX_V52_RUNTIME_ROOT", r["V52"]["releaseRoot"]),
        env_line("DISDEX_V52_SERVICE_UNIT", r["V52"]["serviceUnit"]),
        env_line("DISDEX_V52_HEALTH_PATH", runtime_path(r, "V52", "healthPath")),
        env_line("DISDEX_V52_TICK_PATH", runtime_path(r, "V52", "tickPath")),
    ]
    pengu_q102 = [
        env_line("DISDEX_Q102_RUNTIME_SHA", r["QUALITY102_CAUSAL_V1"]["sha"]),
    ]
    pengu_q102_dropin = [
        "[Service]",
        env_line(
            "EnvironmentFile",
            f"/etc/disdex/current-runtime/{r['PENGU_V8']['sha']}-pengu-q102-runtime.env",
        ),
    ]
    fet_q102 = [
        env_line("DISDEX_Q102_RUNTIME_SHA", r["QUALITY102_CAUSAL_V1"]["sha"]),
    ]
    fet_q102_dropin = [
        "[Service]",
        env_line(
            "EnvironmentFile",
            f"/etc/disdex/current-runtime/{r['FET_BRK48_RESIDUAL']['sha']}-fet-q102-runtime.env",
        ),
    ]
    return {
        "runner-pins.json": json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        "health-snapshot.env": "\n".join(health) + "\n",
        "watchdog.env": "\n".join(watchdog) + "\n",
        "v52-current.env": "\n".join(v52) + "\n",
        "pengu-q102-runtime.env": "\n".join(pengu_q102) + "\n",
        "pengu-q102-runtime.conf": "\n".join(pengu_q102_dropin) + "\n",
        "fet-q102-runtime.env": "\n".join(fet_q102) + "\n",
        "fet-q102-runtime.conf": "\n".join(fet_q102_dropin) + "\n",
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    out = Path(args.output_dir)
    if out.is_absolute() and (str(out).startswith("/etc/") or str(out).startswith("/var/lib/")):
        raise SystemExit("PRODUCTION_OUTPUT_PATH_FORBIDDEN")
    out.mkdir(parents=True, exist_ok=True)
    manifest = validate(json.loads(Path(args.manifest).read_text(encoding="utf-8")))
    rendered = render(manifest)
    for name, value in rendered.items():
        path = out / name
        tmp = out / (name + ".tmp")
        tmp.write_text(value, encoding="utf-8")
        tmp.replace(path)
    print(json.dumps({
        "status": "RUNNER_PIN_RENDER_PASS",
        "outputDir": str(out),
        "files": sorted(rendered),
        "tradingMutation": 0,
    }, separators=(",", ":")))

if __name__ == "__main__":
    main()
