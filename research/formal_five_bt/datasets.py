"""Load frozen acquisition files and attach integrity/provenance results."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Any

from .market_data import Bar, CoverageIssue, FundingObservation, FxRate, validate_series


HOUR_MS = 3_600_000


@dataclass(frozen=True, slots=True)
class VerifiedDataset:
    instrument: str
    bars: tuple[Bar, ...]
    funding: tuple[FundingObservation, ...]
    issues: tuple[CoverageIssue, ...]
    listing_start_ms: int | None
    listing_end_ms: int | None
    normalized_sha256: str

    @property
    def verified(self) -> bool:
        return not any(issue.blocking for issue in self.issues)


def _jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid JSONL at {path.name}:{line_number}") from error
            if not isinstance(value, dict):
                raise ValueError(f"non-object JSONL row at {path.name}:{line_number}")
            rows.append(value)
    return rows


def _sha_row(row: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def load_aster_dataset(data_root: str | Path, symbol: str) -> VerifiedDataset:
    root = Path(data_root).resolve()
    summary_path = root / "acquisition-manifest.json"
    manifest = json.loads(summary_path.read_text(encoding="utf-8"))
    status = manifest["venues"]["aster"]["klines"].get(symbol)
    if not status or status.get("status") != "ACQUIRED" or not status.get("normalized_path"):
        return VerifiedDataset(symbol, (), (), (CoverageIssue("ASTER_BARS_UNAVAILABLE", None, "Aster H1 candle acquisition is not verified"),), None, None, "")
    path = root / status["normalized_path"]
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != status.get("normalized_sha256"):
        raise ValueError(f"NORMALIZED_HASH_MISMATCH:{symbol}")
    rows = _jsonl(path)
    instrument_meta = manifest["venues"]["aster"]["instruments"].get(symbol, {})
    listed_from = instrument_meta.get("listed_from_ms")
    listed_until = instrument_meta.get("listed_until_ms")
    bars: list[Bar] = []
    issues: list[CoverageIssue] = []
    for row in rows:
        if row.get("source") != "aster" or row.get("exchange") != "ASTER" or row.get("instrument") != symbol or row.get("interval") != "1h":
            issues.append(CoverageIssue("ASTER_BAR_PROVENANCE_MISMATCH", row.get("event_time_ms"), "normalized bar metadata does not match Aster native instrument"))
            continue
        bars.append(Bar(
            exchange="ASTER", instrument_id=symbol, contract_type="linear_perpetual",
            event_time_ms=int(row["event_time_ms"]), source_time_ms=int(row["close_time_ms"]),
            received_time_ms=None, content_sha256=_sha_row(row), interval_ms=HOUR_MS,
            open=float(row["open"]), high=float(row["high"]), low=float(row["low"]),
            close=float(row["close"]), volume=float(row["base_volume"]),
        ))
    # The acquisition request intentionally starts at a finite warm-up date,
    # often years after an instrument's exchange ``onboardDate``.  Use the
    # first/last acquired observations as the candle-contiguity domain; check
    # listing metadata independently so pre-listing rows still block use.
    issues.extend(validate_series(
        bars, HOUR_MS, None, None,
        expected_native_instrument=symbol, expected_contract_type="linear_perpetual",
    ))
    for bar in bars:
        if listed_from is not None and bar.event_time_ms < int(listed_from):
            issues.append(CoverageIssue("BEFORE_LISTING", bar.event_time_ms, "Aster candle precedes verified instrument listing"))
        if listed_until is not None and bar.event_time_ms > int(listed_until):
            issues.append(CoverageIssue("AFTER_DELISTING", bar.event_time_ms, "Aster candle follows verified instrument delisting"))
    funding_status = manifest["venues"]["aster"].get("funding", {}).get(symbol, {})
    funding: list[FundingObservation] = []
    if funding_status.get("status") == "ACQUIRED" and funding_status.get("normalized_path"):
        funding_path = root / funding_status["normalized_path"]
        funding_hash = hashlib.sha256(funding_path.read_bytes()).hexdigest()
        if funding_hash != funding_status.get("normalized_sha256"):
            raise ValueError(f"FUNDING_HASH_MISMATCH:{symbol}")
        funding_rows = _jsonl(funding_path)
        for row in funding_rows:
            if row.get("source") != "aster" or row.get("exchange") != "ASTER" or row.get("instrument") != symbol:
                issues.append(CoverageIssue("FUNDING_PROVENANCE_MISMATCH", row.get("event_time_ms"), "funding metadata does not match Aster native instrument"))
                continue
            observation = FundingObservation(
                exchange="ASTER", instrument_id=symbol, contract_type="linear_perpetual",
                event_time_ms=int(row["event_time_ms"]), source_time_ms=int(row["event_time_ms"]),
                received_time_ms=None, content_sha256=_sha_row(row), funding_rate=float(row["funding_rate"]),
            )
            # A funding endpoint can retain rows from an earlier contract
            # lifecycle after a symbol is re-listed. Such rows cannot apply
            # to a position entered in the current verified listing period.
            # Record and exclude them instead of letting them contaminate the
            # active-period funding stream.
            if listed_from is not None and observation.event_time_ms < int(listed_from):
                issues.append(CoverageIssue("PRE_LISTING_FUNDING_EXCLUDED", observation.event_time_ms, "funding row precedes verified current instrument listing", blocking=False))
                continue
            if listed_until is not None and observation.event_time_ms > int(listed_until):
                issues.append(CoverageIssue("POST_DELISTING_FUNDING_EXCLUDED", observation.event_time_ms, "funding row follows verified instrument delisting", blocking=False))
                continue
            funding.append(observation)
        issues.extend(validate_series(funding, None, None, None, expected_native_instrument=symbol, expected_contract_type="linear_perpetual"))
    else:
        issues.append(CoverageIssue("ASTER_FUNDING_UNAVAILABLE", None, "Aster historical funding is missing"))

    # Do not call a candle history verified if a row was skipped or if the
    # manifest and re-counted missing-hour total disagree.
    if len(bars) != len(rows):
        issues.append(CoverageIssue("ASTER_BAR_ROWS_REJECTED", None, "one or more normalized bars failed provenance validation"))
    return VerifiedDataset(symbol, tuple(bars), tuple(funding), tuple(issues), listed_from, listed_until, digest)


def load_fred_fx(data_root: str | Path) -> tuple[tuple[FxRate, ...], tuple[CoverageIssue, ...]]:
    root = Path(data_root).resolve()
    manifest = json.loads((root / "acquisition-manifest.json").read_text(encoding="utf-8"))
    info = manifest.get("fred") or {}
    if info.get("status") != "ACQUIRED":
        return (), (CoverageIssue("FX_UNAVAILABLE", None, "FRED DEXJPUS series is missing"),)
    path = root / info["normalized_path"]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != info.get("normalized_sha256"):
        raise ValueError("FRED_NORMALIZED_HASH_MISMATCH")
    rates = []
    for row in _jsonl(path):
        ts = int(row["event_time_ms"])
        rates.append(FxRate(
            exchange="FRED", instrument_id="DEXJPUS", contract_type="daily_reference",
            event_time_ms=ts, source_time_ms=int(row["source_time_ms"]), received_time_ms=ts,
            content_sha256=_sha_row(row), rate_jpy_per_usd=float(row["rate_jpy_per_usd"]),
        ))
    issues = validate_series(rates, None, expected_native_instrument="DEXJPUS", expected_contract_type="daily_reference")
    return tuple(rates), tuple(issues)
