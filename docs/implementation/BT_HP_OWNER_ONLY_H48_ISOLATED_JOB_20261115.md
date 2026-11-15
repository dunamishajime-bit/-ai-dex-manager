# BT #481 — Owner-only opt-in isolated H48 research job (2026-11-15)

## Explicit scope

The BT page may POST a **single, bounded H48 study** to `/api/bt-verification/simulate`, which returns an ephemeral Replay JSON computed from the deterministic 23-symbol artificial input feed. This is not a source-backed STABLE4 production-equivalent engine or a scheduled worker; no live order/trade/STOP API is accessed.

### Strict authorization and fail-closed behavior

- Auth is mandatory using the existing signed Owner session with USER/ADMIN purpose. Missing/invalid cookies are rejected (HTTP 401).
- Request Origin must match the explicitly configured `DISDEX_BT_ORIGIN`. It must be HTTPS unless the host is localhost; there is no trust-by-Host fallback (HTTP 403).
- `DISDEX_BT_SANDBOX_JOBS_ENABLED=1` must be set explicitly; the code defaults to disabled and has **not** enabled the flag in production, VPS or PC services (HTTP 503).
- JSON required, body no more than 4096 bytes. Only four exact input fields are accepted: `mode="H48_23SYM_CANDIDATE_RESEARCH_ONLY"`, uint32 seed, scenario among trend/range/down/volatile, 10 or 30 bps. Unknown fields, file paths, mode=full-STABLE4, arbitrary code and unexpected scenarios are denied (HTTP 400).
- The server creates a Replay with `mode=DEMO`, `source.kind=SYNTHETIC_MULTI_ASSET_H48_CANDIDATE`; schema is checked before responding, with `Cache-Control: private, no-store`, sourceMode=research-only, production parity=not certified.
- This code does not write any data to owner storage. The pre-existing owner archive save/download path remains independent, with its own authentication and quota requirements.
- No external endpoint, exchange, mutable strategy pin, local executable command, SSH, root key or LIVE environment variable is used by the simulator.

### Client UI

In BT verification configuration, select `23銘柄OHLCV → H48候補研究` and then `Owner限定の隔離研究ジョブを実行`. The result, when authorized and explicitly enabled by the operator, is validated and displayed as a synthetic research replay. If the server job feature is disabled, an explicit notice explains the rejection and the existing browser-only simulator remains available.

### Tests

- `scripts/bt-hp-server-job-selftest.ts`: bounded input schema, permitted H48, correctly rejected unsupported native/full strategies and excess fields, output provenance and 2,880 modeled frames.
- `scripts/bt-hp-server-job-http-selftest.ts`: separate ephemeral signed Owner session test, HTTP 401 unauthenticated, 403 CSRF/disallowed or absent configured origin, 503 disabled by default, 400 unsupported job/invalid size/content, 200 for the explicitly enabled research-only H48 simulator and 2,880 valid model frames. Does not use real production credentials or start a server.
- TypeScript check and Next.js production build PASS in isolated BT worktree.

### Still not complete

This endpoint is a bounded **synchronous** research-only computation, not a full 6-month seven-runner worker queue. Configuring persistence for owner-only VPS, complete exchange-calendar data, trustworthy native runner SHA, Layer1/2/3, Gross/shared risk and real-source economic parity, rate limits, multi-worker job coordination, end-to-end browser tests and approved staging/production release are still independent tasks. Do not enable full-STABLE4 or expose anonymous execution without those gates.
