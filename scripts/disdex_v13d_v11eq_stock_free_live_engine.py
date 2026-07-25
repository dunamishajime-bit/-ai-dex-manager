from __future__ import annotations

import datetime as dt
import os
import time
import urllib.parse

import disdex_v13d_v11eq_stock_live_engine as engine

# The free Pyth Core + Alpaca IEX reference is deliberately held to wider
# minimum edge floors than the consolidated SIP configuration.
engine.V13D_MIN_PROJECTED_NET_BPS = float(os.getenv("DISDEX_V13D_MIN_PROJECTED_NET_BPS", "10"))
engine.V11_MIN_NET_EDGE_BPS = float(os.getenv("DISDEX_V11EQ_MIN_NET_EDGE_BPS", "20"))


def regular_us_equity_session(value: dt.datetime | None = None) -> bool:
    local = value or dt.datetime.now(tz=engine.NY)
    return local.weekday() < 5 and engine.clock("09:30:00") <= engine.ny_seconds(local) <= engine.clock("16:00:00")


def reference_health(reference: engine.ReferenceProvider) -> dict:
    parsed = urllib.parse.urlsplit(reference.template.format(symbol="NVDA", unix_ms=engine.now_ms()))
    health_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/health", "", ""))
    timeout_ms = engine.int_env("DISDEX_STOCK_REFERENCE_HEALTH_TIMEOUT_MS", 20_000)
    deadline = engine.now_ms() + timeout_ms
    last_error: Exception | None = None
    while engine.now_ms() <= deadline:
        try:
            payload = engine.http_json(health_url, headers=reference.headers, timeout=reference.timeout)
            if not isinstance(payload, dict):
                raise RuntimeError("Free reference /health returned a non-object response")
            if payload.get("pythConnected") is True and payload.get("iexConnected") is True:
                return payload
            last_error = RuntimeError(f"Free reference sources are not connected: {payload}")
        except Exception as error:
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"Free reference health did not become ready within {timeout_ms}ms: {last_error}")


def free_preflight(self: engine.StockEngine) -> dict:
    checks: dict[str, object] = {}
    if self.live:
        if not engine.bool_env("DISDEX_V13D_V11EQ_V96_LIVE_EXECUTION_ENABLED", False):
            raise RuntimeError("Live execution requires DISDEX_V13D_V11EQ_V96_LIVE_EXECUTION_ENABLED=true")
        if os.getenv("DISDEX_V13D_V11EQ_V96_LIVE_ACKNOWLEDGEMENT") != engine.LIVE_ACK:
            raise RuntimeError(f"Live execution requires acknowledgement {engine.LIVE_ACK}")
    self.state_root.mkdir(parents=True, exist_ok=True)
    probe = self.state_root / ".write-probe"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()
    checks["stateWritable"] = True
    if self.kill_switch():
        raise RuntimeError("Kill Switch is active")
    checks["killSwitchInactive"] = True
    checks["asterPing"] = self.aster.ping()
    self.aster.exchange_info()
    missing = [symbol for symbol in engine.ASTER_SYMBOL.values() if symbol not in self.aster._rules]
    if missing:
        raise RuntimeError(f"Aster Stock symbols missing: {missing}")
    checks["asterSymbols"] = list(engine.ASTER_SYMBOL.values())
    self.xyz.connect()
    xyz_meta = self.xyz.info.meta(dex="xyz")
    xyz_names = [row.get("name") for row in xyz_meta.get("universe", [])]
    missing_xyz = [symbol for symbol in engine.XYZ_SYMBOL.values() if symbol not in xyz_names]
    if missing_xyz:
        raise RuntimeError(f"Hyperliquid xyz symbols missing: {missing_xyz}")
    checks["xyzSymbols"] = list(engine.XYZ_SYMBOL.values())

    health = reference_health(self.reference)
    checks["referenceSourcesConnected"] = True
    checks["referenceHealthStatus"] = health.get("status")
    if regular_us_equity_session():
        for symbol in engine.SYMBOLS:
            reference = self.reference.quote(symbol)
            age = engine.now_ms() - reference.timestamp_ms
            if age > engine.V11_MAX_DATA_AGE_MS:
                raise RuntimeError(f"Reference quote stale for {symbol}: {age}ms")
        checks["referenceQuotesFresh"] = True
        checks["referenceFreshnessMode"] = "REQUIRED_DURING_US_REGULAR_SESSION"
    else:
        checks["referenceQuotesFresh"] = "DEFERRED"
        checks["referenceFreshnessMode"] = "REFERENCE_FRESHNESS_DEFERRED_MARKET_CLOSED"

    if self.live:
        checks["asterEquity"] = self.aster.equity()
        checks["xyzEquity"] = self.xyz.equity()
        if float(checks["asterEquity"]) <= 0 or float(checks["xyzEquity"]) <= 0:
            raise RuntimeError("Live venue equity must be positive")
        checks["managedAsterPositions"] = self.managed_aster_positions()
        checks["managedXyzPositions"] = self.managed_xyz_positions()
    checks["stockCapitalUsd"] = self.stock_capital
    checks["v13LegNotionalUsd"] = self.v13_leg_notional
    checks["v11NotionalUsd"] = self.v11_notional
    checks["v13MinimumProjectedNetBps"] = engine.V13D_MIN_PROJECTED_NET_BPS
    checks["v11MinimumNetEdgeBps"] = engine.V11_MIN_NET_EDGE_BPS
    checks["mode"] = self.mode
    return checks


engine.StockEngine.preflight = free_preflight


if __name__ == "__main__":
    raise SystemExit(engine.main())
