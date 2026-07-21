# Dis-Dex Manager V96 Production Handoff

## Current status

V96 historical research is tracked in PR #56. Production implementation is tracked in PR #58.

- Strategy ID: `DISDEX_V35_STRONG_RESERVED_PENGU_V96`
- V95 Weight Band TypeScript port: **implemented**
- V95 Strong Boost TypeScript port: **implemented**
- Python/TypeScript Golden Vector: **implemented**
- Signal chronology parity: **approved by CI**
- Allocation parity: **approved by CI**
- Aster quantity parity: **approved by CI**
- Restart/recovery parity: **approved by CI**
- Production TypeScript runner: **implemented**
- Aster order route: **implemented**
- Durable V96 state: **implemented**
- VPS/systemd path: **implemented**
- Forward Evidence: **not approved**
- Repository mode: `PAPER`
- Repository LIVE flag: `false`
- VPS deployment: **not performed by this PR**
- Real orders: **not enabled or sent by this PR**

Execution implementation is complete. LIVE remains fail-closed because future Forward Evidence has not yet been collected and approved.

## Frozen V96 contract

- PENGU target Gross: `1.15`
- Total Gross cap: `2.0`
- Minimum active PENGU clip: `0.50`
- Reserve at least 50% of the active PENGU target before assigning Core Gross
- Scale Core only when required by the reservation and total Gross cap
- Weight Band tolerance: `0.05`
- Portfolio turnover threshold: `0.20`
- Forced Weight Band refresh: `12` completed 12-hour bars
- Strong Boost: `+30%`
- Strong Boost requires completed 12-hour features:
  - BTC regime positive
  - close above SMA20
  - momentum20 at least 15%
  - momentum3 at least 0%
  - shock at least -4%
  - downside skew no greater than 1.35
  - prior stabilized breadth at least 2
  - no active drawdown brake
  - no active whipsaw guard
  - controlled drawdown better than -5%

## V95 Core TypeScript implementation

`lib/disdex-v95-core-controller.ts` ports the frozen V90/V86 behavior:

1. entry, exit and direction/signature changes are immediate;
2. same-direction per-symbol changes below 5% are ignored;
3. eligible changes require portfolio turnover of at least 20%, unless the 12-bar forced refresh is reached;
4. drawdown stages use the frozen V83 settings;
5. whipsaw detection uses the frozen V84 settings;
6. Strong Boost adds 30% only when all frozen gates pass;
7. Core Gross is capped at 2.0.

`lib/disdex-v95-core-signal.ts` replays completed common 12-hour V35 Core bars and applies the controller. An incomplete current candle is excluded, and an unobserved future return is forced to zero.

`lib/disdex-v96-combined-signal.ts` now uses the V95 controlled Core target before applying the V96 reserved-PENGU allocator.

## Golden Vector and parity evidence

The parity chain is:

1. `scripts/disdex_v95_golden_vector_generator.py` generates frozen Python vectors using the V90 `stabilize` and V86 `controlled_core` rules;
2. `scripts/disdex-v95-golden-parity.ts` runs the TypeScript controller on the same vectors;
3. every target, state transition, scale, return and diagnostic is compared with numeric tolerance;
4. CI requires Weight Band rebalance, Strong Boost, Whipsaw and drawdown stage 2 to be exercised;
5. `scripts/disdex-v96-production-selftest.ts` separately validates chronology, allocation, quantity conversion and durable-state recovery;
6. `scripts/disdex-v96-write-execution-parity-approval.ts` writes a SHA-bound approval manifest containing the configuration fingerprint, research commit, Production commit and golden-vector artifact hash.

CI uploads:

- `.runtime-state/disdex-v95-golden.json`
- `.runtime-state/disdex-v96-execution-parity-approved.json`

The runtime loads the approval through `DISDEX_V96_EXECUTION_PARITY_FILE`.

## Aster order path

The V96 order path performs:

1. account equity and target-weight notional calculation;
2. ask-price conversion for BUY and bid-price conversion for SELL;
3. base-quantity calculation from USD delta;
4. reduce-only cap to the current position quantity;
5. Aster `MARKET_LOT_SIZE` or `LOT_SIZE` normalization;
6. `stepSize`, `minQty`, `maxQty` and `MIN_NOTIONAL` validation;
7. deterministic `v96-` client order IDs and idempotency keys;
8. durable pending state before submission;
9. post-submission reconciliation;
10. manual-review stop for UNKNOWN or partial-fill conditions.

Direction changes close the existing side with reduce-only before the opposite side may be opened.

## Durable state and recovery

The independent V96 state contains:

- schema version and V96 Strategy ID;
- configuration fingerprint;
- runner mode;
- pending order phase and normalized quantity;
- completed executions and idempotency key;
- failures and manual-review reason;
- Forward Evidence counters;
- bootstrap status.

Writes use a temporary file, atomic rename and file mode `0600`. A strategy, schema or fingerprint mismatch blocks automatic reuse.

## Forward Evidence

The remaining promotion gate requires future observations after the configuration is frozen:

- 30 completed calendar days;
- 120 completed decision bars;
- at least 2 closed Long trades;
- at least 2 closed Short trades;
- zero Gross-cap breaches;
- zero UNKNOWN-order events;
- zero recovery failures;
- observed minimum PENGU clip at least 0.50;
- matching configuration fingerprint;
- SHA-256-bound evidence artifact.

Reused historical or 2026H1 evidence does not satisfy this gate.

## Current LIVE gate

LIVE startup still requires all of the following:

- repository `liveTradingEnabled=true` in a separate promotion commit;
- `DISDEX_V96_RUNNER_MODE=live`;
- `DISDEX_V96_LIVE_EXECUTION_ENABLED=true`;
- exact acknowledgement `I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK`;
- approved Forward Evidence file;
- approved execution-parity file;
- valid Aster credentials;
- One-way Mode;
- flat managed symbols and zero open orders at first LIVE bootstrap.

Any missing condition stops startup before an order can be sent.

## VPS installation

After merge, Paper/Forward installation is:

```bash
sudo DISDEX_V96_DEPLOY_MODE=paper \
  DISDEX_V96_REPO_ROOT=/path/to/-ai-dex-manager \
  bash scripts/install-disdex-v96-systemd.sh
```

Do not report VPS deployment, service activation or trading unless the command was actually executed and `systemctl`, PID, journal, positions and open orders were checked.

## Production/LIVE/VPS/orders

- Production code: implemented in PR #58
- Execution parity: approved by CI when the workflow passes
- Forward Evidence: not approved
- LIVE: disabled
- VPS: not deployed by GitHub changes alone
- Orders: not sent by this PR
