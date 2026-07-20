from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_v35_core_pengu_v46_gross2 as core

HOUR = core.HOUR
BUCKET = 12 * HOUR
DAY = core.DAY

V67_ASTER_TRADES = [{'entry_ts': 1756108800000,
  'add_ts': None,
  'exit_ts': 1756242000000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0318,
  'add_price': None,
  'exit_price': 0.0313,
  'base_pct': 0.372,
  'severe_pct': 0.33,
  'excluded_base_pct': 0.372,
  'excluded_severe_pct': 0.33,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1758524400000,
  'add_ts': None,
  'exit_ts': 1758614400000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0311,
  'add_price': None,
  'exit_price': 0.0302,
  'base_pct': 0.8763,
  'severe_pct': 0.8343,
  'excluded_base_pct': 0.8763,
  'excluded_severe_pct': 0.8343,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1759021200000,
  'add_ts': None,
  'exit_ts': 1759111200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0312,
  'add_price': None,
  'exit_price': 0.0304,
  'base_pct': 0.7123,
  'severe_pct': 0.6703,
  'excluded_base_pct': 0.7123,
  'excluded_severe_pct': 0.6703,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1759323600000,
  'add_ts': None,
  'exit_ts': 1759453200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0299,
  'add_price': None,
  'exit_price': 0.0307,
  'base_pct': -0.8836,
  'severe_pct': -0.9256,
  'excluded_base_pct': -0.8836,
  'excluded_severe_pct': -0.9256,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1759777200000,
  'add_ts': None,
  'exit_ts': 1759906800000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0281,
  'add_price': None,
  'exit_price': 0.0276,
  'base_pct': 0.4766,
  'severe_pct': 0.4346,
  'excluded_base_pct': 0.4766,
  'excluded_severe_pct': 0.4346,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1760112000000,
  'add_ts': 1760115600000,
  'exit_ts': 1760241600000,
  'side': -1,
  'mode': 'EXTREME_PROBE_ADD',
  'probe_gross': 0.1,
  'add_gross': 0.2,
  'total_gross': 0.3,
  'entry_price': 0.0269,
  'add_price': 0.0268,
  'exit_price': 0.0069,
  'base_pct': 21.4398,
  'severe_pct': 21.3978,
  'excluded_base_pct': 0.0,
  'excluded_severe_pct': 0.0,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1760454000000,
  'add_ts': None,
  'exit_ts': 1760583600000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0068,
  'add_price': None,
  'exit_price': 0.0064,
  'base_pct': 1.5469,
  'severe_pct': 1.5049,
  'excluded_base_pct': 1.5469,
  'excluded_severe_pct': 1.5049,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1760947200000,
  'add_ts': None,
  'exit_ts': 1761037200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.006,
  'add_price': None,
  'exit_price': 0.0056,
  'base_pct': 1.9661,
  'severe_pct': 1.9241,
  'excluded_base_pct': 1.9661,
  'excluded_severe_pct': 1.9241,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1761242400000,
  'add_ts': None,
  'exit_ts': 1761332400000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.1,
  'total_gross': 0.1,
  'entry_price': 0.0057,
  'add_price': None,
  'exit_price': 0.0055,
  'base_pct': 0.3506,
  'severe_pct': 0.3366,
  'excluded_base_pct': 0.3506,
  'excluded_severe_pct': 0.3366,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1761681600000,
  'add_ts': None,
  'exit_ts': 1761811200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0053,
  'add_price': None,
  'exit_price': 0.0054,
  'base_pct': -0.6333,
  'severe_pct': -0.6753,
  'excluded_base_pct': -0.6333,
  'excluded_severe_pct': -0.6753,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1762358400000,
  'add_ts': None,
  'exit_ts': 1762448400000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.005,
  'add_price': None,
  'exit_price': 0.0049,
  'base_pct': 0.6154,
  'severe_pct': 0.5734,
  'excluded_base_pct': 0.6154,
  'excluded_severe_pct': 0.5734,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1763474400000,
  'add_ts': None,
  'exit_ts': 1763564400000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0054,
  'add_price': None,
  'exit_price': 0.0056,
  'base_pct': -1.1511,
  'severe_pct': -1.1931,
  'excluded_base_pct': -1.1511,
  'excluded_severe_pct': -1.1931,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1764046800000,
  'add_ts': None,
  'exit_ts': 1764136800000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.1,
  'total_gross': 0.1,
  'entry_price': 0.0054,
  'add_price': None,
  'exit_price': 0.0052,
  'base_pct': 0.3514,
  'severe_pct': 0.3374,
  'excluded_base_pct': 0.3514,
  'excluded_severe_pct': 0.3374,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1764684000000,
  'add_ts': None,
  'exit_ts': 1764774000000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0053,
  'add_price': None,
  'exit_price': 0.0049,
  'base_pct': 2.4912,
  'severe_pct': 2.4492,
  'excluded_base_pct': 2.4912,
  'excluded_severe_pct': 2.4492,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1765933200000,
  'add_ts': None,
  'exit_ts': 1766023200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0048,
  'add_price': None,
  'exit_price': 0.0049,
  'base_pct': -0.6402,
  'severe_pct': -0.6822,
  'excluded_base_pct': -0.6402,
  'excluded_severe_pct': -0.6822,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1766710800000,
  'add_ts': None,
  'exit_ts': 1766800800000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0045,
  'add_price': None,
  'exit_price': 0.0044,
  'base_pct': 0.7373,
  'severe_pct': 0.6953,
  'excluded_base_pct': 0.7373,
  'excluded_severe_pct': 0.6953,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1767146400000,
  'add_ts': None,
  'exit_ts': 1767236400000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.1,
  'total_gross': 0.1,
  'entry_price': 0.0046,
  'add_price': None,
  'exit_price': 0.0045,
  'base_pct': 0.1761,
  'severe_pct': 0.1621,
  'excluded_base_pct': 0.1761,
  'excluded_severe_pct': 0.1621,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1767870000000,
  'add_ts': None,
  'exit_ts': 1768003200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0047,
  'add_price': None,
  'exit_price': 0.0048,
  'base_pct': -0.9775,
  'severe_pct': -1.0195,
  'excluded_base_pct': -0.9775,
  'excluded_severe_pct': -1.0195,
  'candidate_id': 'S_FLASH_LB6_T12_T35_CTX0_VOL0p8_VX1_DA1_CF0p4_CH2_WIDE_H36_STOP3p5_TS36_TR3p5'},
 {'entry_ts': 1768816800000,
  'add_ts': None,
  'exit_ts': 1768906800000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0042,
  'add_price': None,
  'exit_price': 0.0041,
  'base_pct': 0.9619,
  'severe_pct': 0.9199,
  'excluded_base_pct': 0.9619,
  'excluded_severe_pct': 0.9199,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1769389200000,
  'add_ts': None,
  'exit_ts': 1769479200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0041,
  'add_price': None,
  'exit_price': 0.004,
  'base_pct': 0.7234,
  'severe_pct': 0.6814,
  'excluded_base_pct': 0.7234,
  'excluded_severe_pct': 0.6814,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1770012000000,
  'add_ts': None,
  'exit_ts': 1770102000000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0042,
  'add_price': None,
  'exit_price': 0.004,
  'base_pct': 1.2248,
  'severe_pct': 1.1828,
  'excluded_base_pct': 1.2248,
  'excluded_severe_pct': 1.1828,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1771056000000,
  'add_ts': None,
  'exit_ts': 1771146000000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.004,
  'add_price': None,
  'exit_price': 0.0038,
  'base_pct': 1.3758,
  'severe_pct': 1.3338,
  'excluded_base_pct': 1.3758,
  'excluded_severe_pct': 1.3338,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1772845200000,
  'add_ts': None,
  'exit_ts': 1772935200000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0038,
  'add_price': None,
  'exit_price': 0.0037,
  'base_pct': 0.8902,
  'severe_pct': 0.8482,
  'excluded_base_pct': 0.8902,
  'excluded_severe_pct': 0.8482,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1773622800000,
  'add_ts': None,
  'exit_ts': 1773712800000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0039,
  'add_price': None,
  'exit_price': 0.0037,
  'base_pct': 1.3402,
  'severe_pct': 1.2982,
  'excluded_base_pct': 1.3402,
  'excluded_severe_pct': 1.2982,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1775775600000,
  'add_ts': None,
  'exit_ts': 1775865600000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0034,
  'add_price': None,
  'exit_price': 0.0033,
  'base_pct': 0.8905,
  'severe_pct': 0.8485,
  'excluded_base_pct': 0.8905,
  'excluded_severe_pct': 0.8485,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'},
 {'entry_ts': 1776812400000,
  'add_ts': None,
  'exit_ts': 1776902400000,
  'side': -1,
  'mode': 'ARMED_CONFIRMED_FULL',
  'probe_gross': 0.0,
  'add_gross': 0.3,
  'total_gross': 0.3,
  'entry_price': 0.0034,
  'add_price': None,
  'exit_price': 0.0033,
  'base_pct': 0.8741,
  'severe_pct': 0.8321,
  'excluded_base_pct': 0.8741,
  'excluded_severe_pct': 0.8321,
  'candidate_id': 'S_DISTRIBUTION_LB6_T11p4_T31_CTX1p5_VOL0p5_VX0p6_DA0p5_CF0p2_CH1_WIDE_H24_STOP2p5_TS24_TR3p5'}]


def bucket_ts(ts: int) -> int:
    return ts // BUCKET * BUCKET


def price_at_open(rows_by_ts: Dict[int, dict], ts: int, fallback: float) -> float:
    row = rows_by_ts.get(ts)
    return float(row["open"]) if row is not None else fallback


def trade_legs(trade: dict) -> List[tuple[float, float, int]]:
    if trade.get("add_ts") is not None:
        return [
            (float(trade["probe_gross"]), float(trade["entry_price"]), int(trade["entry_ts"])),
            (float(trade["add_gross"]), float(trade["add_price"]), int(trade["add_ts"])),
        ]
    return [(float(trade["total_gross"]), float(trade["entry_price"]), int(trade["entry_ts"]))]


def build_trade_bucket_path(rows: List[dict], trade: dict, target_field: str) -> Dict[int, float]:
    target = float(trade[target_field]) / 100.0
    original_field = "severe_pct" if "severe" in target_field else "base_pct"
    original = float(trade[original_field]) / 100.0
    if target == 0.0 and original > 0.0:
        return {}
    rows_by_ts = {int(row["ts"]): row for row in rows}
    increments: Dict[int, float] = {}
    gross_sum = 0.0
    for gross, entry_price, leg_start in trade_legs(trade):
        if gross <= 0:
            continue
        ts = leg_start
        current = entry_price
        while ts < int(trade["exit_ts"]):
            next_ts = min(ts + HOUR, int(trade["exit_ts"]))
            if next_ts >= int(trade["exit_ts"]):
                end_price = float(trade["exit_price"])
            else:
                end_price = price_at_open(rows_by_ts, next_ts, current)
            value = gross * int(trade["side"]) * (end_price - current) / entry_price
            increments[bucket_ts(ts)] = increments.get(bucket_ts(ts), 0.0) + value
            gross_sum += value
            current = end_price
            ts = next_ts
    residual = target - gross_sum
    final_bucket = bucket_ts(int(trade["exit_ts"]) - 1)
    increments[final_bucket] = increments.get(final_bucket, 0.0) + residual
    return increments


def v67_series(rows: List[dict], trades: List[dict]) -> Dict[int, dict]:
    result: Dict[int, dict] = {}
    exposure_hours: Dict[int, Dict[int, float]] = {}
    for trade in trades:
        paths = {
            "base": build_trade_bucket_path(rows, trade, "base_pct"),
            "severe": build_trade_bucket_path(rows, trade, "severe_pct"),
            "excludedBase": build_trade_bucket_path(rows, trade, "excluded_base_pct"),
            "excludedSevere": build_trade_bucket_path(rows, trade, "excluded_severe_pct"),
        }
        all_buckets = set().union(*(path.keys() for path in paths.values()))
        for bucket in all_buckets:
            item = result.setdefault(bucket, {
                "base": 0.0, "severe": 0.0,
                "excludedBase": 0.0, "excludedSevere": 0.0,
                "maxExposure": 0.0, "averageExposure": 0.0,
            })
            for key, path in paths.items():
                item[key] += path.get(bucket, 0.0)
        ts = int(trade["entry_ts"])
        while ts < int(trade["exit_ts"]):
            if trade.get("add_ts") is not None and ts < int(trade["add_ts"]):
                gross = float(trade["probe_gross"])
            else:
                gross = float(trade["total_gross"])
            bucket = bucket_ts(ts)
            slot = (ts - bucket) // HOUR
            exposure_hours.setdefault(bucket, {})
            exposure_hours[bucket][slot] = exposure_hours[bucket].get(slot, 0.0) + gross
            ts += HOUR
    for bucket, slots in exposure_hours.items():
        item = result.setdefault(bucket, {
            "base": 0.0, "severe": 0.0,
            "excludedBase": 0.0, "excludedSevere": 0.0,
            "maxExposure": 0.0, "averageExposure": 0.0,
        })
        values = [slots.get(index, 0.0) for index in range(12)]
        item["maxExposure"] = max(values, default=0.0)
        item["averageExposure"] = statistics.fmean(values) if values else 0.0
    return result


def combine(core_rows: List[dict], pengu: Dict[int, dict], field: str) -> List[dict]:
    result = []
    for row in core_rows:
        p = pengu.get(int(row["ts"]), {
            field: 0.0, "maxExposure": 0.0, "averageExposure": 0.0,
        })
        result.append({
            "ts": int(row["ts"]),
            "return": float(row["return"]) + float(p.get(field, 0.0)),
            "gross": float(row["gross"]) + float(p.get("averageExposure", 0.0)),
            "maxGross": float(row["gross"]) + float(p.get("maxExposure", 0.0)),
        })
    return result


def trade_metrics(trades: List[dict], field: str, start: int, end: int) -> dict:
    selected = [trade for trade in trades if start <= int(trade["entry_ts"]) < end]
    equity = peak = 1.0
    max_dd = 0.0
    positives = negatives = 0.0
    for trade in selected:
        value = float(trade[field]) / 100.0
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        if value > 0:
            positives += value
        elif value < 0:
            negatives += abs(value)
    return {
        "trades": len(selected),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": positives / negatives if negatives > 0 else 999.0 if positives > 0 else None,
        "winRatePct": sum(float(trade[field]) > 0 for trade in selected) / len(selected) * 100.0 if selected else None,
    }


def zero_trade(trade: dict) -> dict:
    item = deepcopy(trade)
    for field in ("base_pct", "severe_pct", "excluded_base_pct", "excluded_severe_pct"):
        item[field] = 0.0
    return item


def remove_best_trade(trades: List[dict]) -> tuple[List[dict], dict]:
    best = max(trades, key=lambda trade: float(trade["base_pct"]))
    return [zero_trade(trade) if int(trade["entry_ts"]) == int(best["entry_ts"]) else deepcopy(trade) for trade in trades], best


def remove_best_month(trades: List[dict]) -> tuple[List[dict], str]:
    months: Dict[str, List[dict]] = {}
    for trade in trades:
        month = dt.datetime.fromtimestamp(int(trade["entry_ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        months.setdefault(month, []).append(trade)
    def month_return(month: str) -> float:
        equity = 1.0
        for trade in months[month]:
            equity *= 1.0 + float(trade["base_pct"]) / 100.0
        return equity - 1.0
    best_month = max(months, key=month_return)
    result = []
    for trade in trades:
        month = dt.datetime.fromtimestamp(int(trade["entry_ts"]) / 1000, tz=dt.timezone.utc).strftime("%Y-%m")
        result.append(zero_trade(trade) if month == best_month else deepcopy(trade))
    return result, best_month


def metrics_observed(rows: List[dict], start: int, end: int) -> dict:
    return core.metrics_with_observed_gross(rows, start, end)


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()


def rounded(value):
    return core.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    core.v4.load_symbol = core.load_aster_symbol
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: core.v4.load_symbol(cache_root, symbol) for symbol in core.v4.SYMBOLS}
    bars = {symbol: core.v4.resample_12h(raw[symbol]["candles"]) for symbol in core.v4.SYMBOLS}
    indexes = {
        symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)}
        for symbol, rows in bars.items()
    }
    core_funding = core.v6.funding_buckets({symbol: raw[symbol]["funding"] for symbol in core.v4.SYMBOLS})
    times = [int(row["ts"]) for row in bars["BTC"] if core.CORE_START <= int(row["ts"]) < core.CORE_END]
    projected = core.v6.precompute_projected_members(core.v20.COMPONENTS, times, bars, indexes)
    base_map = {
        ts: core.v4.overlay_target(core.v20.OVERLAY, ts, projected[ts], bars, indexes)
        for ts in times
    }
    bear_map = core.v6.precompute_bear_targets([core.v20.HEDGE], times, bars, indexes)[core.v20.HEDGE.hedge_id]
    targets = core.v28.combo_targets("VWM25_SKEW125", base_map, bear_map, times, bars, indexes, core_funding)
    base_core = core.v32.core_series(targets, times, bars, indexes, core_funding, 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, bars, indexes, core_funding, 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, bars, indexes, core_funding)
    config = core.CoreConfig()
    base_core_rows = core.core_rows(config, times, base_core, features)
    severe_core_rows = core.core_rows(config, times, severe_core, features)

    trade_start = min(int(trade["entry_ts"]) for trade in V67_ASTER_TRADES)
    trade_end = max(int(trade["exit_ts"]) for trade in V67_ASTER_TRADES)
    fetch_start = trade_start - 30 * DAY
    fetch_end = trade_end + HOUR
    pengu_rows = core.fetch_klines("PENGUUSDT", fetch_start, fetch_end)

    series = v67_series(pengu_rows, V67_ASTER_TRADES)
    combined = combine(base_core_rows, series, "base")
    combined_severe = combine(severe_core_rows, series, "severe")
    combined_excluded = combine(base_core_rows, series, "excludedBase")
    combined_excluded_severe = combine(severe_core_rows, series, "excludedSevere")

    without_best, best_trade = remove_best_trade(V67_ASTER_TRADES)
    without_best_series = v67_series(pengu_rows, without_best)
    combined_without_best = combine(base_core_rows, without_best_series, "base")
    combined_without_best_severe = combine(severe_core_rows, without_best_series, "severe")

    without_month, best_month = remove_best_month(V67_ASTER_TRADES)
    without_month_series = v67_series(pengu_rows, without_month)
    combined_without_month = combine(base_core_rows, without_month_series, "base")
    combined_without_month_severe = combine(severe_core_rows, without_month_series, "severe")

    overlap_start = max(core.CORE_START, trade_start)
    overlap_end = min(core.CORE_END, trade_end + HOUR)
    core_full = metrics_observed(base_core_rows, core.CORE_START, core.CORE_END)
    core_severe_full = metrics_observed(severe_core_rows, core.CORE_START, core.CORE_END)
    core_overlap = metrics_observed(base_core_rows, overlap_start, overlap_end)
    core_overlap_severe = metrics_observed(severe_core_rows, overlap_start, overlap_end)
    combined_full = metrics_observed(combined, core.CORE_START, core.CORE_END)
    combined_severe_full = metrics_observed(combined_severe, core.CORE_START, core.CORE_END)
    excluded_full = metrics_observed(combined_excluded, core.CORE_START, core.CORE_END)
    excluded_severe_full = metrics_observed(combined_excluded_severe, core.CORE_START, core.CORE_END)
    combined_overlap = metrics_observed(combined, overlap_start, overlap_end)
    combined_overlap_severe = metrics_observed(combined_severe, overlap_start, overlap_end)
    excluded_overlap = metrics_observed(combined_excluded, overlap_start, overlap_end)
    excluded_overlap_severe = metrics_observed(combined_excluded_severe, overlap_start, overlap_end)

    result = rounded({
        "version": 68,
        "strategyId": "V35_CORE_PLUS_PENGU_V67_SAME_TIMELINE",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "COMBINED_BACKTEST_COMPLETE",
        "period": {
            "coreStart": iso(core.CORE_START),
            "coreEnd": iso(core.CORE_END),
            "v67FirstEntry": iso(trade_start),
            "v67LastExit": iso(trade_end),
            "overlapStart": iso(overlap_start),
            "overlapEnd": iso(overlap_end),
        },
        "assumptions": {
            "core": asdict(config),
            "v67Source": "Aster V67 DISTRIBUTION_FLOOR_FULL_PASS Artifact",
            "v67TradeCount": len(V67_ASTER_TRADES),
            "v67MaxGross": 0.30,
            "totalGrossCapApplied": False,
            "theoreticalMaxGross": config.gross_cap + 0.30,
            "hourlyMarkToMarket": True,
            "bucketHours": 12,
            "largeWaveExcludedMethod": "V67 profitable same-direction major-wave trades are zeroed; Core is unchanged.",
        },
        "core": {
            "full": core_full,
            "severeFull": core_severe_full,
            "overlap": core_overlap,
            "overlapSevere": core_overlap_severe,
        },
        "v67": {
            "full": trade_metrics(V67_ASTER_TRADES, "base_pct", trade_start, trade_end + HOUR),
            "severeFull": trade_metrics(V67_ASTER_TRADES, "severe_pct", trade_start, trade_end + HOUR),
            "largeWaveExcluded": trade_metrics(V67_ASTER_TRADES, "excluded_base_pct", trade_start, trade_end + HOUR),
            "largeWaveExcludedSevere": trade_metrics(V67_ASTER_TRADES, "excluded_severe_pct", trade_start, trade_end + HOUR),
        },
        "combined": {
            "fullCorePeriod": combined_full,
            "severeFullCorePeriod": combined_severe_full,
            "largeWaveExcludedFull": excluded_full,
            "largeWaveExcludedSevereFull": excluded_severe_full,
            "overlap": combined_overlap,
            "overlapSevere": combined_overlap_severe,
            "largeWaveExcludedOverlap": excluded_overlap,
            "largeWaveExcludedOverlapSevere": excluded_overlap_severe,
            "incrementVsCoreFullPctPoints": combined_full["compoundedReturnPct"] - core_full["compoundedReturnPct"],
            "incrementVsCoreOverlapPctPoints": combined_overlap["compoundedReturnPct"] - core_overlap["compoundedReturnPct"],
            "largeWaveContributionFullPctPoints": combined_full["compoundedReturnPct"] - excluded_full["compoundedReturnPct"],
            "observedMaxConcurrentGross": combined_full["observedMaxConcurrentGross"],
        },
        "concentrationStress": {
            "removedBestV67Trade": {
                "entryTs": best_trade["entry_ts"],
                "entryIso": iso(int(best_trade["entry_ts"])),
                "tradeBasePct": best_trade["base_pct"],
                "combinedFull": metrics_observed(combined_without_best, core.CORE_START, core.CORE_END),
                "combinedSevereFull": metrics_observed(combined_without_best_severe, core.CORE_START, core.CORE_END),
            },
            "removedBestV67Month": {
                "month": best_month,
                "combinedFull": metrics_observed(combined_without_month, core.CORE_START, core.CORE_END),
                "combinedSevereFull": metrics_observed(combined_without_month_severe, core.CORE_START, core.CORE_END),
            },
        },
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
        },
        "limitations": [
            "V67 Aster evidence overlaps its research period and is not pristine forward evidence.",
            "V67 PnL is marked hourly from entry legs to exact exit price; funding and execution-cost residuals are applied in the exit bucket.",
            "No portfolio-level gross cap is applied; observed and theoretical concurrent gross are reported.",
        ],
    })

    c = result["combined"]
    report = [
        "# V35 Core + PENGU V67 Same-timeline Backtest",
        "",
        f"- Status: **{result['status']}**",
        f"- Core full: {core_full['compoundedReturnPct']}% / CAGR {core_full['cagrPct']}% / DD {core_full['maxDrawdownPct']}%",
        f"- Core + V67 full: {combined_full['compoundedReturnPct']}% / CAGR {combined_full['cagrPct']}% / DD {combined_full['maxDrawdownPct']}%",
        f"- Core + V67 Severe: {combined_severe_full['compoundedReturnPct']}% / DD {combined_severe_full['maxDrawdownPct']}%",
        f"- Core + V67, large-wave profits excluded: {excluded_full['compoundedReturnPct']}% / DD {excluded_full['maxDrawdownPct']}%",
        f"- Core + V67, excluded Severe: {excluded_severe_full['compoundedReturnPct']}%",
        f"- Increment vs Core full: {c['incrementVsCoreFullPctPoints']} percentage points",
        f"- V67 large-wave contribution: {c['largeWaveContributionFullPctPoints']} percentage points",
        f"- Observed max concurrent Gross: {c['observedMaxConcurrentGross']}",
        "",
        f"- Overlap Core: {core_overlap['compoundedReturnPct']}% / DD {core_overlap['maxDrawdownPct']}%",
        f"- Overlap Core + V67: {combined_overlap['compoundedReturnPct']}% / DD {combined_overlap['maxDrawdownPct']}%",
        f"- Overlap excluded: {excluded_overlap['compoundedReturnPct']}% / DD {excluded_overlap['maxDrawdownPct']}%",
        "",
        f"- Remove best V67 trade: {result['concentrationStress']['removedBestV67Trade']['combinedFull']['compoundedReturnPct']}%",
        f"- Remove best V67 month ({best_month}): {result['concentrationStress']['removedBestV67Month']['combinedFull']['compoundedReturnPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "v35-core-pengu-v67-combined.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "v35-core-pengu-v67-combined.md").write_text(
        "\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
