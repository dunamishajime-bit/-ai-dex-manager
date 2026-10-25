#!/usr/bin/env python3
"""Pure research-only Gross source patch; NEVER an execution or order permit.

Does not import the Native8 chain, touch disk, install monkey patches, or
authenticate any upstream producer. External source identity and 13 GateProof
must be independently verified before any future integration.
"""
from __future__ import annotations

class ResearchPatchRejected(ValueError):
    """Fail-closed source-contract violation; not a trading authorization."""

OLD_REQUESTED = "                    requested = 1.0\n"
NEW_REQUESTED = "                    requested = (float(candidate['requested_gross']) if strategy=='IDLE' else 1.0)\n"
OLD_ROOM = "                    elif room + 1e-9 < 1.0:\n"
NEW_ROOM = "                    elif room + 1e-9 < (float(candidate['requested_gross']) if strategy=='IDLE' else 1.0):\n"

CONTRACT = (
    ("REJECT_FULL_GROSS_HOOK_NOT_UNIQUE", OLD_REQUESTED, NEW_REQUESTED),
    ("REJECT_ROOM_HOOK_NOT_UNIQUE", OLD_ROOM, NEW_ROOM),
)

def rewrite_gross_source_research_only(source: str) -> str:
    """Return rewritten source iff BOTH exact old hooks occur exactly once.

    All checks run before either replacement; no assert, import, exec, I/O,
    mutation of caller data, or side effects. Passing does not mean Native8
    ownership, allocation, inventory, or GateProof is certified.
    """
    if type(source) is not str:
        raise ResearchPatchRejected("REJECT_NON_STRING_SOURCE")
    for code, old, new in CONTRACT:
        count = source.count(old)
        if count != 1:
            raise ResearchPatchRejected(f"{code}:count={count}")
        if new in source:
            raise ResearchPatchRejected("REJECT_PREEXISTING_REWRITE")
    result = source
    for _, old, new in CONTRACT:
        result = result.replace(old, new, 1)
    if any(result.count(old) != 0 or result.count(new) != 1 for _, old, new in CONTRACT):
        raise ResearchPatchRejected("REJECT_POST_REWRITE_INVARIANT")
    return result
