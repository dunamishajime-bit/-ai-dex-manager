"""Streaming decoder and Binance-style sequence checks for the L2 archive."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import sys
from typing import Any, Iterable, Mapping


@dataclass(frozen=True, slots=True)
class BookSequenceEvent:
    event_type: str
    event_time_ms: int
    received_time_ns: int
    first_update_id: int | None
    final_update_id: int | None
    prev_final_update_id: int | None


@dataclass(frozen=True, slots=True)
class BookSequenceIssue:
    code: str
    event_time_ms: int
    detail: str


@dataclass(frozen=True, slots=True)
class ArchiveValidation:
    status: str
    rows: int
    event_groups: int
    snapshots: int
    updates: int
    first_event_ms: int | None
    last_event_ms: int | None
    issues: tuple[BookSequenceIssue, ...]


def validate_event_chain(events: Iterable[BookSequenceEvent]) -> ArchiveValidation:
    rows = 0
    snapshots = 0
    updates = 0
    event_groups = 0
    first_event: int | None = None
    last_event: int | None = None
    snapshot_seen = False
    last_final: int | None = None
    issues: list[BookSequenceIssue] = []
    previous_received = -1
    for event in events:
        rows += 1
        first_event = event.event_time_ms if first_event is None else first_event
        last_event = event.event_time_ms
        if event.received_time_ns < previous_received:
            issues.append(BookSequenceIssue("OUT_OF_ORDER_RECEIVE_TIME", event.event_time_ms, "receive time moved backwards"))
        previous_received = event.received_time_ns
        if event.event_type not in {"snapshot", "update"}:
            issues.append(BookSequenceIssue("INVALID_EVENT_TYPE", event.event_time_ms, event.event_type))
            continue
        event_groups += 1
        if event.event_type == "snapshot":
            snapshots += 1
            if event.final_update_id is None:
                issues.append(BookSequenceIssue("SNAPSHOT_UPDATE_ID_MISSING", event.event_time_ms, "snapshot has no final update id"))
            else:
                snapshot_seen = True
                last_final = event.final_update_id
            continue
        updates += 1
        if not snapshot_seen:
            issues.append(BookSequenceIssue("BOOK_UPDATE_WITHOUT_SNAPSHOT", event.event_time_ms, "update chain has not been seeded by a snapshot"))
        if event.first_update_id is None or event.final_update_id is None:
            issues.append(BookSequenceIssue("UPDATE_ID_MISSING", event.event_time_ms, "update does not include first/final ids"))
            continue
        if event.first_update_id > event.final_update_id:
            issues.append(BookSequenceIssue("UPDATE_ID_RANGE_INVALID", event.event_time_ms, "first update id exceeds final id"))
        if event.prev_final_update_id is not None and event.first_update_id > event.prev_final_update_id + 1:
            issues.append(BookSequenceIssue("BOOK_SEQUENCE_GAP", event.event_time_ms, "first update id skips beyond previous final id"))
        if last_final is not None:
            if event.prev_final_update_id is not None and event.prev_final_update_id != last_final:
                issues.append(BookSequenceIssue("BOOK_SEQUENCE_GAP", event.event_time_ms, f"prev final {event.prev_final_update_id} does not match prior final {last_final}"))
            elif event.first_update_id > last_final + 1:
                issues.append(BookSequenceIssue("BOOK_SEQUENCE_GAP", event.event_time_ms, f"first update id {event.first_update_id} skips prior final {last_final}"))
        last_final = event.final_update_id
    if not snapshot_seen:
        issues.append(BookSequenceIssue("NO_SNAPSHOT_IN_CHAIN", last_event or 0, "archive range did not include a book snapshot"))
    status = "VERIFIED" if not issues and snapshots > 0 else "NOT_VERIFIABLE"
    return ArchiveValidation(status, rows, event_groups, snapshots, updates, first_event, last_event, tuple(issues))


def validate_bybit_event_chain(events: Iterable[BookSequenceEvent]) -> ArchiveValidation:
    """Validate Bybit V5 `u` updates, where final_update_id maps to `u`.

    Updates before the first full snapshot cannot seed a book and are ignored
    for the usable suffix. After a snapshot, delta update IDs must be
    consecutive; a new snapshot resets the local state.
    """
    rows = snapshots = updates = event_groups = 0
    first_event = last_event = None
    previous_received = -1
    last_update_id: int | None = None
    snapshot_seen = False
    issues: list[BookSequenceIssue] = []
    for event in events:
        rows += 1
        first_event = event.event_time_ms if first_event is None else first_event
        last_event = event.event_time_ms
        if event.received_time_ns < previous_received:
            issues.append(BookSequenceIssue("OUT_OF_ORDER_RECEIVE_TIME", event.event_time_ms, "receive time moved backwards"))
        previous_received = event.received_time_ns
        if event.event_type not in {"snapshot", "update"}:
            issues.append(BookSequenceIssue("INVALID_EVENT_TYPE", event.event_time_ms, event.event_type))
            continue
        event_groups += 1
        if event.event_type == "snapshot":
            snapshots += 1
            if event.final_update_id is None:
                issues.append(BookSequenceIssue("SNAPSHOT_UPDATE_ID_MISSING", event.event_time_ms, "Bybit snapshot has no update id `u`"))
                snapshot_seen = False
                last_update_id = None
            else:
                snapshot_seen = True
                last_update_id = event.final_update_id
            continue
        updates += 1
        if not snapshot_seen:
            # Historical captures may begin mid-stream. That prefix is not
            # usable, but a later complete snapshot can seed a valid suffix.
            continue
        update_id = event.final_update_id
        if update_id is None:
            issues.append(BookSequenceIssue("UPDATE_ID_MISSING", event.event_time_ms, "Bybit delta has no update id `u`"))
            snapshot_seen = False
            last_update_id = None
            continue
        if update_id == 1:
            issues.append(BookSequenceIssue("UPDATE_RESTART_WITHOUT_SNAPSHOT", event.event_time_ms, "Bybit update ID reset to 1 without a snapshot event"))
            snapshot_seen = False
            last_update_id = None
            continue
        if last_update_id is None or update_id != last_update_id + 1:
            issues.append(BookSequenceIssue("BOOK_SEQUENCE_GAP", event.event_time_ms, f"Bybit `u` {update_id} does not follow {last_update_id}"))
            snapshot_seen = False
            last_update_id = None
            continue
        last_update_id = update_id
    if snapshots == 0:
        issues.append(BookSequenceIssue("NO_SNAPSHOT_IN_CHAIN", last_event or 0, "archive range did not include a Bybit order-book snapshot"))
    status = "VERIFIED" if snapshots > 0 and not issues else "NOT_VERIFIABLE"
    return ArchiveValidation(status, rows, event_groups, snapshots, updates, first_event, last_event, tuple(issues))


def _dependencies():
    local_runtime = Path(__file__).resolve().parents[2] / "research-runs" / "formal-five-logic-bt" / ".runtime-packages"
    if local_runtime.is_dir() and str(local_runtime) not in sys.path:
        sys.path.insert(0, str(local_runtime))
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
        import zstandard
    except ImportError as error:
        raise RuntimeError("L2 decoding requires pyarrow and zstandard from requirements.txt") from error
    return pa, pq, zstandard


def decode_zstd_parquet(
    path_or_bytes: str | Path | bytes,
    *,
    expected_symbol: str,
    sequence_protocol: str = "binance_diff",
) -> ArchiveValidation:
    pa, pq, zstandard = _dependencies()
    raw = Path(path_or_bytes).read_bytes() if isinstance(path_or_bytes, (str, Path)) else path_or_bytes
    decompressor = zstandard.ZstdDecompressor()
    try:
        decompressed = decompressor.decompress(raw)
    except zstandard.ZstdError:
        raise ValueError("ORDERBOOK_ZSTD_DECOMPRESSION_FAILED") from None
    try:
        parquet = pq.ParquetFile(pa.BufferReader(decompressed))
    except Exception:
        raise ValueError("ORDERBOOK_PARQUET_DECODE_FAILED") from None
    if sequence_protocol not in {"binance_diff", "bybit_v5"}:
        raise ValueError("unsupported archived sequence protocol")
    required = {"received_time", "event_time", "symbol", "event_type", "first_update_id", "final_update_id", "prev_final_update_id", "side"}
    if not required.issubset(parquet.schema_arrow.names):
        raise ValueError("ORDERBOOK_REQUIRED_COLUMNS_MISSING")

    current_key: tuple[Any, ...] | None = None
    current_event: BookSequenceEvent | None = None
    event_groups: list[BookSequenceEvent] = []
    snapshot_sides: set[str] = set()
    side_issues: list[BookSequenceIssue] = []
    row_count = 0

    def flush_current() -> None:
        nonlocal current_event, snapshot_sides
        if current_event is None:
            return
        if current_event.event_type == "snapshot" and not {"bid", "ask"}.issubset(snapshot_sides):
            side_issues.append(BookSequenceIssue("INCOMPLETE_SNAPSHOT", current_event.event_time_ms, "snapshot does not contain both bid and ask levels"))
        event_groups.append(current_event)
        current_event = None
        snapshot_sides = set()

    for batch in parquet.iter_batches(columns=sorted(required), batch_size=100_000):
        rows = batch.to_pylist()
        for row in rows:
            row_count += 1
            if row["symbol"] != expected_symbol:
                raise ValueError("ORDERBOOK_NATIVE_SYMBOL_MISMATCH")
            key = (
                row["event_type"], row["received_time"], row["event_time"],
                row.get("first_update_id"), row.get("final_update_id"), row.get("prev_final_update_id"),
            )
            if key != current_key:
                flush_current()
                current_key = key
                current_event = BookSequenceEvent(
                    event_type=str(row["event_type"]), event_time_ms=int(row["event_time"]),
                    received_time_ns=int(row["received_time"]),
                    first_update_id=int(row["first_update_id"]) if row.get("first_update_id") is not None else None,
                    final_update_id=int(row["final_update_id"]) if row.get("final_update_id") is not None else None,
                    prev_final_update_id=int(row["prev_final_update_id"]) if row.get("prev_final_update_id") is not None else None,
                )
            side = str(row.get("side") or "").lower()
            if side in {"bid", "ask"}:
                snapshot_sides.add(side)
    flush_current()
    validation = validate_bybit_event_chain(event_groups) if sequence_protocol == "bybit_v5" else validate_event_chain(event_groups)
    issues = [*validation.issues, *side_issues]
    if side_issues:
        validation = ArchiveValidation(
            "NOT_VERIFIABLE", validation.rows, validation.event_groups, validation.snapshots,
            validation.updates, validation.first_event_ms, validation.last_event_ms, tuple(issues),
        )
    return ArchiveValidation(
        validation.status, row_count, validation.event_groups, validation.snapshots,
        validation.updates, validation.first_event_ms, validation.last_event_ms, tuple(issues),
    )
