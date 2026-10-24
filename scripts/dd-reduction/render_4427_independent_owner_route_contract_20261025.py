#!/usr/bin/env python3
"""RESEARCH ONLY: fail-closed owner/route preflight for RENDER #4427.

Pure model, NOT an allocator adapter and NOT a LIVE/Production registration.
No code here changes `_overlay_block`, authorizes an order, or adjusts limits.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from enum import Enum
from typing import Optional, Tuple


ROUTE = "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT"
OWNER = "IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH"
CAPITAL_OWNER = "IDLE"  # Existing IDLE capital bucket; no new capacity.
SYMBOL = "RENDERUSDT"
STRATEGY = "IDLE"
SIDE = "SHORT"


class Verdict(str, Enum):
    REJECT = "REJECT"
    NEED_NATIVE_ALLOCATOR = "NEED_NATIVE_ALLOCATOR"


@dataclass(frozen=True)
class Candidate:
    strategy_id: str
    route: str
    symbol: str
    side: str
    entry_ts_ms: int
    requested_gross: float
    owner_id: str
    capital_owner: str

    def key(self) -> str:
        payload = (self.strategy_id, self.route, self.symbol, self.side,
                   self.entry_ts_ms, self.owner_id, self.capital_owner)
        return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class GateProof:
    """PASS only if backed by a native, as-of artifact. Unknown -> fail closed."""
    passed: Optional[bool]
    source_sha256: Optional[str]
    asof_ts_ms: Optional[int]
    candidate_key: Optional[str]

    def valid(self, entry_ts_ms: int, candidate_key: str) -> bool:
        if self.passed is not True or not self.source_sha256 or len(self.source_sha256) != 64:
            return False
        try:
            int(self.source_sha256, 16)
        except ValueError:
            return False
        return (isinstance(self.asof_ts_ms, int) and self.asof_ts_ms <= entry_ts_ms
                and self.candidate_key == candidate_key)


@dataclass(frozen=True)
class Context:
    # Explicit native Owner/Route registration is mandatory; an in-memory
    # _overlay_block edit is NOT registration.
    registration: GateProof
    source_asof: GateProof
    shared_risk: GateProof
    gross: GateProof
    margin: GateProof
    kill_switch: GateProof
    account_lock: GateProof
    dedup: GateProof
    pending: GateProof
    cooldown: GateProof
    same_symbol_exclusivity: GateProof
    native_slots: GateProof
    # A candidate competing with the incumbent IDLE/core at this instant
    # must be resolved by the native priority/ownership selector, not a bypass.
    owner_priority: GateProof
    # Authoritative position inventory; None is NOT equivalent to empty.
    open_symbols: Optional[Tuple[str, ...]]
    # The authoritative cooldown timestamp; None means unverified.
    cooldown_until_ms: Optional[int]
    # Native pending inventory; None means unverified.
    pending_symbols: Optional[Tuple[str, ...]]


@dataclass(frozen=True)
class Decision:
    verdict: Verdict
    reasons: Tuple[str, ...]
    owner_id: str = OWNER
    capital_owner: str = CAPITAL_OWNER
    # Even an eligible candidate still needs native allocator's final decision.
    native_order_authorized: bool = False


REQUIRED_PROOFS = (
    "registration", "source_asof", "shared_risk", "gross", "margin",
    "kill_switch", "account_lock", "dedup", "pending", "cooldown",
    "same_symbol_exclusivity", "native_slots", "owner_priority",
)


def assess(candidate: Candidate, ctx: Context) -> Decision:
    """Preflight only. Does not mutate candidates, portfolio, or risk state."""
    reasons = []
    if (candidate.strategy_id, candidate.route, candidate.symbol, candidate.side,
            candidate.owner_id, candidate.capital_owner) != (
            STRATEGY, ROUTE, SYMBOL, SIDE, OWNER, CAPITAL_OWNER):
        reasons.append("ROUTE_OWNER_BINDING_MISMATCH")
    if not isinstance(candidate.entry_ts_ms, int) or candidate.entry_ts_ms <= 0:
        reasons.append("INVALID_ENTRY_TS")
    if not isinstance(candidate.requested_gross, (int, float)) or not (0 < candidate.requested_gross <= 0.25):
        reasons.append("INVALID_REQUESTED_GROSS")
    if ctx.open_symbols is None:
        reasons.append("POSITION_INVENTORY_MISSING")
    elif candidate.symbol in ctx.open_symbols:
        reasons.append("SAME_SYMBOL_POSITION_OPEN")
    if ctx.pending_symbols is None:
        reasons.append("PENDING_INVENTORY_MISSING")
    elif candidate.symbol in ctx.pending_symbols:
        reasons.append("SAME_SYMBOL_PENDING_ORDER")
    if ctx.cooldown_until_ms is None:
        reasons.append("COOLDOWN_UNVERIFIED")
    elif isinstance(candidate.entry_ts_ms, int) and candidate.entry_ts_ms < ctx.cooldown_until_ms:
        reasons.append("COOLDOWN_ACTIVE")
    for name in REQUIRED_PROOFS:
        proof = getattr(ctx, name)
        if not isinstance(proof, GateProof) or not proof.valid(candidate.entry_ts_ms, candidate.key()):
            reasons.append("NATIVE_PROOF_MISSING_OR_FAIL:" + name.upper())
    if reasons:
        return Decision(Verdict.REJECT, tuple(sorted(set(reasons))))
    return Decision(Verdict.NEED_NATIVE_ALLOCATOR, ("PREFLIGHT_ONLY_NATIVE_FINAL_ADMISSION_REQUIRED",))


def example_candidate(ts: int) -> Candidate:
    return Candidate(STRATEGY, ROUTE, SYMBOL, SIDE, ts, 0.25, OWNER, CAPITAL_OWNER)
