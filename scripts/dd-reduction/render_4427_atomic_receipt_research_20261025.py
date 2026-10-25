#!/usr/bin/env python3
"""RESEARCH ONLY: local SQLite receipt journal; never authorizes orders.

Does not establish trusted producer, Native8 Owner/Route registration, or 13 GateProof.
No integration with live, production, wallet, or allocator. Synthetic receipts only.
"""
from __future__ import annotations
import dataclasses
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

SHA_RE = re.compile(r"^[0-9a-f]{64}$")
SOURCE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")


@dataclasses.dataclass(frozen=True)
class Receipt:
    source_id: str
    sequence: int
    event_id: str
    candidate_key: str
    entry_projection_sha256: str
    inventory_sha256: str
    proof_manifest_sha256: str
    asof_ms: int

    def validate(self):
        if not SOURCE_RE.fullmatch(self.source_id):
            raise ValueError("INVALID_SOURCE_ID")
        if not isinstance(self.event_id, str) or not self.event_id or len(self.event_id) > 160:
            raise ValueError("INVALID_EVENT_ID")
        if type(self.sequence) is not int or self.sequence < 1:
            raise ValueError("INVALID_SEQUENCE")
        if type(self.asof_ms) is not int or self.asof_ms < 1:
            raise ValueError("INVALID_ASOF")
        for name in ("candidate_key", "entry_projection_sha256", "inventory_sha256", "proof_manifest_sha256"):
            if not SHA_RE.fullmatch(getattr(self, name)):
                raise ValueError("INVALID_SHA:" + name)

    def fingerprint(self):
        self.validate()
        b = json.dumps(dataclasses.asdict(self), sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(b).hexdigest()


def connect(db_path: Path):
    db_path = Path(db_path)
    if not db_path.parent.is_dir():
        raise ValueError("RESEARCH_DB_PARENT_MISSING")
    con = sqlite3.connect(str(db_path), isolation_level=None, timeout=15)
    con.execute("PRAGMA busy_timeout=15000")
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=FULL")
    con.execute("""CREATE TABLE IF NOT EXISTS source_cursor (
      source_id TEXT PRIMARY KEY, last_sequence INTEGER NOT NULL)""")
    con.execute("""CREATE TABLE IF NOT EXISTS receipts (
      source_id TEXT NOT NULL, event_id TEXT NOT NULL,
      sequence INTEGER NOT NULL, fingerprint TEXT NOT NULL,
      PRIMARY KEY (source_id, event_id),
      UNIQUE (source_id, sequence))""")
    return con


def claim(db_path: Path, receipt: Receipt):
    """Atomic local receipt claim. Success is NEVER a trading authorization."""
    digest = receipt.fingerprint()
    con = connect(db_path)
    try:
        con.execute("BEGIN IMMEDIATE")
        prior = con.execute(
            "SELECT fingerprint FROM receipts WHERE source_id=? AND event_id=?",
            (receipt.source_id, receipt.event_id)).fetchone()
        if prior is not None:
            outcome = ("REJECT_RECEIPT_REPLAY" if prior[0] == digest
                       else "REJECT_RECEIPT_CONFLICT")
        else:
            last = con.execute("SELECT last_sequence FROM source_cursor WHERE source_id=?",
                               (receipt.source_id,)).fetchone()
            last_seq = last[0] if last else 0
            if receipt.sequence <= last_seq:
                outcome = "REJECT_SEQUENCE_OUT_OF_ORDER"
            elif receipt.sequence != last_seq + 1:
                outcome = "REJECT_SEQUENCE_GAP"
            else:
                con.execute("INSERT INTO receipts VALUES (?,?,?,?)",
                            (receipt.source_id, receipt.event_id, receipt.sequence, digest))
                con.execute("""INSERT INTO source_cursor VALUES (?,?)
                  ON CONFLICT(source_id) DO UPDATE SET last_sequence=excluded.last_sequence""",
                            (receipt.source_id, receipt.sequence))
                outcome = "RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED"
        con.execute("COMMIT")
        return outcome
    except Exception:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def snapshot(db_path: Path):
    con = connect(db_path)
    try:
        return {
            "receipts": [list(x) for x in con.execute(
                "SELECT source_id,event_id,sequence,fingerprint FROM receipts "
                "ORDER BY source_id,sequence")],
            "cursors": [list(x) for x in con.execute(
                "SELECT source_id,last_sequence FROM source_cursor ORDER BY source_id")],
        }
    finally:
        con.close()


if __name__ == "__main__":
    # The CLI only accepts explicitly synthetic research receipts.
    if len(sys.argv) != 4 or sys.argv[1] != "synthetic-claim":
        raise SystemExit("usage: script synthetic-claim <research-db-path> <receipt-json>")
    record = json.loads(sys.argv[3])
    if record.pop("research_synthetic_only", None) is not True:
        raise SystemExit("REJECT_NON_SYNTHETIC_RECEIPT")
    print(claim(Path(sys.argv[2]), Receipt(**record)))
