"""Provenance-aware NORMAL/SEVERE execution input selection."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Literal, Sequence


ScenarioName = Literal["NORMAL", "SEVERE"]
CoveragePath = Literal["PROXY_APPLIED", "ASTER_DATA_ONLY"]


@dataclass(frozen=True, slots=True)
class ExecutionSample:
    venue: str
    source: str
    instrument_id: str
    timestamp_ms: int
    spread_bps: float
    impact_bps: float
    position_adverse_funding_bps: float
    snapshot_verified: bool
    sequence_verified: bool
    instrument_verified: bool
    same_time: bool = True
    aster_reference_basis_bps: float | None = None

    @property
    def verified(self) -> bool:
        return bool(
            self.snapshot_verified and self.sequence_verified and self.instrument_verified
            and self.same_time and self.timestamp_ms > 0
            and self.spread_bps >= 0 and self.impact_bps >= 0
        )

    @property
    def execution_cost_bps(self) -> float:
        return self.spread_bps / 2 + self.impact_bps


@dataclass(frozen=True, slots=True)
class ScenarioSelection:
    status: str
    reason: str
    sample: ExecutionSample | None
    reference_source: str | None
    execution_cost_source: str | None
    funding_source: str | None
    execution_cost_bps: float | None
    adverse_funding_bps: float | None
    valid_venues: tuple[str, ...]
    cross_venue_stress_available: bool
    proxy: bool


def select_execution_conditions(
    samples: Sequence[ExecutionSample],
    *,
    scenario: ScenarioName,
    coverage_path: CoveragePath,
    decision_time_ms: int,
    aster_data_available: bool,
    initial_gap: bool,
) -> ScenarioSelection:
    if scenario not in {"NORMAL", "SEVERE"} or coverage_path not in {"PROXY_APPLIED", "ASTER_DATA_ONLY"}:
        raise ValueError("unsupported scenario combination")
    valid = [sample for sample in samples if sample.verified and sample.timestamp_ms <= decision_time_ms]
    aster = [sample for sample in valid if sample.venue.upper() == "ASTER"]
    proxies = [sample for sample in valid if sample.venue.upper() != "ASTER"]
    if coverage_path == "ASTER_DATA_ONLY" and initial_gap and not aster_data_available:
        return ScenarioSelection("SKIPPED", "ASTER_L2_OR_FUNDING_UNAVAILABLE_IN_INITIAL_GAP", None,
                                 None, None, None, None, None, tuple(sorted(s.venue for s in valid)), False, False)
    if initial_gap:
        valid = proxies if coverage_path == "PROXY_APPLIED" else aster
    elif scenario == "NORMAL":
        valid = aster if aster_data_available and aster else proxies
    else:
        valid = (aster if aster_data_available else []) + proxies
    if not valid:
        return ScenarioSelection("NOT_VERIFIABLE", "NO_VALID_SAME_TIME_ORDERBOOK_AND_FUNDING", None,
                                 None, None, None, None, None, (), False, coverage_path == "PROXY_APPLIED" and initial_gap)

    costs = [sample.execution_cost_bps for sample in valid]
    funding = [sample.position_adverse_funding_bps for sample in valid]
    if scenario == "NORMAL":
        target_cost = float(median(costs))
        target_funding = float(median(funding))
        cost_source = "MEDIAN[" + ",".join(sorted({sample.source for sample in valid})) + "]"
        funding_source = cost_source
    else:
        target_cost = max(costs)
        target_funding = max(funding)
        cost_source = max(valid, key=lambda sample: (sample.execution_cost_bps, sample.venue)).source
        funding_source = max(valid, key=lambda sample: (sample.position_adverse_funding_bps, sample.venue)).source
    chosen = min(valid, key=lambda sample: (
        abs(sample.execution_cost_bps - target_cost) + abs(sample.position_adverse_funding_bps - target_funding),
        sample.venue,
    ))
    cross_venue = len({sample.venue for sample in valid}) > 1
    return ScenarioSelection(
        "VERIFIED_PROXY_RESEARCH" if chosen.venue.upper() != "ASTER" else "VERIFIED_ASTER",
        "MEDIAN_VALID_SAME_TIME_INPUTS" if scenario == "NORMAL" else "LEAST_FAVORABLE_VALID_INPUTS",
        chosen, chosen.source, cost_source, funding_source, target_cost, target_funding,
        tuple(sorted({sample.venue for sample in valid})), cross_venue,
        chosen.venue.upper() != "ASTER",
    )
