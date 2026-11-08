"""Fixed scope shared by the HYPE root executor and SSH adapter."""
import hashlib
import json
import re
from datetime import datetime,timezone

REPOSITORY = "dunamishajime-bit/-ai-dex-manager"
HOST = "professional-dismanager.net"
OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS"
OWNER = "dunamishajime-bit"
RUNNER = "HYPE_TREND_LONG"
OPERATION = "HYPE_TREND_LONG_SHA_RESTORE"
V4_OPERATION = "V4_HYPE_PEER_PIN_CONTINUITY"
V4_SCOPE = "V12_V4"
LEGACY = "d6bcc94512a6416189cd92d7203b9ac3b2c98e70"
CANDIDATE = "a7eee1f91d86d51f2333da117243d044ae1332dc"
COMMAND = "/usr/local/sbin/disdex-hype-sha-owner-restore"
XRP_STOP = "v12-v4-231ed20b6835c4148b5314d8da7e"
PLAN = hashlib.sha256(
    f"HYPE_SHA_RESTORE_V1\n{LEGACY}\n{CANDIDATE}\nXRPUSDT_SHORT_13.3_STOP_{XRP_STOP}\n".encode()
).hexdigest()


def require(condition, reason):
    if not condition:
        raise ValueError("HYPE_SHA_RESTORE_" + reason)


def parse_command(argv):
    require(len(argv) == 4 and argv[0] == COMMAND and argv[1] == "--run-id"
            and re.fullmatch(r"[0-9]{1,20}", argv[2]) is not None
            and argv[3] == "--read-approval-stdin", "FORCED_COMMAND_REJECTED")
    return argv[2]


def validate_forced_command(argv):
    if argv != [COMMAND,"--preflight-readonly"]:
        parse_command(argv)
    return argv


def proposed_pins(pins):
    require(pins.get(RUNNER) == LEGACY, "OLD_PIN_MISMATCH")
    return {**pins, RUNNER: CANDIDATE}


def verify_peer_authority(current, proposed, validate_v4):
    try:
        validate_v4(current)
    except ValueError:
        raise ValueError("HYPE_SHA_RESTORE_V4_BASELINE_AUTHORITY_INVALID") from None
    try:
        validate_v4(proposed)
    except ValueError:
        raise ValueError("HYPE_SHA_RESTORE_V4_RESTART_AUTHORITY_WOULD_BREAK") from None


def v4_continuity_plan(current, proposed, prior_hash):
    require(proposed==proposed_pins(current) and re.fullmatch(r"[0-9a-f]{64}",prior_hash)
            and all(re.fullmatch(r"[0-9a-f]{40}",sha) for sha in current.values())
            and V4_SCOPE in current,"V4_CONTINUITY_SCOPE")
    bound=dict(schema="disdex-v4-hype-peer-pin-continuity/v1",repository=REPOSITORY,
        deploymentTarget=HOST,operatorTarget=OPERATOR_TARGET,scope=V4_SCOPE,
        sourceSha=current[V4_SCOPE],ordersEnabled=True,previousRunnerShas=current,
        nextRunnerShas=proposed,previousApprovalSha256=prior_hash,hypePlanSha256=PLAN)
    return hashlib.sha256(json.dumps(bound,sort_keys=True,separators=(",",":")).encode()).hexdigest()


def build_v4_continuity_activation(auth,current,proposed,prior_hash,now):
    plan=v4_continuity_plan(current,proposed,prior_hash)
    require(auth.get("scope")==V4_SCOPE and auth.get("sourceSha")==current[V4_SCOPE]
            and auth.get("planSha256")==plan and auth.get("ordersEnabled") is True
            and auth.get("route")=="GITHUB_ACTIONS" and auth.get("operator")==OWNER
            and type(auth.get("issuedAt")) is int and type(auth.get("expiresAt")) is int
            and auth["issuedAt"]<=now<auth["expiresAt"] and 1<=auth["expiresAt"]-auth["issuedAt"]<=300
            and re.fullmatch(r"[0-9a-f]{32}",auth.get("nonce","")),"V4_CONTINUITY_APPROVAL")
    return dict(schema="disdex-live-operator-activation/v1",repository=REPOSITORY,
        deploymentTarget=HOST,target=OPERATOR_TARGET,scope=V4_SCOPE,operation=V4_OPERATION,
        approvedSha=current[V4_SCOPE],approvedRunners=[V4_SCOPE],approvedShaByRunner=proposed,
        ordersEnabled=True,activationClass="FULL_LIVE",route="GITHUB_ACTIONS",
        authorizationMethod="OWNER_SIGNED_TOKEN",
        approvedAt=datetime.fromtimestamp(auth["issuedAt"],timezone.utc).isoformat(),
        operatorAcknowledgement="I_ACK_REAL_MONEY_LIVE_ACTIVATION",planSha256=plan,
        nonceDigest=hashlib.sha256(auth["nonce"].encode()).hexdigest())


def verify_result(result):
    digest = result.get("venueProofSha256")
    require(result.get("status") == "HYPE_SHA_OWNER_REVIEW_REPAIRED"
            and result.get("oldSha") == LEGACY and result.get("newSha") == CANDIDATE
            and type(result.get("reviewEvents")) is int and result["reviewEvents"] >= 10_000
            and type(result.get("signedVenueReads")) is int and result["signedVenueReads"] == 3
            and result.get("xrpProtectionVerified") is True
            and isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest)
            and all(type(result.get(k)) is int and result[k] == 0
                    for k in ("ordersSent", "cancelsSent", "positionChangesSent")), "EVIDENCE_MISMATCH")
    return digest
