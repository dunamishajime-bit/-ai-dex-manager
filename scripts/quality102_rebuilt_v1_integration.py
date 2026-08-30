from __future__ import annotations

import re

START_ISO = "2024-08-10T00:00:00Z"
END_ISO = "2026-08-10T00:00:00Z"
WARM_START_ISO = "2024-05-01T00:00:00Z"
INITIAL_JPY = 10_000
MONTHLY_JPY = 20_000
CONTRIBUTION_COUNT = 24
TOTAL_CONTRIBUTED_JPY = INITIAL_JPY + MONTHLY_JPY * CONTRIBUTION_COUNT
QUALITY_REQUESTED_GROSS = 0.50
CRYPTO_GROSS_CAP = 2.0
TOTAL_GROSS_CAP = 2.5


def allocate_quality_gross(*, base_crypto_gross: float, base_total_gross: float) -> float:
    """Return the effective Quality sleeve using only pre-entry gross headroom.

    Quality always requests the original 0.50x sleeve. Existing portfolio
    positions have priority. Normal/Stress PnL and every future outcome are
    intentionally absent from this function's inputs.
    """
    crypto = float(base_crypto_gross)
    total = float(base_total_gross)
    if crypto < 0.0 or total < 0.0:
        raise ValueError("base gross must be nonnegative")
    return max(
        0.0,
        min(
            QUALITY_REQUESTED_GROSS,
            CRYPTO_GROSS_CAP - crypto,
            TOTAL_GROSS_CAP - total,
        ),
    )


def _replace_once(source: str, old: str, new: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"expected exactly one occurrence of {old!r}; found {count}")
    return source.replace(old, new, 1)


def patch_v12_top2_two_year_wrapper(source: str) -> str:
    """Patch only V12 Top2 research start/end replacements to the exact 2y window."""
    out = source
    out = _replace_once(
        out,
        'replaceOnce("const START = Date.UTC(2025, 7, 21);", "const START = Date.UTC(2025, 7, 1);");',
        'replaceOnce("const START = Date.UTC(2025, 7, 21);", "const START = Date.UTC(2024, 7, 10);");',
    )
    out = _replace_once(
        out,
        'replaceOnce("const END = Date.UTC(2026, 7, 21);", "const END = Date.UTC(2026, 7, 1);");',
        'replaceOnce("const END = Date.UTC(2026, 7, 21);", "const END = Date.UTC(2026, 7, 10);");',
    )
    return out


def patch_pengu_v8_two_year_source(source: str) -> str:
    """Extend the already-built V8 source to two years without changing V8 logic.

    The old exact one-year performance assertions are removed because extending
    the research horizon necessarily changes trade count/return/PF/DD. Structural
    assertions and frozen strategy parameters remain untouched.
    """
    out = source
    out = _replace_once(
        out,
        'Date.parse("2025-07-01T00:00:00Z")',
        f'Date.parse("{WARM_START_ISO}")',
    )
    out = _replace_once(
        out,
        'Date.parse("2025-08-10T00:00:00Z")',
        f'Date.parse("{START_ISO}")',
    )
    if out.count(f'Date.parse("{END_ISO}")') != 1:
        raise ValueError("unexpected PENGU V8 evaluation end marker")

    patterns = (
        r'^\s*assert\.equal\(normalMetrics\.trades,70,`V8 normal trade drift .*?\);\s*$\n?',
        r'^\s*assert\.equal\(stressMetrics\.trades,70,`V8 severe trade drift .*?\);\s*$\n?',
        r'^\s*assert\.ok\(Math\.abs\(normalMetrics\.(?:returnPct|pf|maxDrawdownPct)-.*?\);\s*$\n?',
        r'^\s*assert\.ok\(Math\.abs\(stressMetrics\.(?:returnPct|pf|maxDrawdownPct)-.*?\);\s*$\n?',
    )
    for pattern in patterns:
        out = re.sub(pattern, '', out, flags=re.MULTILINE)

    out = out.replace(
        'ledger.period.startInclusive,"2025-08-10T00:00:00.000Z"',
        'ledger.period.startInclusive,"2024-08-10T00:00:00.000Z"',
    )
    if 'ledger.period.startInclusive,"2025-08-10T00:00:00.000Z"' in out:
        raise ValueError("legacy PENGU start-period assertion remains")
    if 'ledger.period.startInclusive,"2024-08-10T00:00:00.000Z"' not in out:
        raise ValueError("two-year PENGU start-period assertion missing")
    if 'ledger.period.endExclusive,"2026-08-10T00:00:00.000Z"' not in out:
        raise ValueError("PENGU end-period assertion missing")
    return out


def patch_dca_two_year_source(source: str) -> str:
    """Patch only DCA horizon/contribution cadence; preserve portfolio caps."""
    out = source
    out = _replace_once(
        out,
        'START = dt.datetime(2025, 8, 10, tzinfo=UTC)',
        'START = dt.datetime(2024, 8, 10, tzinfo=UTC)',
    )
    if out.count('END = dt.datetime(2026, 8, 10, tzinfo=UTC)') != 1:
        raise ValueError("unexpected DCA end marker")
    out = _replace_once(out, 'MONTHLY_JPY = 10_000.0', 'MONTHLY_JPY = 20_000.0')
    out = _replace_once(
        out,
        'cur = dt.datetime(2025, 9, 1, tzinfo=UTC)',
        'cur = dt.datetime(2024, 9, 1, tzinfo=UTC)',
    )
    if 'INITIAL_JPY = 10_000.0' not in out:
        raise ValueError("DCA initial capital contract missing")
    if 'TOTAL_GROSS_CAP = 2.5' not in out or 'CRYPTO_GROSS_CAP = 2.0' not in out:
        raise ValueError("portfolio gross contract missing")
    return out
