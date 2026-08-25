# PENGU Short V20 production contract

This contract layers the preregistered Short-only candidate
`COUNTERWIND_VOL_TARGET_FAILURE_EXIT` onto the frozen
`PENGU_DUAL_LS_V2_FINAL` runner.

- Source of truth: `scripts/research_pengu_short_v20_vol_target_failure_exit.py`
- V20 pre-registration SHA: `ad7cedb3cafaf9f9680e390112f72375d84b50ac`
- Parent V18 pre-registration SHA: `42bb6297d893125ad3b2de0a9e26dba342852223`
- Long signal, sizing, exits and state transitions: unchanged
- New Short entries: persisted with `entryVersion=SHORT_V20`
- Pre-existing V2 positions without explicit lineage: `LEGACY_V2`; V20 is never inferred after restart

The only strategy change is the frozen V20 branch after a counterwind Short's
progression failure has been confirmed on a completed H1 candle:

- `VOL_TARGET`: full position exit at the next H1 open;
- `CAP` and `FLOOR`: frozen V18 probation-to-deadline lifecycle;
- thesis resumption is recorded as state and does not create an additional leg.

The baseline hard stop, trailing stop, max hold, entry eligibility, cooldown,
shared risk gates, fee accounting and funding accounting remain in the V2
runner. A missing, malformed or mismatched V20 state fails closed through the
existing reconciliation/manual-review path.

Validation commands:

```text
npm run strategy:pengu-dual-ls-v2:short-v20:typecheck
npm run strategy:pengu-dual-ls-v2:selftest
npm run strategy:pengu-dual-ls-v2:short-v20:selftest
```

These tests are offline and send no orders, cancellations or position changes.
