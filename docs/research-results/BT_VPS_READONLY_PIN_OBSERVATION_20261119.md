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