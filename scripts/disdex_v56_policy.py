"""Frozen V56 production sizing and risk policy.

This module is intentionally side-effect free.  The LIVE runners import it for
the same deterministic sizing decisions that the offline safety tests exercise.
Signal predicates and market-data gates remain in their existing engines.
"""

from __future__ import annotations

from typing import Optional

EPSILON = 1e-12

PENGU_BASE_GROSS = 0.75
PENGU_LONG_MULTIPLIER = 1.25
PENGU_SHORT_MULTIPLIER = 1.00
PENGU_LONG_MAX_REQUESTED_GROSS = PENGU_BASE_GROSS * PENGU_LONG_MULTIPLIER
PENGU_SHORT_MAX_REQUESTED_GROSS = PENGU_BASE_GROSS * PENGU_SHORT_MULTIPLIER

V50_RANK1_NORMAL_GROSS = 1.00
V50_RANK1_STRONG_GROSS = 1.25
V50_RANK2_GROSS = 0.25
V50_RANK1_MIN_BASIS_BPS = 65.0
V50_RANK1_MIN_NET_EDGE_BPS = 5.0
V50_RANK1_STRONG_BASIS_BPS = 100.0
V50_RANK1_STRONG_NET_EDGE_BPS = 15.0
V50_RANK2_MIN_BASIS_BPS = 85.0
V50_RANK2_MIN_NET_EDGE_BPS = 10.0
V50_MAX_HOLDING_HOURS = 4
V50_BASIS_STOP_MULTIPLE = 1.75
V50_MAX_ADVERSE_BASIS_MOVE_BPS = 10.0
V50_MAX_CONCURRENT_POSITIONS = 2
V50_MAX_DAILY_ENTRIES = 3

V11_DEFAULT_GROSS = 0.75
V11_TIER2_GROSS = 1.00
V11_TIER3_GROSS = 1.25
V11_TIER4_GROSS = 1.50


def _abs(value: float) -> float:
    return abs(float(value))


def pengu_max_requested_gross(side: int) -> float:
    """Return the fixed maximum requested Gross for a PENGU side."""
    return PENGU_LONG_MAX_REQUESTED_GROSS if int(side) > 0 else PENGU_SHORT_MAX_REQUESTED_GROSS


def v50_requested_gross(rank: int, basis_bps: float, net_edge_bps: float) -> Optional[float]:
    """Return the V50 requested Gross, or None when that rank is rejected."""
    basis = _abs(basis_bps)
    edge = _abs(net_edge_bps)
    if int(rank) == 1:
        if basis + EPSILON >= V50_RANK1_STRONG_BASIS_BPS and edge + EPSILON >= V50_RANK1_STRONG_NET_EDGE_BPS:
            return V50_RANK1_STRONG_GROSS
        if basis + EPSILON >= V50_RANK1_MIN_BASIS_BPS and edge + EPSILON >= V50_RANK1_MIN_NET_EDGE_BPS:
            return V50_RANK1_NORMAL_GROSS
        return None
    if int(rank) == 2 and basis + EPSILON >= V50_RANK2_MIN_BASIS_BPS and edge + EPSILON >= V50_RANK2_MIN_NET_EDGE_BPS:
        return V50_RANK2_GROSS
    return None


def v11_requested_gross(basis_bps: float, net_edge_bps: float) -> float:
    """Return the frozen V11 quality-tier Gross without changing its signal."""
    basis = _abs(basis_bps)
    edge = _abs(net_edge_bps)
    if basis + EPSILON >= 140.0 and edge + EPSILON >= 30.0:
        return V11_TIER4_GROSS
    if basis + EPSILON >= 110.0 and edge + EPSILON >= 20.0:
        return V11_TIER3_GROSS
    if basis + EPSILON >= 80.0 and edge + EPSILON >= 10.0:
        return V11_TIER2_GROSS
    return V11_DEFAULT_GROSS
