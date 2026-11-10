# Production logic parity audit — 2026-11-10

## Verdict

The previously labeled final causal-conservative BT is **not a current Production-logic parity backtest**.

It intentionally:
- removed the 1,394 current V4 V2 body candidates,
- retained only the native FAILED_BREAK core,
- added three research gates that are not present in the current Production pins.

Therefore its DD / win-rate / final-equity values must not be used as a statement of current Production behavior.

A separate Production-logic-parity audit replay was built with:
- research three-gates disabled,
- current formal runner pins,
- current formal Gross caps,
- current V4/PENGU/Q102 native lifecycle artifacts,
- Q102 HIGH_VOL added from the live V4 signal builder,
- period-end open exposure marked to market instead of force-closed.

## Research gates found NOT to be current Production logic

The prior final BT applied:

1. IDLE JUP: `rel24 >= -0.04089204262472046`
2. PENGU Recovery V8: `btc24h <= 0.011611625094354983`
3. Q102 FET: `ret14 <= 0.048722800378429465`

Audit result:
- IDLE Production pin has no exact JUP threshold above.
- PENGU Recovery V8 Production uses BTC **6h** minimum `0.20571786048402818%`, not the research BTC24 gate.
- Q102 Production S34/FET feature gates do not contain the research `0.048722800378429465` threshold.

Status: **all three were research-only, not Production parity**.

## Formal risk/gross contract

The formal all-runner order-enable manifest requires:

- Crypto Gross = 3.0x
- Stock Gross = 1.5x
- Total Gross = 3.5x
- Shared crypto daily loss = 7.5%

The formal deploy script reads the effective runtime env and fails closed if:
- `CRYPTO_GROSS_CAP`
- `STOCK_GROSS_CAP`
- `TOTAL_GROSS_CAP`
- `DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT`

do not exactly match the manifest.

Therefore the BT's 3.0 / 1.5 / 3.5 / 7.5 values are correct for the formal activation contract, even though older runner-pin source modules still contain legacy 4.25 / 4.0 values.

## Runner-by-runner audit

| Runner | Entry parity | Exit parity | Audit status |
|---|---|---|---|
| V4 | Current economic blobs match Production pin; V2 body retained in parity replay | Native lifecycle artifact used | IMPLEMENTATION-PARITY, but historical V2 selection is hindsight contaminated |
| PENGU | Production signal body matches; Recovery V8 uses current BTC6h rule | Native lifecycle artifact used | STRONG PARITY; research BTC24 gate removed |
| Q102 | S34 + HIGH_VOL live V4 builder | Native S34 lifecycle + Production HIGH_VOL 72h/hard-stop/12%-5% trail | STRONGER PARITY; adopted three-exit effective env still unverified |
| FET | Production pin source | Native 5m model | ENTRY PARITY / EXIT APPROXIMATION |
| IDLE | Production pin source | Native 5m model | ENTRY PARITY / EXIT APPROXIMATION |
| HYPE | Signal/policy economic logic matches current pin | Modeled hard-stop/TP rather than signed venue execution | LOGIC PARITY / EXECUTION MODEL |
| V52 | V50 policy config blob is identical between BT and Production pin | Historical price proxy | NOT EXECUTABLE-BOOK PARITY |
| RESIDUAL | Native source | 79 historical exit-model gaps | MATERIAL NON-PARITY |

### V4

Current Production V4 pin:
`53a0be396719f0284af4e11b35c66a4ac7d58f79`

The V4 source/feature/native-core/V2-shadow/sizing blobs used by the prior reconstruction match the Production economic implementation. Lifecycle differences between the earlier BT pin and Production pin are operational/review-state changes rather than the main entry/STOP/TP sizing rules.

However the 1,394 historical V2 body candidates were selected by a retrospective V2 policy built with realized-period outcomes. This can reproduce current implementation shape, but it cannot establish causal historical performance.

### PENGU

Current Production pin:
`7688ed7c93a1918d8b44837339b7da5584a868f5`

The main signal blob is the same as the later BT source blob. Recovery V8 Production entry uses:
- RSI delta threshold,
- EMA168 distance threshold,
- BTC 6h minimum `0.20571786048402818%`,
- 0.5x initial gross,
- 6% hard stop,
- 72h max hold,
- partial defense defined in current V8 config.

The prior BTC24 research gate is not Production logic.

### Q102

Current Production pin:
`ef1ab178e26a7bf5bddb6473467765edba242e1d`

Important correction from the audit:
- The generic V1 signal helper is HIGH_VOL-only.
- The actual LIVE entrypoint injects `buildQuality102CausalV4Signal()`, so Production uses HIGH_VOL plus S34 PB/MR/BRK/REV.

The previously saved HIGH_VOL reconstruction had been marked 19/19 mismatch only because it was compared against the wrong helper. It was rechecked against the **actual live V4 builder**:

**19 / 19 PASS.**

Production HIGH_VOL exit replay:
- candidates: 19
- LONG: 6
- SHORT: 13
- 72h time: 12
- hard stop: 6
- 12%-then-5% trail: 1

There were zero exact-entry-timestamp collisions between those 19 HIGH_VOL rows and the selected S34 tape.

In the integrated parity replay, 8 HIGH_VOL trades were admitted after Q102 one-slot/shared-wallet blocking.

The three explicitly adopted Q102 exit overlays are source-gated by:
- `QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ENABLED=true`
- `QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ACK=<exact runtime SHA>`
- existing profit-floor enablement

The effective VPS env was not available through the connected tools, so effective ON/OFF is not certified here.

### FET / IDLE

The source tapes are generated from Production pin `7688ed...`.

Their 5m exit audit explicitly records remaining approximations:
- live stop replacement and quote checks approximated,
- no signed real fills,
- FET trailing-policy enabled state was not read from VPS and was assumed enabled.

FET:
- 11 raw / 11 modeled
- exit reasons: 7 protected stop, 4 max hold

IDLE:
- 183 raw / 183 modeled
- exit reasons: 31 hard stop, 152 max hold

### HYPE

The historical candidate source SHA differs from the formal runner pin, but the audited HYPE trend signal/policy economic blobs match current Production logic. Production also applies the post-fill wallet-risk protective stop. Historical execution remains modeled rather than signed venue execution.

### V52

Production pin:
`4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81`

BT-source pin:
`8495daf24e53a6cf0dd5e38f022008fa8f78c688`

The V50 runtime policy JSON is identical at both pins:
`V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20`.

The runner source blob differs, and the historical BT still lacks the exact executable historical book / venue-fill record. V52 is therefore a price-model proxy, not full Production execution parity.

### RESIDUAL

The parity replay still has **79 missing historical exit models**. Those rows fail closed in the BT. This is a material limitation because Production would not necessarily have blocked the same opportunities.

## Corrected Production-logic-parity audit replay

Research gates: OFF.

V4 current body: ON.

Q102:
- S34 selected lifecycle: ON
- HIGH_VOL live-builder rows: ON

Formal Gross:
- Crypto 3.0x
- Stock 1.5x
- Total 3.5x

Shared daily loss:
- 7.5%

Period:
- 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC, end-exclusive.

One HIGH_VOL position remains open at period end and is marked to market; it is not force-closed.

| Cost | Final MTM equity | Max DD | Closed fills | Win rate | PF | Open at end |
|---:|---:|---:|---:|---:|---:|---:|
| 10bps | **JPY 1,609,153.26** | **-63.3388%** | 847 | 60.0945% | 1.1806 | 1 |
| 30bps | **JPY 512,841.94** | **-69.9388%** | 847 | 57.1429% | 1.1325 | 1 |

Admitted by runner:
- V4 426
- IDLE 119
- Q102 99
- V52 77
- PENGU 61
- HYPE 42
- RESIDUAL 17
- FET 7

Q102 admitted HIGH_VOL fills: 8.

Major blocks:
- SYMBOL_BUSY 615
- RESIDUAL_FORMAL_BASELINE_OPEN 549
- RUNNER_SLOT_BUSY 467
- DAILY_LOSS_7P5_GATE 160
- CRYPTO_GROSS_CAP 66
- TOTAL_GROSS_CAP 14

## Determinism

The Production-parity audit was rerun independently.

All 8 core artifacts matched byte-for-byte SHA256:
- 10bps SUMMARY
- 10bps FILLS
- 10bps DECISIONS
- 10bps EQUITY_30MIN
- 30bps SUMMARY
- 30bps FILLS
- 30bps DECISIONS
- 30bps EQUITY_30MIN

Status: **PASS**.

## Final classification

The previous causal-conservative final BT should be relabeled:

**RESEARCH IMPROVEMENT BT — NOT CURRENT PRODUCTION LOGIC**

The new audit replay should be classified:

**PRODUCTION-LOGIC-PARITY-ORIENTED REPLAY — NOT FULL EXECUTION CERTIFICATION**

It is materially closer to current Production logic, but full parity cannot be claimed until:
1. Q102 adopted-exit effective VPS env is read and replayed exactly.
2. FET trailing effective VPS state is verified.
3. RESIDUAL 79 missing exits are reconstructed.
4. V52 historical executable-book / fill evidence is recovered or the proxy limitation is accepted.
5. Signed historical venue fills are available for exact execution/slippage parity.

No LIVE/Production mutation was performed by this audit.
