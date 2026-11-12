"""Exact owner-signed scope for current-flat HYPE SHA recovery."""
import hashlib, json, re
from datetime import datetime, timezone

REPOSITORY="dunamishajime-bit/-ai-dex-manager"
HOST="professional-dismanager.net"
OPERATOR_TARGET="DD1296_FINAL_ALLIN_10BPS"
OWNER="dunamishajime-bit"
RUNNER="HYPE_TREND_LONG"
OPERATION="HYPE_TREND_LONG_SHA_RESTORE"
V4_OPERATION="V4_HYPE_PEER_PIN_CONTINUITY"
V4_SCOPE="V12_V4"
LEGACY="d6bcc94512a6416189cd92d7203b9ac3b2c98e70"
CANDIDATE="a7eee1f91d86d51f2333da117243d044ae1332dc"
V4_SHA="3ad65403013b701db5d9e53e8814e6ab827a28e8"
PLAN=hashlib.sha256(
    f"HYPE_SHA_FLAT_RESTORE_V2\n{LEGACY}\n{CANDIDATE}\nV4_{V4_SHA}\nSIGNED_ASTER_FLAT_3X\n".encode("ascii")
).hexdigest()

def require(condition,reason):
    if not condition:
        raise ValueError("HYPE_SHA_RESTORE_"+reason)

def validate_args(argv):
    if argv==["--preflight-readonly"]:
        return None
    require(len(argv)==3 and argv[0]=="--run-id" and re.fullmatch(r"[0-9]{1,20}",argv[1]) is not None
            and argv[2]=="--read-approval-stdin","FORCED_COMMAND_REJECTED")
    return argv[1]

def proposed_pins(pins):
    require(pins.get(RUNNER)==LEGACY,"OLD_PIN_MISMATCH")
    require(pins.get(V4_SCOPE)==V4_SHA,"V4_PIN_MISMATCH")
    return {**pins,RUNNER:CANDIDATE}

def v4_continuity_plan(current,proposed,prior_hash):
    require(proposed==proposed_pins(current) and re.fullmatch(r"[0-9a-f]{64}",prior_hash)
            and all(re.fullmatch(r"[0-9a-f]{40}",sha) for sha in current.values())
            and current.get(V4_SCOPE)==V4_SHA,"V4_CONTINUITY_SCOPE")
    bound=dict(schema="disdex-v4-hype-peer-pin-continuity/v2",repository=REPOSITORY,
        deploymentTarget=HOST,operatorTarget=OPERATOR_TARGET,scope=V4_SCOPE,
        sourceSha=V4_SHA,ordersEnabled=True,previousRunnerShas=current,
        nextRunnerShas=proposed,previousApprovalSha256=prior_hash,hypePlanSha256=PLAN,
        evidenceContract="SIGNED_ASTER_FLAT_3X")
    return hashlib.sha256(json.dumps(bound,sort_keys=True,separators=(",",":")).encode()).hexdigest()

def build_v4_continuity_activation(auth,current,proposed,prior_hash,now):
    plan=v4_continuity_plan(current,proposed,prior_hash)
    require(auth.get("scope")==V4_SCOPE and auth.get("sourceSha")==V4_SHA
            and auth.get("planSha256")==plan and auth.get("ordersEnabled") is True
            and auth.get("route")=="GITHUB_ACTIONS" and auth.get("operator")==OWNER
            and type(auth.get("issuedAt")) is int and type(auth.get("expiresAt")) is int
            and auth["issuedAt"]<=now<auth["expiresAt"] and 1<=auth["expiresAt"]-auth["issuedAt"]<=300
            and re.fullmatch(r"[0-9a-f]{32}",auth.get("nonce","")),"V4_CONTINUITY_APPROVAL")
    return dict(schema="disdex-live-operator-activation/v1",repository=REPOSITORY,
        deploymentTarget=HOST,target=OPERATOR_TARGET,scope=V4_SCOPE,operation=V4_OPERATION,
        approvedSha=V4_SHA,approvedRunners=[V4_SCOPE],approvedShaByRunner=proposed,
        ordersEnabled=True,activationClass="FULL_LIVE",route="GITHUB_ACTIONS",
        authorizationMethod="OWNER_SIGNED_TOKEN",
        approvedAt=datetime.fromtimestamp(auth["issuedAt"],timezone.utc).isoformat(),
        operatorAcknowledgement="I_ACK_REAL_MONEY_LIVE_ACTIVATION",planSha256=plan,
        nonceDigest=hashlib.sha256(auth["nonce"].encode()).hexdigest())

def verify_result(result):
    proof=result.get("venueProofSha256")
    require(result.get("status")=="HYPE_SHA_FLAT_V2_REPAIRED"
            and result.get("oldSha")==LEGACY and result.get("newSha")==CANDIDATE
            and result.get("v4Sha")==V4_SHA
            and type(result.get("reviewEvents")) is int and result["reviewEvents"]>=1
            and type(result.get("journalCount")) is int and result["journalCount"]>=10000
            and result.get("signedVenueReads")==3 and result.get("accountFlatVerified") is True
            and isinstance(proof,str) and re.fullmatch(r"[0-9a-f]{64}",proof)
            and all(type(result.get(k)) is int and result[k]==0
                    for k in ("ordersSent","cancelsSent","positionChangesSent")),"EVIDENCE_MISMATCH")
    return proof
