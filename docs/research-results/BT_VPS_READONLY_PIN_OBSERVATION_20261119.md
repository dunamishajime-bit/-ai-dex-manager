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