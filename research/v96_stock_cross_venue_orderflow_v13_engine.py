from __future__ import annotations

from typing import Optional

from v96_stock_cross_venue_orderflow_v13_engine_base import (
    ASTER, ASTER_WS, BaseEngine, CANCEL_MOVE_BPS, COSTS, FORCED_COSTS, FRESH_MS,
    MAX_ADVERSE_IMBALANCE, MAX_INVENTORY_MS, MAX_QUEUE_USD, MIN_HEDGE_USD,
    MIN_NET_BPS, NOTIONAL, STRATEGY_ID, SYMBOLS, TRADE_WINDOW_MS, TTL_MS,
    Writer, XYZ, XYZ_WS, finite, iso, now_ms, percentile, request_json,
)


class Engine(BaseEngine):
    def refresh(self, symbol: str, received_ms: int) -> None:
        quote = self.quotes.get(symbol)
        if quote and quote["status"] == "OPEN":
            self.cancel_if_needed(quote, received_ms)
            if quote["status"] == "OPEN":
                return
        rows = self.candidates(symbol, received_ms)
        for row in rows:
            self.edges.append(row["projectedNormalNetBps"])
            self.record({"recordType": "opportunity", "receivedMs": received_ms, **row})
        eligible = [r for r in rows if r["eligible"]]
        if not eligible:
            return
        selected = max(eligible, key=lambda r: (r["projectedNormalNetBps"], -r["makerTopUsd"]))
        self.counter += 1
        hedge = self.books[(selected["hedgeVenue"], symbol)]
        quantity = (self.inventory[symbol]["quantity"] if selected["purpose"] == "CLOSE"
                    else NOTIONAL / selected["makerPrice"])
        quote = {**selected, "quoteId": f"v13-{self.counter:08d}",
                 "quantity": quantity, "targetFillUsd": quantity * selected["makerPrice"],
                 "createdMs": received_ms, "expiresMs": received_ms + TTL_MS,
                 "queueAheadUsd": selected["makerTopUsd"], "filledUsd": 0.0,
                 "referenceMid": hedge["mid"], "status": "OPEN", "cancelReason": None}
        self.quotes[symbol] = quote
        self.stats["quotes"] += 1
        self.record({"recordType": "virtual_quote_open", **quote})

    def cancel_if_needed(self, quote: dict, received_ms: int) -> None:
        reason = None
        pair = self.ready(quote["symbol"], received_ms)
        if received_ms >= quote["expiresMs"]:
            reason = "TTL"
        elif not pair:
            reason = "STALE_OR_INVALID_BOOK"
        else:
            maker = self.books[(quote["makerVenue"], quote["symbol"])]
            hedge = self.books[(quote["hedgeVenue"], quote["symbol"])]
            current, _ = self.maker_top(maker, quote["side"])
            if current != quote["makerPrice"]:
                reason = "MAKER_TOP_MOVED"
            elif abs(hedge["mid"] / quote["referenceMid"] - 1) * 10_000 > CANCEL_MOVE_BPS:
                reason = "REFERENCE_MOVED"
            else:
                _, adverse = self.flow_fields(quote["makerVenue"], quote["symbol"], quote["side"], received_ms)
                if adverse is not None and adverse > MAX_ADVERSE_IMBALANCE:
                    reason = "ADVERSE_ORDER_FLOW"
        if reason:
            quote["status"], quote["cancelReason"] = "CANCELED", reason
            self.stats[f"cancel_{reason}"] += 1
            self.record({"recordType": "virtual_quote_cancel", "canceledMs": received_ms, **quote})

    def consume(self, quote: dict, trade: dict) -> None:
        crosses = ((quote["side"] == "BUY" and trade["aggressor"] == "SELL" and trade["price"] <= quote["makerPrice"])
                   or (quote["side"] == "SELL" and trade["aggressor"] == "BUY" and trade["price"] >= quote["makerPrice"]))
        if not crosses:
            return
        usd = trade["notional"]
        consumed = min(quote["queueAheadUsd"], usd)
        quote["queueAheadUsd"] -= consumed
        usd -= consumed
        quote["filledUsd"] += min(max(0.0, quote["targetFillUsd"] - quote["filledUsd"]), max(0.0, usd))
        if quote["filledUsd"] + 1e-9 < quote["targetFillUsd"]:
            return
        hedge = self.books.get((quote["hedgeVenue"], quote["symbol"]))
        if not hedge or trade["receivedMs"] - hedge["receivedMs"] > FRESH_MS:
            self.reject_unhedged(quote, trade["receivedMs"], "HEDGE_BOOK_STALE")
            return
        hedge_action = "SELL" if quote["side"] == "BUY" else "BUY"
        hedge_price, hedge_usd = self.taker_top(hedge, hedge_action)
        required_hedge_usd = quote["quantity"] * hedge_price
        if hedge_usd < required_hedge_usd:
            self.reject_unhedged(quote, trade["receivedMs"], "HEDGE_TOP_DEPTH")
            return
        quote["status"] = "FILLED_AND_HEDGED"
        if quote["purpose"] == "OPEN":
            self.open_inventory(quote, hedge_price, trade["receivedMs"])
        else:
            self.complete_cycle(quote, hedge_price, trade["receivedMs"], "MAKER_CYCLE")

    def reject_unhedged(self, quote: dict, received_ms: int, reason: str) -> None:
        quote["status"], quote["cancelReason"] = "UNHEDGED_REJECTED", reason
        self.stats["unhedged"] += 1
        self.record({"recordType": "virtual_unhedged_rejection", "rejectedMs": received_ms, **quote})

    def open_inventory(self, quote: dict, hedge_price: float, received_ms: int) -> None:
        inv = {"inventoryId": f"inv-{quote['quoteId']}", "symbol": quote["symbol"],
               "makerVenue": quote["makerVenue"], "hedgeVenue": quote["hedgeVenue"],
               "openSide": quote["side"], "quantity": quote["quantity"], "initialNotional": NOTIONAL,
               "makerOpenPrice": quote["makerPrice"], "hedgeOpenPrice": hedge_price,
               "openedMs": received_ms, "entryQuoteId": quote["quoteId"]}
        self.inventory[quote["symbol"]] = inv
        self.stats["entry_fills"] += 1
        self.record({"recordType": "virtual_inventory_open", "openedAt": iso(received_ms), **inv,
                     "entryDislocationBps": quote["grossEdgeBps"]})

    def complete_cycle(self, quote: dict, hedge_price: float, received_ms: int,
                       profile: str, close_reason: Optional[str] = None) -> None:
        inv = self.inventory.get(quote["symbol"])
        if not inv:
            self.reject_unhedged(quote, received_ms, "INVENTORY_MISSING")
            return
        gross = self.cycle_gross_bps(inv, quote["makerPrice"], hedge_price)
        cycle = {"symbol": quote["symbol"], "inventoryId": inv["inventoryId"], "profile": profile,
                 "makerVenue": inv["makerVenue"], "hedgeVenue": inv["hedgeVenue"],
                 "openSide": inv["openSide"], "makerOpenPrice": inv["makerOpenPrice"],
                 "hedgeOpenPrice": inv["hedgeOpenPrice"], "makerClosePrice": quote["makerPrice"],
                 "hedgeClosePrice": hedge_price, "quantity": inv["quantity"], "grossBps": gross,
                 "openedMs": inv["openedMs"], "closedMs": received_ms,
                 "holdingMs": received_ms - inv["openedMs"], "closeReason": close_reason or profile}
        self.cycles.append(cycle)
        self.stats["cycles"] += 1
        del self.inventory[quote["symbol"]]
        self.record({"recordType": "virtual_cycle_complete", **cycle})

    def record_unresolved(self, inv: dict, received_ms: int, reason: str) -> None:
        if inv.get("lastUnresolvedReason") == reason:
            return
        inv["lastUnresolvedReason"] = reason
        self.stats["unresolved_close_attempts"] += 1
        self.record({"recordType": "virtual_inventory_unresolved", "receivedMs": received_ms,
                     "reason": reason, **inv})

    def force_close(self, symbol: str, received_ms: int, reason: str) -> bool:
        inv = self.inventory.get(symbol)
        if not inv:
            return False
        pair = self.ready(symbol, received_ms)
        if not pair:
            self.record_unresolved(inv, received_ms, f"{reason}_STALE_BOOK")
            return False
        quote = self.quotes.get(symbol)
        if quote and quote["status"] == "OPEN":
            quote["status"], quote["cancelReason"] = "CANCELED", reason
            self.stats[f"cancel_{reason}"] += 1
            self.record({"recordType": "virtual_quote_cancel", "canceledMs": received_ms, **quote})
        maker = self.books[(inv["makerVenue"], symbol)]
        hedge = self.books[(inv["hedgeVenue"], symbol)]
        maker_action = "SELL" if inv["openSide"] == "BUY" else "BUY"
        hedge_action = "BUY" if inv["openSide"] == "BUY" else "SELL"
        maker_price, maker_usd = self.taker_top(maker, maker_action)
        hedge_price, hedge_usd = self.taker_top(hedge, hedge_action)
        required_maker = inv["quantity"] * maker_price
        required_hedge = inv["quantity"] * hedge_price
        if maker_usd < required_maker or hedge_usd < required_hedge:
            self.record_unresolved(inv, received_ms, f"{reason}_DEPTH")
            return False
        synthetic = {"symbol": symbol, "makerPrice": maker_price}
        self.complete_cycle(synthetic, hedge_price, received_ms, "FORCED_TAKER", reason)
        self.stats["forced_cycles"] += 1
        return True

    def tick(self, received_ms: int) -> None:
        for symbol in SYMBOLS:
            quote = self.quotes.get(symbol)
            if quote and quote["status"] == "OPEN":
                self.cancel_if_needed(quote, received_ms)
            inv = self.inventory.get(symbol)
            if inv and received_ms - inv["openedMs"] >= MAX_INVENTORY_MS:
                self.force_close(symbol, received_ms, "MAX_INVENTORY_AGE")
            self.refresh(symbol, received_ms)

    def close_for_result(self, received_ms: int) -> None:
        for symbol in list(self.inventory):
            self.force_close(symbol, received_ms, "PROBE_END")
        for quote in self.quotes.values():
            if quote["status"] == "OPEN":
                quote["status"], quote["cancelReason"] = "CANCELED", "PROBE_END"
                self.stats["cancel_PROBE_END"] += 1
                self.record({"recordType": "virtual_quote_cancel", "canceledMs": received_ms, **quote})

    def result(self) -> dict:
        self.close_for_result(now_ms())
        coverage = {s: sorted(v for v in ("ASTER", "XYZ") if (v, s) in self.books) for s in SYMBOLS}
        complete = [s for s, venues in coverage.items() if venues == ["ASTER", "XYZ"]]
        scenarios = {}
        for name in COSTS:
            rows = []
            by_symbol = {symbol: 0.0 for symbol in SYMBOLS}
            for cycle in self.cycles:
                cost = COSTS[name] if cycle["profile"] == "MAKER_CYCLE" else FORCED_COSTS[name]
                net = cycle["grossBps"] - cost
                rows.append(net)
                by_symbol[cycle["symbol"]] += net
            positive_total = sum(max(0.0, value) for value in by_symbol.values())
            max_share = (max((max(0.0, value) for value in by_symbol.values()), default=0.0) / positive_total
                         if positive_total > 0 else None)
            scenarios[name] = {"makerCycleCostBps": COSTS[name], "forcedCloseCostBps": FORCED_COSTS[name],
                               "completedCycles": len(rows),
                               "averageNetBps": sum(rows) / len(rows) if rows else None,
                               "positiveNetRate": sum(n > 0 for n in rows) / len(rows) if rows else None,
                               "minimumNetBps": min(rows) if rows else None,
                               "maximumNetBps": max(rows) if rows else None,
                               "bySymbolNetBps": by_symbol,
                               "maxPositiveProfitContributionShare": max_share}
        if len(complete) != len(SYMBOLS):
            status = "V13_ENDPOINT_OR_SYMBOL_COVERAGE_FAILED"
        elif self.stats["unhedged"] > 0 or self.inventory:
            status = "V13_EXECUTION_SAFETY_FAILED"
        elif len(self.cycles) >= 30:
            normal, p95, severe = scenarios["NORMAL"], scenarios["P95"], scenarios["SEVERE"]
            passed = (normal["averageNetBps"] is not None and normal["averageNetBps"] > 0
                      and p95["averageNetBps"] is not None and p95["averageNetBps"] > 0
                      and severe["averageNetBps"] is not None and severe["averageNetBps"] > 0
                      and normal["positiveNetRate"] is not None and normal["positiveNetRate"] >= 0.55
                      and normal["maxPositiveProfitContributionShare"] is not None
                      and normal["maxPositiveProfitContributionShare"] <= 0.40)
            status = "V13_SHORT_PROBE_LEAD_FORWARD_ONLY" if passed else "V13_SHORT_PROBE_FAILED"
        else:
            status = "V13_FORWARD_DATA_REQUIRED"
        return {"strategyId": STRATEGY_ID, "status": status, "generatedAt": iso(),
                "safety": {"mode": "SHADOW_RESEARCH_ONLY", "orderSubmissionAllowed": False,
                           "productionChanged": False, "liveChanged": False, "vpsChanged": False,
                           "cryptoV96Changed": False},
                "coverage": {"booksBySymbol": coverage, "completeSymbols": complete,
                             "asterBooks": self.stats["book_ASTER"], "xyzBooks": self.stats["book_XYZ"],
                             "asterTrades": self.stats["trade_ASTER"], "xyzTrades": self.stats["trade_XYZ"],
                             "collectorErrors": self.stats["collector_errors"]},
                "virtualExecution": {"quotesOpened": self.stats["quotes"],
                                     "entryFills": self.stats["entry_fills"],
                                     "completedCycles": self.stats["cycles"],
                                     "forcedCycles": self.stats["forced_cycles"],
                                     "openInventories": len(self.inventory),
                                     "unhedgedRejected": self.stats["unhedged"],
                                     "unresolvedInventory": len(self.inventory),
                                     "unresolvedCloseAttempts": self.stats["unresolved_close_attempts"],
                                     "cancellations": {k.removeprefix("cancel_"): v for k, v in self.stats.items()
                                                       if k.startswith("cancel_")}},
                "costScenarios": scenarios,
                "diagnostics": {"latencyP50Ms": percentile(self.latencies, 0.5),
                                "latencyP95Ms": percentile(self.latencies, 0.95),
                                "projectedNetEdgeP50Bps": percentile(self.edges, 0.5),
                                "projectedNetEdgeP95Bps": percentile(self.edges, 0.95)},
                "promotionGate": {"minimumForwardRegularSessions": 20,
                                  "minimumCompletedCycles": 100,
                                  "minimumPositiveNetRate": 0.55,
                                  "normalP95SevereAverageNetMustBePositive": True,
                                  "maximumSingleSymbolPnlShare": 0.40,
                                  "maximumUnhedgedRejected": 0,
                                  "maximumUnresolvedInventory": 0,
                                  "retuningOnCollectedForwardWindow": False}}
