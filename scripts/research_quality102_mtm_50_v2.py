from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

import research_quality102_mtm_50 as legacy

_LEGACY_PATCH_MTM_ENGINE = legacy.patch_mtm_engine
EVIDENCE_PATH = Path(__file__).resolve().parents[1] / 'research' / 'quality102_mtm_entry_evidence.csv'


def _load_frozen_entry_evidence() -> dict[tuple[str, int], tuple[int, float]]:
    out: dict[tuple[str, int], tuple[int, float]] = {}
    with EVIDENCE_PATH.open(newline='', encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            key = (str(row['symbol']), int(row['entry_ts_ms']))
            value = (int(row['side']), float(row['entry_price']))
            if key in out:
                raise RuntimeError(f'duplicate Quality102 MTM evidence: {key}')
            if value[0] not in (-1, 1) or value[1] <= 0:
                raise RuntimeError(f'invalid Quality102 MTM evidence: {key}={value}')
            out[key] = value
    if len(out) != 102:
        raise RuntimeError(f'expected 102 Quality102 MTM evidence rows, found {len(out)}')
    return out


FROZEN_ENTRY_EVIDENCE = _load_frozen_entry_evidence()


def partial_net_return(**kwargs):
    return legacy.partial_net_return(**kwargs)


def remaining_limit(**kwargs):
    return legacy.remaining_limit(**kwargs)


def solve_remaining_notional(**kwargs):
    return legacy.solve_remaining_notional(**kwargs)


def patch_mtm_engine(source: str) -> str:
    patched = _LEGACY_PATCH_MTM_ENGINE(source)

    side_map = {entry_ts: side for (_symbol, entry_ts), (side, _price) in FROZEN_ENTRY_EVIDENCE.items()}
    constants = (
        f'QUALITY102_RESIZE_SIDES = {side_map!r}\n'
        f'QUALITY102_FROZEN_ENTRY_EVIDENCE = {FROZEN_ENTRY_EVIDENCE!r}\n'
        '_QUALITY102_KLINE_CACHE = {}\n'
    )
    patched, count = re.subn(
        r'QUALITY102_RESIZE_SIDES = \{.*?_QUALITY102_KLINE_CACHE = \{\}\n',
        constants,
        patched,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError('failed to replace limited Quality102 MTM evidence constants')

    generic_source_evidence = r'''def quality102_source_evidence(position: dict, entry_price: float) -> dict:
    symbol = str(position.get("symbol"))
    entry_ts = int(position.get("entryTs"))
    key = (symbol, entry_ts)
    expected = QUALITY102_FROZEN_ENTRY_EVIDENCE.get(key)
    if expected is None:
        raise RuntimeError(f"unapproved Quality102 MTM entry: {key}")
    expected_side, expected_price = int(expected[0]), float(expected[1])
    side = int(position.get("side", 0))
    if side != expected_side:
        raise RuntimeError(f"Quality102 MTM side mismatch {key}: side={side} expected={expected_side}")
    tol = max(1e-10, abs(expected_price) * 1e-8)
    error = abs(entry_price - expected_price)
    if error > tol:
        raise RuntimeError(f"Quality102 frozen entry-source mismatch {key}: binance1m={entry_price} frozen1h={expected_price} error={error} tol={tol}")
    return {
        "entryPrice": entry_price,
        "entrySource": "BINANCE_VISION_USDM_1M_OPEN",
        "entrySourceCrossCheck": {
            "kind": "FROZEN_RESEARCH_1H_OPEN",
            "expected": expected_price,
            "absError": error,
            "side": expected_side,
        },
    }
'''
    patched, count = re.subn(
        r'def quality102_source_evidence\(position: dict, entry_price: float\) -> dict:\n.*?(?=\ndef finite\()',
        generic_source_evidence,
        patched,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError('failed to replace Quality102 MTM source-evidence validator')

    corrected_observe = r'''    def observe_entry(entered_kind: str, ts: int) -> None:
        # QUALITY102_MTM_PRE_ADMISSION_REBASE
        # Base firing has already been admitted by the unchanged router. If Q102 must
        # be reduced, jointly solve its remaining notional and the just-entered Base
        # allocation against post-MTM equity, then commit both exactly once.
        nonlocal equity, twr_index, twr_peak, max_drawdown, max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross, max_entry_supp_gross
        if entered_kind != "SUPP_ENTRY" and active_supp is not None:
            old_notional = finite(active_supp.get("entryNotional"))
            if old_notional > 1e-9:
                entry_ts = int(active_supp.get("entryTs"))
                side = int(active_supp.get("side", 0))
                expected_side = QUALITY102_RESIZE_SIDES.get(entry_ts)
                if expected_side is None or side != expected_side:
                    raise RuntimeError(f"Quality102 MTM side evidence missing/mismatch entryTs={entry_ts} side={side} expected={expected_side}")
                entry_price = quality102_binance_vision_1m_open(str(active_supp.get("symbol")), entry_ts)
                evidence = quality102_source_evidence(active_supp, entry_price)
                mark_price = quality102_binance_vision_1m_open(str(active_supp.get("symbol")), ts)
                elapsed_hours = max(0.0, (ts - entry_ts) / 3600000.0)
                mark_return = quality102_partial_net_return(side, entry_price, mark_price, elapsed_hours, finite(active_supp.get("feePerSide")), finite(active_supp.get("fundingPerDay")))

                new_position = None
                scale_stat = None
                v12_other = sum(finite(p.get("entryNotional")) for p in active_v12.values())
                pengu_other = finite(active_pengu.get("entryNotional") if active_pengu else 0.0)
                stock_other = sum(finite(p.get("entryNotional")) for p in active_stock.values())
                if entered_kind == "V12_ENTRY":
                    if not active_v12:
                        raise RuntimeError("V12 entry observation missing admitted position")
                    new_key = next(reversed(active_v12))
                    new_position = active_v12[new_key]
                    v12_other -= finite(new_position.get("entryNotional"))
                    scale_stat = "V12_GROSS_SCALED"
                elif entered_kind == "PENGU_ENTRY":
                    if active_pengu is None:
                        raise RuntimeError("PENGU entry observation missing admitted position")
                    new_position = active_pengu
                    pengu_other = 0.0
                    scale_stat = "PENGU_GROSS_SCALED"
                elif entered_kind == "STOCK_ENTRY":
                    if not active_stock:
                        raise RuntimeError("stock entry observation missing admitted position")
                    new_key = next(reversed(active_stock))
                    new_position = active_stock[new_key]
                    stock_other -= finite(new_position.get("entryNotional"))
                    scale_stat = f"{new_position.get('strategy')}_GROSS_SCALED"
                else:
                    raise RuntimeError(f"unsupported Base entry kind for Quality102 MTM: {entered_kind}")

                requested = max(0.0, finite(new_position.get("requestedGross")))
                provisional_allocation = max(0.0, finite(new_position.get("allocatedGrossAtEntry")))
                total_other = max(0.0, v12_other + pengu_other + stock_other)
                crypto_other = max(0.0, v12_other + pengu_other)

                def allocation_for_equity(candidate_equity: float) -> float:
                    e = max(0.001, candidate_equity)
                    if entered_kind == "V12_ENTRY":
                        return max(0.0, min(
                            requested,
                            V12_PER_POSITION_GROSS_CAP,
                            V12_GROSS_CAP - v12_other / e,
                            CRYPTO_GROSS_CAP - crypto_other / e,
                            TOTAL_GROSS_CAP - total_other / e,
                        ))
                    if entered_kind == "PENGU_ENTRY":
                        return max(0.0, min(
                            requested,
                            PENGU_MAX_GROSS,
                            CRYPTO_GROSS_CAP - crypto_other / e,
                            TOTAL_GROSS_CAP - total_other / e,
                        ))
                    return max(0.0, min(
                        requested,
                        STOCK_GROSS_CAP - stock_other / e,
                        TOTAL_GROSS_CAP - total_other / e,
                    ))

                allocation = provisional_allocation
                remaining = old_notional
                total_limit = old_notional
                crypto_limit = old_notional
                converged = False
                for _ in range(128):
                    effective_total_cap = max(0.0, TOTAL_GROSS_CAP - allocation)
                    effective_crypto_cap = max(0.0, CRYPTO_GROSS_CAP - (allocation if entered_kind in ("V12_ENTRY", "PENGU_ENTRY") else 0.0))
                    total_limit = quality102_remaining_limit(equity, old_notional, mark_return, total_other, effective_total_cap)
                    crypto_limit = quality102_remaining_limit(equity, old_notional, mark_return, crypto_other, effective_crypto_cap)
                    next_remaining = min(old_notional, total_limit, crypto_limit)
                    next_equity = max(0.001, equity + (old_notional - next_remaining) * mark_return)
                    next_allocation = allocation_for_equity(next_equity)
                    if abs(next_remaining - remaining) <= max(1e-8, old_notional * 1e-12) and abs(next_allocation - allocation) <= 1e-12:
                        remaining = next_remaining
                        allocation = next_allocation
                        converged = True
                        break
                    remaining = next_remaining
                    allocation = next_allocation
                if not converged:
                    raise RuntimeError(f"Quality102/Base MTM admission solver did not converge at {ts} kind={entered_kind}")
                if allocation <= 1e-12:
                    raise RuntimeError(f"Quality102 MTM would zero an admitted Base firing at {ts} kind={entered_kind}")

                trimmed = max(0.0, old_notional - remaining)
                before = max(0.001, equity)
                pnl = trimmed * mark_return
                event_return = pnl / before if trimmed > 1e-9 else 0.0
                final_equity = max(0.001, equity + pnl)
                # Re-evaluate one final time on the converged equity and fail closed on drift.
                final_allocation = allocation_for_equity(final_equity)
                if abs(final_allocation - allocation) > 1e-10:
                    raise RuntimeError(f"Quality102/Base MTM allocation drift at {ts}: solved={allocation} final={final_allocation}")
                allocation = final_allocation

                was_scaled = provisional_allocation < requested - 1e-12
                is_scaled = allocation < requested - 1e-12
                if scale_stat and was_scaled != is_scaled:
                    stats[scale_stat] += 1 if is_scaled else -1

                if trimmed > 1e-9:
                    equity = final_equity
                    twr_index *= max(0.000001, 1.0 + event_return)
                    twr_peak = max(twr_peak, twr_index)
                    max_drawdown = min(max_drawdown, twr_index / twr_peak - 1.0)
                    month_key = dt.datetime.fromtimestamp(ts / 1000, tz=UTC).strftime("%Y-%m")
                    monthly_event_returns[month_key].append(event_return)
                    active_supp["entryNotional"] = max(0.0, remaining)
                    events.append({"ts": ts, "entryTs": entry_ts, "exitTs": ts, "strategy": "SUPPLEMENT_QUALITY102_TRIM", "sleeve": "SUPPLEMENT_QUALITY102", "symbol": active_supp.get("symbol"), "layer": active_supp.get("layer"), "pnlJpy": pnl, "eventReturn": event_return, "allocatedGrossAtEntry": finite(active_supp.get("allocatedGrossAtEntry")), "requestedGross": finite(active_supp.get("requestedGross")), "exitReason": "GROSS_RESIZE_MTM"})
                    gross_resizes.append({"ts": ts, "supplementSymbol": active_supp.get("symbol"), "supplementEntryTs": entry_ts, "supplementExitTs": active_supp.get("exitTs"), "enteredKind": entered_kind, "notionalBeforeJpy": old_notional, "notionalAfterJpy": max(0.0, remaining), "trimmedNotionalJpy": trimmed, "trimPnlJpy": pnl, "markNetUnitReturn": mark_return, "entryPrice": entry_price, "markPrice": mark_price, "priceSource": "BINANCE_VISION_USDM_1M_OPEN", "sourceEvidence": evidence, "constraintBinding": "CRYPTO" if crypto_limit <= total_limit + 1e-12 else "TOTAL"})
                    stats["SUPPLEMENT_GROSS_RESIZED"] += 1
                    stats["SUPPLEMENT_MTM_TRIM_EXECUTIONS"] += 1

                # The Base signal remains entered; only its notional is finalized on
                # post-MTM equity so all Base-specific and shared Gross caps use one equity.
                new_position["allocatedGrossAtEntry"] = allocation
                new_position["entryNotional"] = max(0.001, equity) * allocation

        vg, pg, sg, ug = v12_gross(), pengu_gross(), stock_gross(), supp_gross()
        max_v12_positions = max(max_v12_positions, len(active_v12))
        if entered_kind == "V12_ENTRY": max_entry_v12_gross = max(max_entry_v12_gross, vg)
        elif entered_kind == "PENGU_ENTRY": max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        elif entered_kind == "STOCK_ENTRY": max_entry_stock_gross = max(max_entry_stock_gross, sg)
        elif entered_kind == "SUPP_ENTRY": max_entry_supp_gross = max(max_entry_supp_gross, ug)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg + ug)
        total = vg + pg + sg + ug
        crypto = vg + pg + ug
        max_entry_total_gross = max(max_entry_total_gross, total)
        if (total > TOTAL_GROSS_CAP + 1e-9 or crypto > CRYPTO_GROSS_CAP + 1e-9) and active_supp is not None:
            gross_conflicts.append({"ts": ts, "supplementSymbol": active_supp.get("symbol"), "supplementEntryTs": active_supp.get("entryTs"), "supplementExitTs": active_supp.get("exitTs"), "enteredKind": entered_kind, "totalGross": total, "cryptoGross": crypto})

'''
    patched, count = re.subn(
        r'    def observe_entry\(entered_kind: str, ts: int\) -> None:\n.*?(?=    def reset_day\(ts: int\) -> None:)',
        corrected_observe,
        patched,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError('failed to install pre-admission Quality102/Base MTM solver')

    if 'QUALITY102_FROZEN_ENTRY_EVIDENCE' not in patched:
        raise RuntimeError('all-entry Quality102 MTM evidence marker missing after patch')
    if 'QUALITY102_MTM_PRE_ADMISSION_REBASE' not in patched:
        raise RuntimeError('pre-admission Quality102/Base MTM marker missing after patch')
    return patched


def _argv_value(flag: str) -> str:
    try:
        return sys.argv[sys.argv.index(flag) + 1]
    except (ValueError, IndexError) as exc:
        raise RuntimeError(f'missing required argument {flag}') from exc


def main() -> None:
    legacy.patch_mtm_engine = patch_mtm_engine
    legacy.main()

    output_dir = Path(_argv_value('--output-dir'))
    summary_path = output_dir / 'mtm-summary.json'
    summary = json.loads(summary_path.read_text(encoding='utf-8'))
    summary['sourceValidation'] = 'ALL_102_FROZEN_RESEARCH_1H_OPEN_CROSSCHECK_FAIL_CLOSED'
    summary['frozenEntryEvidenceCount'] = len(FROZEN_ENTRY_EVIDENCE)
    summary['admissionSizing'] = 'BASE_FIRING_PRESERVED_POST_MTM_EQUITY_REBASE'
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
