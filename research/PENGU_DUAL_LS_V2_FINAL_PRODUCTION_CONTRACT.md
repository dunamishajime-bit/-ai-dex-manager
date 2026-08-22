# PENGU_DUAL_LS_V2_FINAL production contract

This document records the immutable production contract implemented from the
frozen handoff on `handoff/v52-pengu-v2-live-completion-20260811`.

- Production strategy ID: `PENGU_DUAL_LS_V2_FINAL`
- Decision data: completed one-hour PENGUUSDT and BTCUSDT candles
- Entry: next one-hour candle open; entries older than five minutes are blocked
- Priority: Short over Long on the same decision candle
- Position policy: one PENGU position, no pyramiding, no averaging, no reversal
- Cooldown: six hours after a completed exit
- Gross: `clip(0.75 * 0.02 / ATR24Ratio, 0.60, 0.75)`
- Durable isolation: dedicated V2 state directory and lock
- Legacy order ownership: V46 Core and Dual LS V1 are disabled; their source is
  retained only for rollback
- Shared safety: Portfolio Daily Loss, Portfolio Gross, Kill Switch, open-order
  reconciliation and managed-position reconciliation remain mandatory

The independent production/research parity command is:

```text
npm run strategy:pengu-dual-ls-v2:parity
```

It downloads the untouched, fixed Bitget USDT perpetual evaluation period,
runs an independent translation of the frozen research algorithm and the
production engine, and compares every trade's side, entry/exit time,
entry/exit price, Gross, net return and exit reason.

Frozen Bitget acceptance values:

- 33 trades
- compounded return: +147.49%
- profit factor: 2.990
- maximum drawdown: -11.31%

Any ledger mismatch or aggregate mismatch fails closed. The parity command
never sends, cancels or changes an order or position.
