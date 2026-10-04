#!/usr/bin/env python3
"""Optimized runner for trading_committee_basis without changing its economics."""
from __future__ import annotations

import numpy as np
import pandas as pd

from research import trading_committee_basis as base


def reduced_candidates() -> list[base.Candidate]:
    out = []
    for family in ["mean_reversion", "carry_confirmed", "turn_confirmed", "funding_carry"]:
        for lookback in [7, 14, 30]:
            for entry in [1.5, 2.25, 3.0]:
                for exit_z in [0.35]:
                    for hold in [4, 8, 16]:
                        out.append(base.Candidate(family, lookback, entry, exit_z, hold))
    return out


def aligned_build_positions(
    prepared: dict[str, pd.DataFrame], candidate: base.Candidate
) -> tuple[pd.DataFrame, list[dict]]:
    common = sorted(set.intersection(*(set(frame.index) for frame in prepared.values())))
    index = pd.DatetimeIndex(common)
    aligned = {symbol: frame.reindex(index) for symbol, frame in prepared.items()}
    positions = pd.DataFrame(0.0, index=index, columns=sorted(prepared))
    gates = {
        symbol: base.liquidity_gate(frame, symbol)
        for symbol, frame in aligned.items()
    }
    trades: list[dict] = []
    hold_bars = candidate.max_hold_hours * 4
    i = 0
    while i < len(index) - hold_bars - 3:
        opportunities = []
        for symbol, frame in aligned.items():
            score = float(frame["score"].iat[i])
            if gates[symbol].iat[i] and abs(score) >= candidate.entry_z:
                opportunities.append((abs(score), symbol, score))
        if not opportunities:
            i += 1
            continue
        _, symbol, score = max(opportunities)
        frame = aligned[symbol]
        entry = i + 1
        if not gates[symbol].iat[entry]:
            i += 1
            continue
        direction = 1.0 if score > 0 else -1.0
        z_entry = float(frame["premium_z"].iat[i])
        exit_index = min(entry + hold_bars, len(index) - 2)
        reason = "time"
        for j in range(entry + 1, exit_index + 1):
            raw_z = frame["premium_z"].iat[j]
            z_now = float(raw_z) if pd.notna(raw_z) else z_entry
            movement = direction * (z_now - z_entry)
            if candidate.family != "funding_carry" and abs(z_now) <= candidate.exit_z:
                exit_index, reason = j, "convergence"
                break
            if movement <= -1.25:
                exit_index, reason = j, "spread_stop"
                break
            score_now = float(frame["score"].iat[j])
            if np.sign(score_now) == -direction and abs(score_now) >= 0.50:
                exit_index, reason = j, "signal_flip"
                break
        holding_gate = gates[symbol].iloc[entry:exit_index + 1]
        minimum_ratio = 0.90 if symbol == "PENGUUSDT" else 0.50
        if len(holding_gate) == 0 or float(holding_gate.mean()) < minimum_ratio:
            i += 1
            continue
        positions.loc[index[entry:exit_index], symbol] = 0.5 * direction
        trades.append({
            "candidate": candidate.name,
            "symbol": symbol,
            "signal_time": index[i],
            "entry_time": index[entry],
            "exit_time": index[exit_index],
            "direction_aster": direction,
            "entry_score": score,
            "entry_premium_z": z_entry,
            "exit_reason": reason,
        })
        i = exit_index + 1
    return positions, trades


base.candidates = reduced_candidates
base.build_positions = aligned_build_positions

if __name__ == "__main__":
    base.main()
