from __future__ import annotations

import time

import research_lab_v35_core_pengu_v46_gross2 as core


_original_fetch_json = core.fetch_json


def fetch_json_with_retry(path: str, params: dict, timeout: int = 45):
    last_error = None
    for attempt in range(1, 7):
        try:
            return _original_fetch_json(path, params, max(timeout, 60))
        except Exception as error:
            last_error = error
            if attempt >= 6:
                raise
            delay = min(30, 2 ** attempt)
            print(f"Aster request retry {attempt}/6 for {path} after {type(error).__name__}: {delay}s")
            time.sleep(delay)
    raise last_error  # pragma: no cover


core.fetch_json = fetch_json_with_retry

import research_lab_v71_v35_final_profiles_v94 as v94


if __name__ == "__main__":
    v94.main()
