# Strict BT #33404708902 production-parity audit

## Source of Truth

- GitHub Actions Run: `33404708902`
- Source SHA: `aec066fefd761b12f07e6927b5f2a524f88ca08b`
- Workflow: `Quality102 Exact MTM 50 One-Year BT`
- Scope: research/backtest contract only. This branch does not activate LIVE execution or deploy to VPS.

The source workflow uses a frozen Quality102 evidence CSV and the research-only MTM runner. The CSV is valid as historical evidence for that backtest, but it is not a causal LIVE signal selector.

## Implemented shared contracts

`lib/disdex-strict-portfolio-planner.ts` is side-effect free and produces an execution plan without calling an exchange or mutating runner state. It validates positive/fresh market and position data, unique ownership, known strategy/symbol mapping, duplicate idempotency keys, and the global caps before returning a plan.

The policy is:

- V52, PENGU, and V12 are admitted before Quality102.
- V12 is limited to one position and `1.50x` total strategy Gross.
- PENGU is limited to `0.75x` Gross.
- Quality102 is limited to one slot and `0.50x` Gross.
- Crypto Gross is `V12 + PENGU + Quality102` and is capped at `2.00x`.
- Stock Gross is capped at `1.50x`; Total Gross is capped at `2.50x`.
- A Quality102 intent is rejected with `QUALITY102_LIVE_BLOCKED_FAIL_CLOSED` until an approved causal selector manifest exists.

When a base strategy needs capacity from an active Quality102 position, the planner emits a `MARK_TO_MARKET_REALIZED_PNL` reduction. The reduced quantity is valued at the supplied decision-time mark, side-adjusted price PnL is realized, fee/funding inputs are charged once, and the remaining quantity keeps its average entry price. A zero-PnL trim is not used.

## Quality102 LIVE decision

`lib/disdex-quality102-live-selector.ts` intentionally returns:

```text
QUALITY102_LIVE_SELECTOR_PARITY=FALSE
QUALITY102_LIVE_BLOCKED_FAIL_CLOSED=TRUE
```

The gate only accepts an explicitly identified dynamic selector with a no-lookahead proof, source lineage, no fixed historical timestamps, and data availability at the decision timestamp. The current Source Run does not provide that production selector: it provides frozen historical evidence. Therefore no guessed selector, embedded event list, or historical CSV is wired into LIVE.

## Safety and regression status

The existing V12, PENGU, and V52/V96 activation gates remain in place. Runner telemetry reports the Quality102 blocked state but does not enable order submission. No synthetic, test, or real LIVE order is created by this implementation; no VPS or production process is changed.

The focused runner typechecks and strategy self-tests are the relevant verification targets. The repository-wide Next typecheck currently contains unrelated pre-existing SimpleWebAuthn route errors; those are recorded separately from this strict-parity change and are not bypassed by weakening a safety gate.
