# VPS read-only runtime pin observation (2026-11-19 JST)
Status: READ-ONLY OBSERVATION, NOT production-parity certification.
Connection: owner PC Desktop/DisDex.pem, SSH root, strict known host verification; key not copied.
Evidence command family: readlink -f /home/deploy/disdex-trading/current; systemctl list-units --all; systemctl show ... -p WorkingDirectory -p ActiveState.
- VPS host SSH confirmed, no write commands issued.
- current symlink: /home/deploy/disdex-trading/releases/7688ed7c93a1918d8b44837339b7da5584a868f5
- Active FET BRK48 service pin: 7688ed7c93a1918d8b44837339b7da5584a868f5
- Active IDLE service pin: 7688ed7c93a1918d8b44837339b7da5584a868f5
- Active HYPE service pin: e0e4f1d8f22b62e9410188ef6e590a20e31f760f
- Active PENGU service pin: 1657e173d250ad58f53e62f7bb0a3428fb405496
- The old HYPE @7688ed7c service is inactive.
- The old PENGU @7688ed7c service is inactive.
- PENGU systemctl show WorkingDirectory resolves to the pinned 1657e173... immutable release.
- Numerous historic failed HYPE scoped cutover transient units appear in systemctl; this alone does not establish a current runner failure.
- FET preemption readiness audit unit was listed failed; separate operational investigation is required and not part of BT mutation.
## Critical parity consequence
The current symlink is NOT a single complete active-runner pin. At least HYPE and PENGU are running from other immutable releases. Any baseline BT that uses current symlink only, or treats STABLE4 research source as current runtime, fails exact production-parity gate.
## Next read-only evidence
Collect remaining active V4/Q102/V52/shared risk unit pins and relevant executable source hashes, compare with research source SHA per runner; never read credentials or change orders/STOP/Runner state.
## Extended live service snapshot (same read-only session)
The following running systemd service instances were additionally observed:
- V4 production: e788abc82e80f9fc7ab0e1ba83fdb8be267eb513
- Q102 causal: ef1ab178e26a7bf5bddb6473467765edba242e1d
- V52 Aster-only: 8495daf24e53a6cf0dd5e38f022008fa8f78c688
- Shared Crypto Risk refresher: 2737c30e1f6d014d24a2c6d025e7f91332bf7962
- Margin Guard: 7688ed7c93a1918d8b44837339b7da5584a868f5
- V52 monitor (read-only): 0d955214a4aeeb7481bced711e1df7f163d2d25c
- V4 rate budget broker: multiple concurrent active SHA-tagged units (including e788abc82...); exact runtime authority and overlap NOT established.
These are service instance names with running state, not independent proof of trade permission, actual source execution parity, healthy orders or certified backtest. Confirm ExecStart/WorkingDirectory, immutable release source content and strategy-to-route mapping before reproducing BT. No mutation performed.
## Eight entrypoint file SHA256 verification
Compared VPS release entrypoint SHA256 to owner PC Git SHA blobs. Six TypeScript entries match exactly after LF-to-CRLF normalization; Q102 and V52 match raw bytes. Verified: V4, Q102, V52, PENGU, HYPE, Shared Risk, FET, IDLE. This is entrypoint-only parity, NOT full imported-module/config/execution/BT parity.
At subsequent systemctl show, V52 service ActiveState=activating and previous ExecStart exited status=1, despite an earlier running snapshot. Requires separate read-only diagnosis; no service changes made.
## Normalized source parity validation / V52 instability (additional read-only observation)
- Eight selected entrypoint files compare with pinned Git blobs: Q102/V52 EXACT_BYTES, V4/PENGU/HYPE/SharedRisk/FET/IDLE NEWLINE_OR_BOM_ONLY.
- VPS files for the six newline-only cases use CRLF while Git blobs use LF; normalized content is identical, with no substantive entrypoint-code differences in these inspected files.
- Reproducible read-only verifier and seven unit tests: scripts/research/verify_bt_vps_runner_sources.py and tests/test_bt_vps_runner_sources.py.
- Captured one successful eight-entrypoint check in docs/research-results/BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json; report explicitly sets production_bt_parity_certified=false.
- During earlier sampling, V52 was absent from the active-running service list; verifier correctly failed closed.
- Subsequent V52 systemd sampling returned active/running with NRestarts=2277 and RestartUSec=30s. Transient successful check is NOT proof of sustained V52 health.
- This verifies selected entrypoint files only, NOT imported source dependencies, weights, market data, model fills, exits or full 8-runner BT parity.
## STABLE4 modeled fill provenance vs observed LIVE (separate reproducible gate)
- The read-only source audit (scripts/research/audit_bt_stable4_live_source_pins.py) compares each historical research source SHA to observed live service SHA and saves docs/research-results/BT_STABLE4_VS_LIVE_SOURCE_20261119_UNCERTIFIED.json.
- Historical 10bps exits: 806/1,027 (78.481013%) have SHA different from the corresponding current LIVE runner; V4 and HYPE.
- Historical 30bps exits: 802/1,023 (78.396872%) have SHA different from current LIVE runner; V4 and HYPE.
- A source SHA match for the other modeled groups does NOT prove parity: exit approximations, priorities, market data, shared risk, Gross and funding remain unverified. Do not promote research to certified production BT.
- Dedicated BT CI runs Python parity tests, research mismatch audit, BT replay tests, TypeScript typecheck and Next.js build, without VPS credentials or deploy permissions.