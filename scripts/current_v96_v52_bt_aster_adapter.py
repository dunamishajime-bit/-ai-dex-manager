from __future__ import annotations

import time
import urllib.error


def install_historical_data_adapters(crypto_bt) -> None:
    original_fetch_json = crypto_bt.core.fetch_json
    state = {"last": 0.0}

    def resilient_fetch_json(path: str, params: dict, timeout: int = 40):
        last_error: Exception | None = None
        for attempt in range(1, 10):
            wait = 0.85 - (time.monotonic() - state["last"])
            if wait > 0:
                time.sleep(wait)
            try:
                result = original_fetch_json(path, params, timeout)
                state["last"] = time.monotonic()
                return result
            except urllib.error.HTTPError as error:
                last_error = error
                state["last"] = time.monotonic()
                if error.code not in {418, 429, 500, 502, 503, 504} or attempt == 9:
                    raise
                retry_after = error.headers.get("Retry-After") if error.headers else None
                delay = float(retry_after) if retry_after and retry_after.isdigit() else min(120, 5 * (2 ** (attempt - 1)))
                print(f"Aster {path} HTTP {error.code}; retrying in {delay:.0f}s", flush=True)
                time.sleep(delay)
            except Exception as error:
                last_error = error
                state["last"] = time.monotonic()
                if attempt == 9:
                    raise
                delay = min(60, 2 ** attempt)
                print(f"Aster {path} transient error; retrying in {delay}s: {error}", flush=True)
                time.sleep(delay)
        raise RuntimeError(f"Aster request failed: {path}: {last_error}")

    crypto_bt.core.fetch_json = resilient_fetch_json
