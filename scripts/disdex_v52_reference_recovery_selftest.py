from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import disdex_v13d_v11eq_stock_live_engine as stock
import disdex_v52_margin_aware_live_engine as margin


class _ReferenceHandler(BaseHTTPRequestHandler):
    status = 503
    payload: dict = {}

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        body = json.dumps(self.payload, separators=(",", ":")).encode()
        self.send_response(self.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        return


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ReferenceHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/quote?symbol=META"

    def expect_block(code: str, detail: dict) -> stock.ReferenceQualityError:
        _ReferenceHandler.status = 503
        _ReferenceHandler.payload = {"error": code, **detail}
        try:
            stock.http_json(url, reference_request=True)
        except stock.ReferenceQualityError as error:
            assert error.code == code
            return error
        raise AssertionError(f"{code} was not classified as recoverable")

    try:
        stale = expect_block("iex_quote_stale", {"symbol": "META", "ageMs": 5396, "maximumAgeMs": 5000})
        assert stale.detail["ageMs"] == 5396
        print("Test A: IEX stale 5396ms -> blocked without worker-fatal classification: PASS")

        _ReferenceHandler.status = 200
        _ReferenceHandler.payload = {"price": 582.7, "timestamp": stock.now_ms()}
        old_env = {key: os.environ.get(key) for key in ("DISDEX_STOCK_REFERENCE_MODE", "DISDEX_STOCK_REFERENCE_URL_TEMPLATE")}
        os.environ["DISDEX_STOCK_REFERENCE_MODE"] = "external"
        os.environ["DISDEX_STOCK_REFERENCE_URL_TEMPLATE"] = f"http://127.0.0.1:{server.server_port}/quote?symbol={{symbol}}"
        try:
            quote = stock.ReferenceProvider(True).quote("META")
            assert quote.price > 0
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        print("Test B: next tick fresh quote -> reference recovery: PASS")

        for code in ("pyth_quote_stale", "pyth_confidence_too_wide", "cross_source_divergence"):
            expect_block(code, {"symbol": "META"})
            print(f"Test {'C' if code == 'pyth_quote_stale' else 'D' if code == 'pyth_confidence_too_wide' else 'E'}: {code} -> order block: PASS")

        engine = object.__new__(margin.MarginAwareV52AsterOnlyEngine)
        engine.state = {}
        engine.save = lambda: None
        engine.log = lambda *_args, **_fields: None
        assert engine._handle_tick_error(stale) is True
        assert engine.state["referenceStatus"] == "BLOCKED_DATA_UNAVAILABLE"
        assert engine.state["referenceOrdersAllowed"] is False
        engine._record_reference_active()
        assert engine.state["referenceStatus"] == "ACTIVE"
        assert engine.state["referenceOrdersAllowed"] is True
        assert engine._handle_tick_error(RuntimeError("runtime permission failure")) is False
        print("Test F: runtime/system failure remains fatal while reference rejection recovers: PASS")
    finally:
        server.shutdown()
        server.server_close()
    print("DISDEX_V52_REFERENCE_RECOVERY_SELFTEST_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
