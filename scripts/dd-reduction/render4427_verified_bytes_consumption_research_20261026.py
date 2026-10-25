#!/usr/bin/env python3
"""Research-only immutable byte-consumption boundary; never executes source.

The existing signed-composed verifier attests a digest but does not return the
verified bytes. A caller that later re-reads a mutable path can consume other
bytes. This adapter carries the exact verified transformed bytes forward.
This does NOT prove an operator trust root, freeze imports, or wire Native8.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from hashlib import sha256
from typing import Any

from render4427_signed_composed_patch_research_20261026 import (
    verify_signed_composed_plan_research_only,
    ComposedPlanRejected,
)


def digest(blob: bytes) -> str:
    return sha256(blob).hexdigest()


@dataclass(frozen=True, slots=True)
class VerifiedResearchBytes:
    payload: bytes
    input_sha256: str
    final_sha256: str
    stages_verified: int
    order_authorized: bool = False
    native_allocator_authorized: bool = False


def bind_verified_bytes_research_only(
    *, manifest_bytes: bytes, signature_b64: str, public_key_raw: bytes,
    independent_public_key_sha256: str, independent_final_sha256: str,
    source_bytes: bytes, expected_subject: str,
) -> VerifiedResearchBytes:
    """Return exact signed-and-pinned output bytes, not just a hash.

    Never opens paths or imports/executes target code. The caller must consume
    `payload` itself; a later path re-read is outside this boundary.
    """
    evidence = verify_signed_composed_plan_research_only(
        manifest_bytes=manifest_bytes, signature_b64=signature_b64,
        public_key_raw=public_key_raw,
        independent_public_key_sha256=independent_public_key_sha256,
        independent_final_sha256=independent_final_sha256,
        source_bytes=source_bytes, expected_subject=expected_subject,
    )
    plan: dict[str, Any] = json.loads(manifest_bytes.decode("utf-8"))
    current = source_bytes
    for index, step in enumerate(plan["steps"]):
        text = current.decode("utf-8")
        if text.count(step["old"]) != 1 or step["new"] in text:
            raise ComposedPlanRejected("REJECT_SNAPSHOT_STAGE_DRIFT:" + str(index))
        current = text.replace(step["old"], step["new"], 1).encode("utf-8")
        if digest(current) != step["stage_sha256"]:
            raise ComposedPlanRejected("REJECT_SNAPSHOT_STAGE_SHA_DRIFT:" + str(index))
    final_sha = digest(current)
    if (final_sha != evidence["final_source_sha256"]
            or final_sha != independent_final_sha256
            or final_sha != plan["final_sha256"]):
        raise ComposedPlanRejected("REJECT_SNAPSHOT_FINAL_DRIFT")
    return VerifiedResearchBytes(
        payload=current, input_sha256=digest(source_bytes),
        final_sha256=final_sha, stages_verified=len(plan["steps"]),
    )
