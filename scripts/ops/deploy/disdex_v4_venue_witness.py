#!/usr/bin/env python3
"""Fresh root-owned V4 cutover witness from official read-only runtime sources."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

VENUE_SCHEMA = "disdex-venue-readonly-evidence/v1"
SHA_RE = re.compile(r"^[a-f0-9]{40}$")
RELEASES = Path("/home/deploy/disdex-trading/releases")
EVIDENCE_ROOT = Path("/etc/disdex/v12-v4-evidence")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
ACCOUNT_LOCK = Path("/var/lib/disdex/shared/account-order.lock")
HEARTBEAT_ROOT = Path("/var/lib/disdex/runner-health/heartbeats")
V4_HEARTBEAT = Path("/var/lib/disdex/v12-v4/heartbeat.json")

PREFIXES = {
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
HEARTBEATS = {
    "V12_V4": ("v12-v4.json", 5 * 60_000),
    "PENGU_V8": ("pengu-v8.json", 3 * 60 * 60_000),
    "QUALITY102_CAUSAL_V1": ("quality102-causal-v1.json", 2 * 60 * 60_000),
    "V52": ("v52.json", 2 * 60_000),
    "FET_BRK48_RESIDUAL": ("fet-brk48-residual.json", 5 * 60_000),
    "HYPE_TREND_LONG": ("hype-trend-long.json", 35 * 60_000),
    "IDLE_PRIORITY_SHORT": ("idle-priority-short.json", 20 * 60_000),
}
ZERO_EFFECTS = {"ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}
PEER_STOP_SCHEMA = "disdex-peer-stop-approval/v1"
PEER_STOP_ACK = "I_ACK_PENGU_V8_PEER_STOP_NO_ORDERS"
PEER_STOP_FIELDS = {
    "schema", "status", "runner", "approvedSha", "deploymentTarget",
    "operatorTarget", "operator", "planSha256", "ordersEnabled",
    "approvedAt", "expiresAt", "operatorAcknowledgement", "nonceDigest",
}


def _secure_json(path: Path, *, require_root=True, max_bytes=524288) -> dict:
    st = path.lstat()
    if (not stat.S_ISREG(st.st_mode) or path.is_symlink()
            or (require_root and st.st_uid != 0) or st.st_mode & 0o022):
        raise ValueError("UNTRUSTED_JSON:" + str(path))
    raw = path.read_bytes()
    if len(raw) > max_bytes:
        raise ValueError("OVERSIZED_JSON:" + str(path))
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("JSON_NOT_OBJECT:" + str(path))
    return value


def _digest(value) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(raw).hexdigest()


def _dec(value, label: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("INVALID_NUMERIC:" + label) from None
    if not result.is_finite():
        raise ValueError("NONFINITE_NUMERIC:" + label)
    return result


def _dec_text(value, label: str) -> str:
    result = _dec(value, label)
    if result == 0:
        return "0"
    return format(result.normalize(), "f")


def validate_peer_stop_approval(value: dict, *, runner: str, sha: str,
                                now: int) -> dict:
    """Validate the derived, root-owned peer-stop certificate.

    The certificate is written only after the root executor verifies and
    consumes the owner's one-use token.  It is deliberately not an order
    grant and cannot be used to start, stop, or alter a service.  It only
    permits a fresh V4 witness to attest an explicitly approved, flat,
    inactive peer without silently treating that peer as healthy.
    """
    if (not isinstance(value, dict) or set(value) != PEER_STOP_FIELDS
            or value.get("schema") != PEER_STOP_SCHEMA
            or value.get("status") != "APPROVED"
            or value.get("runner") != runner
            or value.get("approvedSha") != sha
            or runner != "PENGU_V8"
            or not SHA_RE.fullmatch(str(sha))
            or value.get("deploymentTarget") != "professional-dismanager.net"
            or value.get("operatorTarget") != "DD1296_FINAL_ALLIN_10BPS"
            or not isinstance(value.get("operator"), str)
            or not re.fullmatch(r"[A-Za-z0-9-]{1,39}", value["operator"])
            or not re.fullmatch(r"[0-9a-f]{64}", str(value.get("planSha256")))
            or value.get("ordersEnabled") is not False
            or value.get("operatorAcknowledgement") != PEER_STOP_ACK
            or not re.fullmatch(r"[0-9a-f]{64}", str(value.get("nonceDigest")))):
        raise ValueError("PEER_STOP_APPROVAL_IDENTITY_INVALID")
    approved_at = value.get("approvedAt")
    expires_at = value.get("expiresAt")
    if (type(approved_at) is not int or type(expires_at) is not int
            or approved_at > now + 5 or expires_at <= now
            or not 1 <= expires_at - approved_at <= 3600):
        raise ValueError("PEER_STOP_APPROVAL_EXPIRED_OR_INVALID")
    return value


def normalize_positions(rows) -> list[dict]:
    if not isinstance(rows, list):
        raise ValueError("POSITIONS_NOT_ARRAY")
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("POSITION_NOT_OBJECT")
        amount = _dec(row.get("positionAmt", 0), "positionAmt")
        if amount == 0:
            continue
        symbol = str(row.get("symbol") or "")
        side = str(row.get("positionSide") or "BOTH")
        if not symbol or side not in ("BOTH", "LONG", "SHORT"):
            raise ValueError("POSITION_IDENTITY_INVALID")
        result.append({
            "symbol": symbol,
            "positionSide": side,
            "positionAmt": _dec_text(amount, "positionAmt"),
            "entryPrice": _dec_text(row.get("entryPrice", 0), "entryPrice"),
        })
    return sorted(result, key=lambda x: (x["symbol"], x["positionSide"]))


def normalize_orders(rows) -> list[dict]:
    if not isinstance(rows, list):
        raise ValueError("ORDERS_NOT_ARRAY")
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("ORDER_NOT_OBJECT")
        result.append({
            "symbol": str(row.get("symbol") or ""),
            "clientOrderId": str(row.get("clientOrderId") or ""),
            "orderId": str(row.get("orderId") or ""),
            "side": str(row.get("side") or ""),
            "type": str(row.get("type") or ""),
            "origQty": _dec_text(row.get("origQty", 0), "origQty"),
            "executedQty": _dec_text(row.get("executedQty", 0), "executedQty"),
            "reduceOnly": row.get("reduceOnly") is True,
            "status": str(row.get("status") or ""),
            "stopPrice": _dec_text(row.get("stopPrice") or 0, "stopPrice"),
        })
    return sorted(result, key=lambda x: (
        x["symbol"], x["clientOrderId"], x["orderId"], x["type"], x["side"]))


def protective_stop_counts(positions: list[dict], orders: list[dict]) -> tuple[int, int]:
    unknown = 0
    partial = 0
    by_symbol = {p["symbol"]: p for p in positions}
    protective = []
    for order in orders:
        if "STOP" not in order["type"].upper():
            continue
        protective.append(order)
        position = by_symbol.get(order["symbol"])
        if position is None or not order["reduceOnly"] or order["status"] != "NEW":
            unknown += 1
            continue
        amount = Decimal(position["positionAmt"])
        expected_side = "BUY" if amount < 0 else "SELL"
        if order["side"] != expected_side or not order["clientOrderId"]:
            unknown += 1
    for position in positions:
        amount = Decimal(position["positionAmt"])
        expected_side = "BUY" if amount < 0 else "SELL"
        coverage = Decimal("0")
        for order in protective:
            if (order["symbol"] == position["symbol"] and order["side"] == expected_side
                    and order["reduceOnly"] and order["status"] == "NEW"):
                coverage += max(
                    Decimal("0"),
                    Decimal(order["origQty"]) - Decimal(order["executedQty"]),
                )
        if coverage < abs(amount):
            partial += 1
    return unknown, partial


def _systemd(unit: str, prop: str) -> str:
    result = subprocess.run(
        ["/usr/bin/systemctl", "show", unit, "--property=" + prop, "--value"],
        capture_output=True, text=True, check=False, timeout=12)
    if result.returncode:
        raise ValueError("SYSTEMD_UNAVAILABLE:" + unit)
    return result.stdout.strip()


def _assert_release(sha: str) -> Path:
    if not SHA_RE.fullmatch(sha):
        raise ValueError("CANDIDATE_SHA_INVALID")
    root = RELEASES / sha
    st = root.lstat()
    if not stat.S_ISDIR(st.st_mode) or root.is_symlink() or st.st_uid != 0:
        raise ValueError("CANDIDATE_RELEASE_UNTRUSTED")
    marker = root / ".disdex-release-sha"
    mst = marker.lstat()
    if not stat.S_ISREG(mst.st_mode) or mst.st_uid != 0 or mst.st_mode & 0o222:
        raise ValueError("CANDIDATE_RELEASE_MARKER_UNTRUSTED")
    if marker.read_text("ascii").strip() != sha:
        raise ValueError("CANDIDATE_RELEASE_MARKER_MISMATCH")
    return root


def _assert_runtime_health(now_ms: int) -> tuple[dict, list[dict]]:
    risk = _secure_json(RISK)
    if risk.get("sourceComplete") is not True or risk.get("tripped") is True:
        raise ValueError("SHARED_RISK_NOT_HEALTHY")
    limit = _dec(risk.get("maximumLossPct"), "maximumLossPct") / Decimal("100")
    if limit != Decimal("0.075"):
        raise ValueError("SHARED_RISK_DAILY_LIMIT_MISMATCH")
    margin = _secure_json(MARGIN)
    if margin.get("stage") != "HEALTHY" or margin.get("ordersAllowed") is not True:
        raise ValueError("MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    if (type(checked) not in (int, float) or checked > now_ms + 1000
            or now_ms - checked > 15 * 60_000):
        raise ValueError("MARGIN_GUARD_STALE")
    kill = _secure_json(KILL)
    if kill.get("active") is not False:
        raise ValueError("SHARED_KILL_SWITCH_ACTIVE")
    pending = _secure_json(PENDING)
    entries = pending.get("entries")
    if not isinstance(entries, list):
        raise ValueError("PENDING_EXPOSURE_INVALID")
    active = [x for x in entries if isinstance(x, dict)
              and str(x.get("status", "")).upper() != "RELEASED"]
    if active:
        raise ValueError("PENDING_EXPOSURE_ACTIVE")
    if ACCOUNT_LOCK.exists() or ACCOUNT_LOCK.is_symlink():
        raise ValueError("ACCOUNT_LOCK_PRESENT")
    return risk, active


def validate_units_and_ticks(expected_pins: dict[str, str], phase: str,
                             candidate_sha: str, now_ms: int, *,
                             peer_stop_approvals: dict[str, dict] | None = None) -> None:
    if set(expected_pins) != set(PREFIXES):
        raise ValueError("RUNNER_SHA_MAP_INCOMPLETE")
    peer_stop_approvals = peer_stop_approvals or {}
    for runner, sha in expected_pins.items():
        if not SHA_RE.fullmatch(str(sha)):
            raise ValueError("RUNNER_SHA_INVALID:" + runner)
        unit = f"{PREFIXES[runner]}@{sha}.service"
        active = _systemd(unit, "ActiveState")
        pid = _systemd(unit, "MainPID")
        if runner == "V12_V4" and phase == "before":
            if active not in ("failed", "inactive", "active"):
                raise ValueError("OLD_V4_BASELINE_INVALID")
            if active != "active" and pid != "0":
                raise ValueError("OLD_V4_DORMANT_PID_NONZERO")
            continue
        if active != "active":
            if not pid.isdigit() or int(pid) != 0:
                raise ValueError("RUNNER_DORMANT_PID_INVALID:" + runner)
            approval = peer_stop_approvals.get(runner)
            if approval is None:
                raise ValueError("RUNNER_NOT_ACTIVE:" + runner)
            validate_peer_stop_approval(
                approval, runner=runner, sha=sha, now=now_ms // 1000)
            continue
        if not pid.isdigit() or int(pid) <= 100:
            raise ValueError("RUNNER_NOT_ACTIVE:" + runner)
        if runner in HEARTBEATS and runner != "V12_V4":
            file_name, max_age = HEARTBEATS[runner]
            hb = _secure_json(HEARTBEAT_ROOT / file_name)
            if (hb.get("schema") != "disdex-runner-heartbeat/v1"
                    or hb.get("runnerId") != runner
                    or str(hb.get("runtimeSha", "")).lower() != sha
                    or str(hb.get("expectedSha", "")).lower() != sha
                    or hb.get("serviceUnit") != unit):
                raise ValueError("RUNNER_HEARTBEAT_IDENTITY_MISMATCH:" + runner)
            heartbeat_at = hb.get("heartbeatAt")
            tick_at = hb.get("lastTickAt")
            if (type(heartbeat_at) is not int or heartbeat_at > now_ms + 1000
                    or now_ms - heartbeat_at > 120_000):
                raise ValueError("RUNNER_HEARTBEAT_STALE:" + runner)
            if (type(tick_at) is not int or tick_at > now_ms + 1000
                    or now_ms - tick_at > max_age):
                raise ValueError("RUNNER_TICK_STALE:" + runner)
    if phase == "after":
        unit = f"{PREFIXES['V12_V4']}@{candidate_sha}.service"
        pid = _systemd(unit, "MainPID")
        hb = _secure_json(V4_HEARTBEAT)
        if (hb.get("schema") != "disdex-v12-v4-runner-heartbeat/v1"
                or hb.get("releaseSha") != candidate_sha
                or hb.get("runtimeSha") != candidate_sha
                or hb.get("expectedSha") != candidate_sha
                or hb.get("serviceUnit") != unit
                or not pid.isdigit() or hb.get("mainPid") != int(pid)
                or hb.get("mode") != "LIVE" or hb.get("liveEnabled") is not True
                or hb.get("limitedLive") is not False
                or hb.get("safetyState") != "HEALTHY"
                or type(hb.get("orderEnabled")) is not bool
                or hb.get("ordersAllowed") is not hb.get("orderEnabled")):
            raise ValueError("V4_DIRECT_HEARTBEAT_IDENTITY_MISMATCH")
        for field in ("heartbeatAt", "lastTickAt"):
            value = hb.get(field)
            if (type(value) is not int or value > now_ms + 1000
                    or now_ms - value > 5 * 60_000):
                raise ValueError("V4_DIRECT_HEARTBEAT_STALE:" + field)


def bounded_evidence_command(sha: str, release: Path) -> list[str]:
    if not SHA_RE.fullmatch(sha) or release != RELEASES / sha:
        raise ValueError("BOUNDED_EVIDENCE_RELEASE_BINDING_INVALID")
    script = r"""
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readV4ProductionCertificate,validateV4SharedExecutionEvidencePayloads,V4_SHARED_EXECUTION_EVIDENCE_PATHS} from './lib/v12-v4-certified-gates.ts';
import {validateV4RefreshCommit,V4_DYNAMIC_EVIDENCE_KEYS} from './lib/v12-v4-refresh-commit.ts';
const sha=process.argv[1];
const certificate=await readV4ProductionCertificate(sha);
if(certificate.schema!=='disdex-v12-v4-production-certification/v4')throw Error('BOUNDED_CERTIFICATE_REQUIRED');
async function trusted(path){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await fd.stat();
  if(!stat.isFile()||stat.uid!==0||(stat.mode&0o022)!==0||stat.size>1048576)throw Error('UNTRUSTED_EVIDENCE');
  const bytes=await fd.readFile();return {bytes,payload:JSON.parse(bytes.toString('utf8'))};
 }finally{await fd.close();}
}
const commit=(await trusted('/etc/disdex/v12-v4-evidence/refresh-commit.json')).payload;
const now=Date.now();validateV4RefreshCommit(commit,sha,now);
const payloads={...commit.evidencePayloads};
for(const key of V4_DYNAMIC_EVIDENCE_KEYS){
 if(payloads[key].refreshGeneration!==commit.refreshGeneration||payloads[key].capturedAt!==commit.capturedAt)
  throw Error('MIXED_EVIDENCE_GENERATION');
}
for(const key of ['routeSourceParity','v4ExecutionTests']){
 const row=await trusted(V4_SHARED_EXECUTION_EVIDENCE_PATHS[key]);
 if(createHash('sha256').update(row.bytes).digest('hex')!==certificate.evidenceSha256[key])throw Error('STATIC_DIGEST_MISMATCH');
 payloads[key]=row.payload;
}
validateV4SharedExecutionEvidencePayloads(payloads,sha,now,true);
console.log(JSON.stringify({status:'V4_BOUNDED_EVIDENCE_SNAPSHOT_VERIFIED',candidateSha:sha,
 certificateSchema:certificate.schema,certificateValidUntilMs:Date.parse(certificate.validUntil),
 leaseExpiresAtMs:commit.leaseExpiresAt*1000,capturedAt:commit.capturedAt,capturedAtMs:Date.parse(commit.capturedAt),
 refreshGeneration:commit.refreshGeneration,evidencePayloads:commit.evidencePayloads}));
"""
    return ["/usr/bin/node", "--import", str(release/"node_modules/tsx/dist/loader.mjs"),
            "--input-type=module", "--eval", script, sha]


def validate_bounded_snapshot(value: dict, sha: str, now_ms: int) -> dict:
    from datetime import datetime
    if (not isinstance(value,dict) or value.get("status")!="V4_BOUNDED_EVIDENCE_SNAPSHOT_VERIFIED"
            or value.get("candidateSha")!=sha
            or value.get("certificateSchema")!="disdex-v12-v4-production-certification/v4"):
        raise ValueError("BOUNDED_SNAPSHOT_IDENTITY_INVALID")
    for field in ["certificateValidUntilMs","leaseExpiresAtMs"]:
        if type(value.get(field)) is not int or value[field]<=now_ms:
            raise ValueError("BOUNDED_SNAPSHOT_AUTHORITY_EXPIRED")
    captured=value.get("capturedAtMs");text=value.get("capturedAt")
    if (type(captured) is not int or captured<=0 or not 0<=now_ms-captured<=180000
            or not isinstance(text,str) or not text.endswith('Z')):
        raise ValueError("BOUNDED_SNAPSHOT_SOURCE_STALE_OR_FUTURE")
    try:parsed=round(datetime.fromisoformat(text.replace('Z','+00:00')).timestamp()*1000)
    except (ValueError,OverflowError):raise ValueError("BOUNDED_SNAPSHOT_SOURCE_TIME_INVALID") from None
    if parsed!=captured:raise ValueError("BOUNDED_SNAPSHOT_SOURCE_TIME_MISMATCH")
    generation=value.get("refreshGeneration");payloads=value.get("evidencePayloads")
    keys={"establishedAsterOrders","signedAsterAccount","sharedRiskAndPeers"}
    if (not isinstance(generation,str) or not 0<len(generation)<=160
            or not isinstance(payloads,dict) or set(payloads)!=keys):
        raise ValueError("BOUNDED_SNAPSHOT_GENERATION_INVALID")
    if any(not isinstance(row,dict) or row.get("refreshGeneration")!=generation
            or row.get("capturedAt")!=text or row.get("candidateSha")!=sha or row.get("status")!="PASS"
            for row in payloads.values()):
        raise ValueError("BOUNDED_SNAPSHOT_MIXED_OR_INVALID_PROOFS")
    return value


def read_bounded_snapshot(sha: str, release: Path) -> dict:
    result=subprocess.run(bounded_evidence_command(sha,release),cwd=release,
        capture_output=True,text=True,check=False,timeout=60)
    if result.returncode or len(result.stdout)>2*1048576:
        raise ValueError("V4_BOUNDED_CERTIFICATE_EVIDENCE_PREFLIGHT_FAILED")
    try:value=json.loads(result.stdout)
    except (ValueError,TypeError):raise ValueError("V4_BOUNDED_EVIDENCE_OUTPUT_INVALID") from None
    return validate_bounded_snapshot(value,sha,time.time_ns()//1000000)


def refresh_and_preflight(sha: str, release: Path) -> dict:
    unit = f"disdex-v4-dynamic-evidence-refresh@{sha}.service"
    started = subprocess.run(
        ["/usr/bin/systemctl", "start", "--wait", unit],
        capture_output=True, text=True, check=False, timeout=90)
    if started.returncode:
        raise ValueError("DYNAMIC_EVIDENCE_REFRESH_FAILED")
    return read_bounded_snapshot(sha,release)


def collect_v4_venue_evidence(*, sha: str, expected_pins: dict[str, str],
                              phase: str, now: int | None = None,
                              refresh: bool = True,
                              peer_stop_approvals: dict[str, dict] | None = None) -> dict:
    if os.geteuid() != 0:
        raise ValueError("ROOT_REQUIRED")
    if phase not in ("before", "after"):
        raise ValueError("WITNESS_PHASE_INVALID")
    release = _assert_release(sha)
    snapshot = refresh_and_preflight(sha, release) if refresh else read_bounded_snapshot(sha,release)
    now_ms = time.time_ns()//1000000 if now is None else now*1000
    now_s = now_ms//1000
    risk, active_pending = _assert_runtime_health(now_ms)
    validate_units_and_ticks(
        expected_pins, phase, sha, now_ms,
        peer_stop_approvals=peer_stop_approvals,
    )

    snapshot=validate_bounded_snapshot(snapshot,sha,now_ms)
    payloads=snapshot["evidencePayloads"]
    orders_evidence=payloads["establishedAsterOrders"]
    account_evidence=payloads["signedAsterAccount"]
    risk_evidence=payloads["sharedRiskAndPeers"]
    for label, evidence in (
        ("orders", orders_evidence), ("account", account_evidence), ("risk", risk_evidence)):
        if evidence.get("status") != "PASS" or evidence.get("candidateSha") != sha:
            raise ValueError("DYNAMIC_EVIDENCE_IDENTITY_MISMATCH:" + label)
    if (account_evidence.get("signedGet") is not True
            or account_evidence.get("readOnly") is not True
            or account_evidence.get("mutationCalls") != 0
            or orders_evidence.get("readOnly") is not True
            or orders_evidence.get("mutationCalls") != 0):
        raise ValueError("SIGNED_READONLY_EVIDENCE_INVALID")
    if (risk_evidence.get("sharedRiskHealthy") is not True
            or risk_evidence.get("marginGuardHealthy") is not True
            or risk_evidence.get("killSwitch") is not False
            or int(risk_evidence.get("pendingCount", -1)) != 0):
        raise ValueError("DYNAMIC_RISK_EVIDENCE_INVALID")

    account_positions = normalize_positions(account_evidence.get("positions"))
    order_positions = normalize_positions(orders_evidence.get("positions"))
    account_orders = normalize_orders(account_evidence.get("openOrders"))
    order_orders = normalize_orders(orders_evidence.get("openOrders"))
    if account_positions != order_positions:
        raise ValueError("SIGNED_POSITION_EVIDENCE_DIVERGED")
    if account_orders != order_orders:
        raise ValueError("SIGNED_ORDER_EVIDENCE_DIVERGED")
    unknown, partial = protective_stop_counts(account_positions, account_orders)
    if unknown or partial:
        raise ValueError("PROTECTIVE_STOP_RECONCILIATION_FAILED")

    return {
        "schema": VENUE_SCHEMA, "venue": "aster", "readOnly": True,
        "capturedAt": snapshot["capturedAtMs"]//1000,
        "expiresAt": snapshot["capturedAtMs"]//1000 + 180,
        "signatureVerified": True, "positionsReconciled": True,
        "protectiveStopsReconciled": True, "stopOwnershipReconciled": True,
        "pendingExposureReconciled": True, "grossReconciled": True,
        "sharedRiskHealthy": True, "marginGuardHealthy": True,
        "accountLockHealthy": True, "killSwitchHealthy": True,
        "heartbeatVerified": True, "tickVerified": True,
        "runnerShaMapVerified": True,
        "peerStopApprovalsVerified": sorted(peer_stop_approvals or {}),
        "sharedRiskDailyLossLimit": float(
            _dec(risk.get("maximumLossPct"), "maximumLossPct") / Decimal("100")),
        "unknownStops": 0, "partialStops": 0,
        "positionsDigest": _digest(account_positions),
        "protectiveOrdersDigest": _digest(account_orders),
        "pendingDigest": _digest(active_pending),
        **ZERO_EFFECTS,
    }
