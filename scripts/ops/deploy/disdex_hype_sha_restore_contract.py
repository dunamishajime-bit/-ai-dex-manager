"""Fixed scope shared by the HYPE root executor and SSH adapter."""
import hashlib
import re

REPOSITORY = "dunamishajime-bit/-ai-dex-manager"
HOST = "professional-dismanager.net"
OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS"
OWNER = "dunamishajime-bit"
RUNNER = "HYPE_TREND_LONG"
OPERATION = "HYPE_TREND_LONG_SHA_RESTORE"
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
