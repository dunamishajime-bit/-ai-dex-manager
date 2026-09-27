# Formal five-logic BT — verified resumption state (2026-09-27)

This is an operational research status, **not** a completed backtest or a
production deployment approval. Git branch:
`codex/formal-five-logic-bt-20260926`.

## New source/engine evidence

- Reconstructed all 90 explicitly allowlisted runtime files **without
  modifying the original audit manifest** from
  `a09ea45ca3cbd72100f9eb0eaae499039c40b6a0`. Their SHA256 values match
  the audited source digest `e1b58060d6263a3af7ced51bec854d3e211d2f35`.
  The source-reconstruction CI and the six actual TypeScript decision
  bridge/parity tests passed.
- Added a timestamp-causal Yahoo Finance historical 60m adapter for AMZN,
  META, MSFT, NVDA and TSLA. A hypothetical price fill is possible only after
  a verified V52 SIGNAL from the historical LIVE decision layer, on an official
  open NYSE session, at the last **completed** same-session candle close
  no more than 15 minutes old. The first 50 days stay omitted.
  This is a **modeled price-only entry**, not an Aster-verified trade.
- Integrated optional V52 audited decision rows and Yahoo data under the
  existing NORMAL/SEVERE × PROXY_APPLIED/ASTER_DATA_ONLY four-scenario engine.
  `MODELED_PRICE_FILL` appears separately from `fills_verified`; all
  actual P&L, final equity and DD remain null until exit/allocator replay
  and fee/price coverage are verified.
- The isolated Yahoo/execution integration and prior engine regression CI passed.
  The source-snapshot SHA and runtime bridge tests also passed.

## Important live strategy constraint

Audited V52 is not simply a stock momentum strategy. V11_EQ and
V50_POST_OPEN_BASIS depend on the **basis between the Aster stock perpetual
price and a contemporaneous underlying equity reference**. Yahoo equity
candles alone cannot establish an original V52 historical SIGNAL. Historical
Aster stock-perpetual prices (not order-book depth), or existing fully
provenanced live-decision traces, are additionally required to reconstruct
its candidate stream. A book-free execution **assumption** may be used in a
clearly labeled research path without claiming historical order execution.
An hourly Yahoo candle also cannot reveal the true equity price inside
that hour; do not read a future hourly close at a 10:00 NY capture or
11:29:50 NY pre-window capture.

The existing scanner computes historical V12/PENGU/Q102/FET signals using
the audited runtime bridge; it does not yet implement this price-only V52
basis trigger scanner. Do not convert V52 schedule rows into trade counts.

## Verified additional progress (2026-09-27, GitHub Actions 36306205284)

- Official public Aster stock-perpetual historical **1h price** acquisition
  returned 8,784 bars and zero missing post-listing hours for each of
  AMZNUSDT, METAUSDT, MSFTUSDT, NVDAUSDT, TSLAUSDT over the specified year.
  This is **price**, not order-book depth or proof of tradable execution.
- Together with the Yahoo underlying reference 60m series, the independently
  labeled V50 hourly basis research scan completed successfully and reported:
  98 selected **unallocated** candidates, 16 otherwise eligible but not
  highest-ranked candidates, and 3,131 rejected stock-window decisions.
  Rejection reason counts are non-mutually-exclusive: basis below threshold
  2,524; modeled net edge insufficient 2,017; basis sign changed 1,298;
  adverse basis movement 1,277; missing causal input 25.
  No profit was computed; the original LIVE spread, depth, second-level
  same-time price, and shared portfolio gates remain unverified.
- A source-integrity bridge now checks the exact audited runtime SHA, the
  full research decision file SHA256, total/per-status counts, monotonic
  stock-window order, and at most one selected ticker per window. The bridge
  rejects synthetic LIVE-fill or realized-P&L assertions. An optional
  `--v52-research-scan-root` flag now adds these unallocated research
  candidate rows to all four integrated scenario **decision traces** and
  month-level research counts, **without** altering audited LIVE signal
  counts, verified fills, closed trades, final equity, PF or DD.
- Provenance and duplicate-guard unit tests have passed GitHub Actions.
  Separate end-to-end four-scenario research integration regression checks
  were added; verify their workflow run before treating them as passed.

## Current historical-source availability and next implementation gates

The one-year Yahoo coverage job retrieved hourly records for all five
underlyings but detected some missing session hours. The specific
date-level coverage status is recorded in that job; skip uncovered times,
never forward-fill a missing event into a profitable trade. Run coverage
validation after any source refresh.

To complete the user-requested five-strategy integrated BT:

1. Recover the existing private frozen Aster dataset or obtain fresh
   primary 1h data from the public Aster API. Preserve every native
   listing date, bar integrity issue and source hash.
2. Rebuild the missing V52 historical **decision** stream from Yahoo
   reference prices and available contemporaneous Aster stock-perpetual
   prices. Independently identify which live basis/cost gates can or
   cannot be reconstructed under the approved no-L2 price-only assumption;
   label any modified gate model explicitly.
3. Fix Q102's historical invalid candle and as-of walk-forward
   insufficiency without future training leakage; verify all strategy
   signal scans at the audited SHA.
4. Complete the shared planner, historical order lifecycle, matched
   entries/exits, realized and mark-to-market risk, fees, funding, and
   monthly contribution-aware accounting. No candidate is counted as
   a filled or winning trade solely because it passed a strategy gate.
5. Re-run all four unchanged baseline scenarios, report symbol-level
   coverage and skipped trades, then test HC1.75-fixed V12 gate variants
   only after the baseline P&L is valid. Attribute losing entries and
   profitable baseline opportunities displaced by each gate change.

The actual full-year final value, PF, win rate and DD remain
**NOT_VERIFIABLE** at this checkpoint. Do not substitute earlier BT
anchors as if they were outputs of this engine.

## Re-run and CI

```sh
git fetch origin a09ea45ca3cbd72100f9eb0eaae499039c40b6a0
python -m research.formal_five_bt.restore_snapshot
python -m unittest discover -s tests/formal_five_bt -v
python -m research.formal_five_bt.acquire --data-root <local-only-data> --venues aster
python -m research.formal_five_bt.signal_scan --data-root <local-only-data> --output-root <local-only-scans>/baseline-signal-scan --strategies V12 PENGU FET
python -m research.formal_five_bt.signal_scan --data-root <local-only-data> --output-root <local-only-scans>/baseline-signal-scan-q102 --strategies Q102
python -m research.formal_five_bt.yahoo_acquire --output-root <local-only-data>
python -m research.formal_five_bt.engine --data-root <local-only-data> --scan-root <local-only-scans> --l2-root <local-only-l2> --output-root <local-only-run>
```

Do not commit or upload raw historical prices or data-bearing detailed
trades/gate logs to the public repository without verified permission.
No change to live VPS files, runner service state or real orders was made.
