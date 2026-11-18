# BT-481-H: offline source-candidate observation contract (2026-11-16)

This is an **isolated data contract**, not a complete seven-family native signal engine or a six-month integrated BT. The script validates caller-supplied source observations; it does not manufacture any entry, fill, return, position or portfolio event.

Usage: `python scripts/bt-hp-unified-candidate-observation-ledger.py input.json output.json`. Input has `cutoffTs`, `sourceManifest` (family -> original SHA256), and `observations`. Each row requires id, family, runner, symbol, sourceSha256, sourcePath, stage, decision, eventTs and availableAtTs. It validates seven families (V4, Q102, PENGU, FET, IDLE, V52, HYPE), timestamp causality and pin matching. `FEATURE_ONLY` is not a signal; `SOURCE_CANDIDATE` is not a fill; `RESEARCH_RULE_SELECTED` is Q102 only and not an entry; `ENTRY_VERIFIED` requires an independent nativeEntryProof. All execution/position/PnL fields are rejected. Deterministic canonical JSON SHA256 and per-family counts make the ledger auditable.

The selftest uses eight **engineered fixture observations**, no actual candidate signals or profits. Before BT-481-H can be considered fully integrated, each native adapter must supply source-pinned causal rows with separately verified entry decisions. The Q102 180d selector still lacks complete actual native S1/S2 closed-trade training history. Do not promote a research-selected rule to LIVE or to an artificial fill.

Test: `python scripts/bt-hp-unified-candidate-observation-ledger-selftest.py`. No VPS, LIVE, Codex branch, STOP, order, HP deploy or master merge touched.
