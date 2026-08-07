from __future__ import annotations

from typing import Dict, List, Tuple

import research_lab_v96_recent_regime_redesign as base

freq = base.freq
crypto_bt = base.crypto_bt


def add(target: Dict[Tuple, freq.CoreCandidate], candidate: freq.CoreCandidate) -> None:
    key = (
        round(candidate.vote_threshold, 6),
        round(candidate.volume_floor, 6),
        int(candidate.bear_confirm_bars),
        round(candidate.weight_tolerance, 6),
        round(candidate.turnover_threshold, 6),
        int(candidate.stale_bars),
    )
    target.setdefault(key, candidate)


def bounded_candidates() -> List[freq.CoreCandidate]:
    result: Dict[Tuple, freq.CoreCandidate] = {}
    add(result, crypto_bt.NEW)

    # One-factor diagnostics around production.
    for vote in (0.40, 0.45, 0.55):
        add(result, freq.CoreCandidate(f"VOTE_{int(vote*100)}", vote_threshold=vote, volume_floor=0.50, bear_confirm_bars=4, weight_tolerance=0.05, turnover_threshold=0.075, stale_bars=12))
    for volume in (0.40, 0.60, 0.70, 0.80):
        add(result, freq.CoreCandidate(f"VOL_{int(volume*100)}", vote_threshold=0.50, volume_floor=volume, bear_confirm_bars=4, weight_tolerance=0.05, turnover_threshold=0.075, stale_bars=12))
    for bear in (1, 2, 3):
        add(result, freq.CoreCandidate(f"BEAR_{bear}", vote_threshold=0.50, volume_floor=0.50, bear_confirm_bars=bear, weight_tolerance=0.05, turnover_threshold=0.075, stale_bars=12))

    stabilizers = (
        ("FASTEST", 0.01, 0.025, 4),
        ("FAST", 0.025, 0.05, 6),
        ("SMOOTH", 0.075, 0.15, 16),
    )
    for name, tolerance, turnover, stale in stabilizers:
        add(result, freq.CoreCandidate(f"STAB_{name}", vote_threshold=0.50, volume_floor=0.50, bear_confirm_bars=4, weight_tolerance=tolerance, turnover_threshold=turnover, stale_bars=stale))

    # Bounded recent-regime redesign: faster bear confirmation + faster target updates.
    # 18 combinations only; final 2026-03-11+ holdout remains untouched by ranking.
    for vote in (0.40, 0.45, 0.50):
        for volume in (0.40, 0.50, 0.60):
            for bear in (1, 2):
                add(
                    result,
                    freq.CoreCandidate(
                        f"RECENT_V{int(vote*100)}_VOL{int(volume*100)}_B{bear}_FAST",
                        vote_threshold=vote,
                        volume_floor=volume,
                        bear_confirm_bars=bear,
                        weight_tolerance=0.025,
                        turnover_threshold=0.05,
                        stale_bars=6,
                    ),
                )
    return list(result.values())


base.core_candidates = bounded_candidates

if __name__ == "__main__":
    base.main()
