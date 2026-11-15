"""Pure exact-source H48 certificate and phase-one inventory checks.

No activation, certificate issuance, file writes, environment overrides or venue
requests. The root transaction must supply externally approved source/plan IDs,
authenticate signed rows, hold the real account lease, verify service/PID/risk/HOLD
and obtain the independent immutable-source V4 journal replay. This module never
turns a boolean permission, order geometry, or a locally generated hash into proof.
"""
import copy
import hashlib
import json
import re
import stat
from disdex_v4_nonflat_ownership import attest_sole_v4_inventory

SCHEMA="disdex-stable4-h48-time-only-policy/v1"
RESEARCH_SHA="9e1142f5ec6d4bc285deef023572623bb1c37a34"
FIELDS={"schema","approvedSha","researchSha","planSha256","deploymentTarget","policy","route","symbol","side",
        "holdHours","entryGridHours","residentStopRequired","residentTakeProfitRequired","approvedGross",
        "issuedAt","expiresAt","operatorAcknowledgement","authorizesOtherPolicies"}
def _fail(reason):raise ValueError("STABLE4_H48_ROOT_"+reason)
def _sha(value,size):return isinstance(value,str) and re.fullmatch("[a-f0-9]{"+str(size)+"}",value) is not None
def _time(value):return type(value)is int and 0<value<=9007199254740991
def _canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode()

def validate_h48_certificate(value,*,approved_sha,approved_plan_sha256,now_ms):
    """The approved plan is supplied by the formal root approval path, never computed here."""
    if not _sha(approved_sha,40) or not _sha(approved_plan_sha256,64) or not _time(now_ms):_fail("APPROVED_BINDING_INVALID")
    if not isinstance(value,dict) or set(value)!=FIELDS:_fail("CERTIFICATE_FIELDS_INVALID")
    expected={"schema":SCHEMA,"approvedSha":approved_sha,"researchSha":RESEARCH_SHA,"planSha256":approved_plan_sha256,
              "deploymentTarget":"professional-dismanager.net","policy":"H48_TIME_ONLY",
              "route":"HYPE_REDESIGN_CAUSAL_H48R4_WSIG","symbol":"HYPEUSDT","side":"LONG",
              "operatorAcknowledgement":"H48_TIME_ONLY"}
    if any(value[k]!=v for k,v in expected.items()):_fail("CERTIFICATE_IDENTITY_INVALID")
    if type(value["holdHours"])is not int or value["holdHours"]!=48 or type(value["entryGridHours"])is not int or value["entryGridHours"]!=6:_fail("CERTIFICATE_TIME_POLICY_INVALID")
    if any(value[k]is not False for k in ("residentStopRequired","residentTakeProfitRequired","authorizesOtherPolicies")):_fail("CERTIFICATE_POLICY_SCOPE_INVALID")
    gross=value["approvedGross"]
    if not isinstance(gross,dict) or set(gross)!={"crypto","stock","total","hype"} or any(type(gross[k])not in(int,float) or gross[k]!=n for k,n in {"crypto":3,"stock":4,"total":4.25,"hype":1}.items()):_fail("CERTIFICATE_GROSS_INVALID")
    if not _time(value["issuedAt"]) or not _time(value["expiresAt"]) or not value["issuedAt"]<=now_ms<value["expiresAt"]:_fail("CERTIFICATE_CLOCK_INVALID")
    return copy.deepcopy(value)

def validate_h48_certificate_metadata(metadata):
    if metadata.st_uid!=0 or metadata.st_gid!=0 or not stat.S_ISREG(metadata.st_mode) or metadata.st_mode&0o222:_fail("CERTIFICATE_NOT_IMMUTABLE_ROOT_FILE")

def validate_hype_flat_with_v4_inventory(*,hype_state,hype_state_sha,v4_raw,v4_sha,replay_proof,positions,orders,signed_at,now_ms):
    """Phase-one ONLY: HYPE is flat; every nonflat position/order belongs to proven V4.

    Native H48 POSITION authorization is a separate exact-policy path. Never add
    a general no-STOP exemption here or treat this result as globally flat.
    """
    if not _time(now_ms) or not _time(signed_at) or not 0<=now_ms-signed_at<=30000:_fail("SIGNED_SNAPSHOT_STALE")
    if not _sha(hype_state_sha,40) or not _sha(v4_sha,40):_fail("OWNER_SOURCE_INVALID")
    h=hype_state
    if not isinstance(h,dict) or h.get("schema")!="disdex-hype-zec-long/v1" or h.get("runtimeCommitSha")!=hype_state_sha or h.get("mode")!="LIVE":_fail("HYPE_SOURCE_INVALID")
    if h.get("positions")not in(None,[]) or h.get("pending")is not None or h.get("manualReview")not in(None,False) or h.get("manualReviewReason")not in(None,"") or not isinstance(h.get("failures"),list):_fail("HYPE_NOT_DEFINITELY_FLAT")
    if not _time(h.get("updatedAt")) or h["updatedAt"]>now_ms:_fail("HYPE_STATE_CLOCK_INVALID")
    if not isinstance(v4_raw,bytes):_fail("V4_RAW_DOCUMENT_REQUIRED")
    try:document=json.loads(v4_raw)
    except (ValueError,UnicodeError):_fail("V4_DOCUMENT_INVALID")
    # Recompute full position/STOP identities and exact quantities. A generic
    # geometrically covering order or a foreign policy cannot satisfy this.
    computed=attest_sole_v4_inventory(document,v4_sha,positions,orders)
    p=replay_proof
    if not isinstance(p,dict) or p.get("verified")is not True or p.get("journalReplayVerified")is not True or p.get("rawDocumentSha256")!=hashlib.sha256(v4_raw).hexdigest() or any(p.get(k)!=computed[k] for k in ("releaseSha","revision","documentSha256","proofSha256")):_fail("V4_INDEPENDENT_REPLAY_BINDING_INVALID")
    matched=json.loads(computed["proofJson"])
    preserved={"v4Sha":v4_sha,"positions":matched["positions"],"bindings":matched["bindings"]}
    return {"schema":"disdex-stable4-hype-flat-v4-preserved/v1","hypeFlat":True,"v4OwnershipVerified":True,
            "hypeStateSha":hype_state_sha,"v4Sha":v4_sha,"positionSymbols":computed["positionSymbols"],
            "verifiedV4Legs":computed["verifiedLegs"],"verifiedV4StopOrders":computed["uniqueStopOrders"],
            "preservationSha256":hashlib.sha256(_canonical(preserved)).hexdigest(),"verifiedAt":signed_at,
            "ordersSent":0,"cancelsSent":0,"positionChangesSent":0}
