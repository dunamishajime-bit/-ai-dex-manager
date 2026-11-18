"""Exact original V52 v50_candidate method inside a no-IO research shell.
Every method body line is unchanged from the SHA-pinned upstream engine.
The enclosing class here is intentionally different and is NOT executable
by itself: requires fixture-injected pure base/quote/admission hooks.
No network, venue, lifecycle or live engine is imported.
"""
from __future__ import annotations
from typing import Optional, Dict, List, Tuple
V50_SLOT = "V50_POST_OPEN_BASIS"
V50_MIN_ENTRY_BASIS_BPS = 60.0
V50_CONVERGENCE_BPS = 20.0
V50_MAX_ADVERSE_BASIS_MOVE_BPS = 10.0
V50_MAX_ROUND_TRIP_COST_BPS = 60.0
V50_MAX_SPREAD_BPS = 20.0
V50_MIN_NET_EDGE_BPS = 7.5
class V52NativeCandidateOfflineShell:
    def v50_candidate(self, window: str, rows: dict, notional: float) -> Tuple[Optional[dict], Dict[str, List[str]]]:
        signal = (self.state.get("v50SignalBasis") or {}).get(window) or {}
        eligible: List[dict] = []
        rejections: Dict[str, List[str]] = {}
        now = base.now_ms()
        ny_day = self.current_local_time().date().isoformat()
        active_symbols = {str(p.get("symbol")) for p in self.positions().values()}
        try:
            gross = self.gross_snapshot()
        except Exception:
            gross = {}
        equity = base.finite(gross.get("equityUsd"), 0.0)
        requested_gross = notional / equity if equity > 0 else 0.0
        stock_gross = base.finite(gross.get("stockGross"), 0.0)
        total_gross = base.finite(gross.get("totalGross"), 0.0)
        available_stock_gross = max(0.0, self.stock_gross_cap - stock_gross)
        for symbol, (aster, _xyz, reference) in rows.items():
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            signal_basis = base.finite(signal.get(symbol), 0.0)
            side = "SELL" if basis > 0 else "BUY"
            exit_action = "BUY" if side == "SELL" else "SELL"
            cost, detail = self.estimate_v11_cost(aster, exit_action, notional)
            adverse = max(0.0, abs(basis) - abs(signal_basis))
            reasons: List[str] = []
            if symbol in active_symbols: reasons.append("SAME_SYMBOL_ACTIVE")
            if abs(basis) < V50_MIN_ENTRY_BASIS_BPS: reasons.append("BASIS_BELOW_60")
            if signal_basis * basis <= 0: reasons.append("SIGN_CHANGED")
            if adverse > V50_MAX_ADVERSE_BASIS_MOVE_BPS: reasons.append("ADVERSE_BASIS_MOVE")
            if now - aster.received_ms > base.V11_MAX_DATA_AGE_MS or now - reference.received_ms > base.V11_MAX_DATA_AGE_MS: reasons.append("STALE_DATA")
            if abs(aster.received_ms - reference.received_ms) > base.V11_MAX_SOURCE_CLOCK_DIFF_MS: reasons.append("SOURCE_CLOCK_MISMATCH")
            if cost > V50_MAX_ROUND_TRIP_COST_BPS: reasons.append("ROUND_TRIP_COST_OVER_60")
            calculated_net_edge = abs(basis) - V50_CONVERGENCE_BPS - cost
            if calculated_net_edge < V50_MIN_NET_EDGE_BPS: reasons.append("NET_EDGE_BELOW_7_5")
            if aster.depth_usd(exit_action) < 2.0 * notional: reasons.append("DEPTH_BELOW_2X")
            if aster.spread_bps > V50_MAX_SPREAD_BPS: reasons.append("SPREAD_OVER_20")
            amzn_yahoo_gate = None
            if str(symbol).upper() == "AMZN" and side == "SELL":
                # This is intentionally scoped to new AMZN SHORT admission.
                # Position management, AMZN LONG, and every other symbol do
                # not consult Yahoo and cannot be blocked by its availability.
                amzn_yahoo_gate = self._amzn_short_yahoo_gate(now)
                if amzn_yahoo_gate.get("status") != "PASS":
                    reasons.append(str(amzn_yahoo_gate.get("reason") or "AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE"))
            detail = detail if isinstance(detail, dict) else {}
            accepted = not reasons
            telemetry = {
                "timestamp": now,
                "nyDay": ny_day,
                "strategy": V50_SLOT,
                "symbol": symbol,
                "window": window,
                "direction": "SHORT" if side == "SELL" else "LONG",
                "signalBasisBps": signal_basis,
                "currentBasisBps": basis,
                "basisBps": basis,
                "estimatedRoundTripCostBps": cost,
                "makerFeeBps": self.aster_maker_fee_bps,
                "takerFeeBps": self.aster_taker_fee_bps,
                "spreadBps": base.finite(detail.get("spreadBps"), base.finite(getattr(aster, "spread_bps", 0.0))),
                "VWAPSlippageBps": base.finite(detail.get("vwapSlippageBps"), base.finite(detail.get("exitSlippageBps"), 0.0)),
                "safetyBufferBps": base.finite(detail.get("safetyBufferBps"), self.v11_safety_buffer_bps),
                "calculatedNetEdgeBps": calculated_net_edge,
                "estimatedNetEdgeBps": calculated_net_edge,
                "maxRoundTripCostBps": V50_MAX_ROUND_TRIP_COST_BPS,
                "maxSpreadBps": V50_MAX_SPREAD_BPS,
                "minimumNetEdgeBps": V50_MIN_NET_EDGE_BPS,
                "accepted": accepted,
                "rejectionReasons": reasons,
                "grossRequested": requested_gross,
                "grossAccepted": requested_gross if accepted else 0.0,
                "availableStockGross": available_stock_gross,
                "totalGrossBeforeReservation": total_gross,
                "totalGrossAfterReservation": total_gross + (requested_gross if accepted else 0.0),
            }
            if amzn_yahoo_gate is not None:
                telemetry["amznShortYahooGate"] = amzn_yahoo_gate
            append_v52_diagnostic(self.state, ny_day=ny_day, row=telemetry)
            self.log("v52-cost-telemetry", **telemetry)
            rejections[symbol] = reasons
            if not reasons:
                eligible.append({"symbol": symbol, "basisBps": basis, "signalBasisBps": signal_basis, "side": side, "entryPrice": aster.bid if side == "BUY" else aster.ask, "estimatedRoundTripCostBps": cost, "adverseBasisMoveBps": adverse, "costDetail": detail, "route": f"POST_{window.replace(':', '')}"})
        self.save()
        if not eligible:
            return None, rejections
        return sorted(eligible, key=lambda row: (-abs(row["basisBps"]), row["symbol"]))[0], rejections
