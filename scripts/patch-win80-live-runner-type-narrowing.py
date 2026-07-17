#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "lib" / "win80-ultra90-live-runner.ts"
text = path.read_text(encoding="utf-8")
replacements = {
    'return { status: pending.phase === "manual_review" ? "manual-review" : "held", message: "Source sell status is still unknown.", idempotencyKey: pending.idempotencyKey };':
    'return { status: state.pending?.phase === "manual_review" ? "manual-review" : "held", message: "Source sell status is still unknown.", idempotencyKey: pending.idempotencyKey };',
    'return { status: pending.phase === "manual_review" ? "manual-review" : "held", message: "Target buy status is still unknown.", idempotencyKey: pending.idempotencyKey };':
    'return { status: state.pending?.phase === "manual_review" ? "manual-review" : "held", message: "Target buy status is still unknown.", idempotencyKey: pending.idempotencyKey };',
}

for old, new in replacements.items():
    if new in text:
        continue
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match for type-narrowing patch, found {count}: {old}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("WIN80_LIVE_RUNNER_TYPE_NARROWING_PATCH_OK")
