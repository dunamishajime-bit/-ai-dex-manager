# DisDex BT HP — canonical execution gate and event-level portfolio contract
Date: 2026-11-14
Status: DESIGN_GATE_SOURCE_REVIEWED / NOT_CONNECTED / NOT_DEPLOYED

## Grounded state

The 2026-11-14 STABLE4 research is built from chained Python scripts that dynamically patch source text, then execute the resulting research variant. Example source: build_stable4_hype6_validation_20261114.py, which reads another script and rewrites HYPE model candidate logic. A prior effective-current wrapper portfolio_effective_current_canonical_parity_20261111.py explicitly warns that its V52 historical proxy is not executable-book parity and that its V4 population was retrospectively selected.

Therefore neither a historical CSV nor a research SHA label proves that an arbitrary new web BT would execute **the exact current pinned strategies**. The HP must not simply invoke whichever local study file is newest and call it a canonical BT.

## Safe architecture

1. Owner-approved, isolated offline BT worker, with no exchange private keys, no LIVE runner configuration, no order endpoints, no production STOP/kill-switch mutations, no writable live state and no ability to access Production API clients.
2. An immutable registry of **certified engine SHA and per-strategy immutable source SHA**. Each entry must have reproducible parity tests and signed owner-controlled promotion; display source date separately from latest LIVE pin.
3. A request contract, including requested date range [start, end), target logic subset, selected symbol subset, mode (HISTORICAL vs SYNTHETIC), fixed seed for synthetic, 10/30bps model, initial equity, exact Total/Crypto/Stock caps, Shared Risk, effective ruleset SHA and data cutoff. Distinguish a display filter from an actual new counterfactual BT run.
4. The worker emits immutable chronological event-level records (intent, accepted/rejected order, actual *modeled* fill, partial close, funding, exit, fees, STOP and risk gates) with trace IDs, source hashes and a unique deterministic input fingerprint.
5. On every event: before/after position inventory (trade_id, owner logic, symbol, direction, quantity, entry, mark, mark source/time, notional, position Gross x), exact equity/margin base, category/Total Gross used/remaining, pending exposure, source risk limits and decision rationale.
6. Reconcile at each event: Total Gross ~= Crypto Gross + Stock Gross (within documented float rounding), individual position Gross sum + legitimate reserved exposure ~= sourced Gross when an exact per-position ledger exists. A mismatch must be flagged instead of adjusted by an invented residual.
7. Build replay snapshots and archive manifest with hashes of input raw market streams, runner pins, engine source, config and model costs. Distinguish modeled trades from signed venue fills. Deterministic rerun with identical inputs must produce the same ledger digest.

## Gross display invariants

- Show B (x used/x allowed) primary and A (% of that explicitly named cap) secondary.
- A position's share of **used Total Gross** and fraction of **Total Gross cap** have DIFFERENT denominators and must be labeled.
- If exact individual current Gross is unknown, the current total still comes from authentic equity source; position entries show unknown current value and their historical entry Gross in a separate clearly labeled reference lane. Do not recolor the current primary bar with entry Gross.
- Different research scenarios have different source total/stock caps; use matched source manifest, NEVER fixed caps across all runs.
- In a time-series portfolio view, applying a symbol/logic display filter cannot alter the aggregated Gross based on the full account.
- Q102 model fills may include terminal open positions past end of selected window. Do not fabricate their closing event after the end-of-period timestamp.

## Critical blocking gates

G1. Obtain a concrete canonical engine entry point and its deterministic immutable version. Current source wrappers contain research proxies and do not meet this on their own.

G2. Prove the exact latest logic implementations (e.g. STABLE4 / V4 / PENGU / Q102 / HYPE / FET / IDLE / V52), cross-runner arbiter and all exit/STOP variants with no historical lookahead. Validate pin inventory with current GitHub/source manifest, not from saved memory.

G3. Export event-level position mark/quantity/funding/fee/STOP/partial and Gross-at-time records. Existing 11/13-11/14 research fills have blank signed actual quantities, so replay cannot currently satisfy this gate.

G4. Unit, property, cross-account concurrency, full-year deterministic replay and cost/STOP parity tests PASS. Independently recompute Gross and equity on representative intervals and every sampled event with explicit tolerance.

G5. Owner-authenticated job submission, snapshot isolation, disk quotas, idempotent job names, cancellation, saved-result permissions, source chain-of-custody and 2FA deployment approval. Absolutely no trading or owner-auth bypass via a BT route.

G6. Browser E2E for desktop/mobile showing balance rise/fall while BTC candle/marker and position/Gross bar track the same simulation time. Verify user-provided ZIP exports re-import correctly in Codex/GPT.

## Not enabled

HP button BT再生 currently replays DEMO or already generated RESEARCH_MODE JSON. It is **not** BT新規計算. The site does not schedule the source scripts as executable Production jobs. Do not advertise canonical parity or remove the "研究・未検証" badge until G1-G6 succeed.

## Existing evidence and tests

- PR #481 includes the playback page, browser JSON/ZIP export, secure archive *prepared but not Production configured*, 10/30bps source Gross-cap validation, model funding/partial events, 4 existing 11/14 research replay packages.
- Node/TypeScript and Python tests cover replay import validation, ZIP integrity, source date no-lookahead, matched Gross caps, simultaneous partial+final exits and synthetic Owner-auth API isolation.
- Do not put any user PC private data, API credentials, trading-account details or raw research dumps into Git history.

Owner handoff: install immutable canonical engine on an isolated host only after proving G1-G6, then add authenticated POST /api/bt-verification/jobs and replay GET with immutable provenance. No automatic merge, LIVE switch or token access is part of this document.
\nNote: owner-archive POST/DELETE also require operator-configured DISDEX_BT_ORIGIN; without it, writes fail closed even with a signed session. Model-uploaded self-claims of certified strategy pin are rejected until server-signed certification is implemented.\n