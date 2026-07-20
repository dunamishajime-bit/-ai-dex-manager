# Dis-Dex Manager V96 Production Handoff

## Current status

V96 historical research is tracked in PR #56. This document defines the separate TypeScript production path.

- Strategy ID: `DISDEX_V35_STRONG_RESERVED_PENGU_V96`
- Production TypeScript runner: implemented
- Aster order route: implemented through `AsterV3Client` and `AsterDirectTradeExecutor`
- Aster quantity conversion: implemented and exchange-filter normalized
- Durable V96 state: implemented
- VPS/systemd installation path: implemented
- Forward Evidence approval: **not approved**
- Execution-parity review: **not reviewed**
- Repository LIVE flag: `false`
- VPS deployment: **not performed by this PR**
- Real orders: **not enabled and not sent by this PR**

The implementation is Production-path-complete but promotion-incomplete. It must remain fail-closed until both evidence gates are satisfied and the repository runtime is changed in a reviewed promotion commit.

## Historical V96 contract

The historical research contract is frozen as follows:

- PENGU target Gross: `1.15`
- Total portfolio Gross cap: `2.0`
- Minimum active PENGU clip: `0.50`
- Reserve 50% of PENGU target capacity before assigning Core Gross
- Scale Core only when the reservation would otherwise exceed the total Gross cap
- V35 Weight Band: 5% tolerance, 20% portfolio rebalance threshold, forced refresh after 12 bars
- V35 Strong Boost: +30% only under the completed-12h gate recorded in `config/disdexV96Runtime.ts`

## Important execution-parity gap

The TypeScript production signal currently composes:

1. the existing production V35 Core signal implementation;
2. the audited V46 PENGU Long/Short signal implementation; and
3. the V96 reserved-PENGU Gross allocator.

The historical V96 result in PR #56 also includes the V95 Weight Band and Strong Boost research behavior. That V95 behavior has **not yet been ported and proven equivalent in TypeScript**. Therefore this branch must not be described as historical V96 execution parity, and LIVE promotion is blocked.

Execution-parity approval must prove, with frozen golden vectors, that the TypeScript implementation matches the historical research for:

- completed-candle chronology;
- V35 Weight Band state transitions;
- forced refresh timing;
- Strong Boost eligibility and +30% sizing;
- PENGU Long/Short entry and exit timestamps;
- reserved PENGU/Core Gross allocation;
- Aster order-notional and quantity conversion;
- reduce-only reversal sequencing;
- restart, pending-order reconciliation and idempotency behavior.

## V96 Aster order path

`lib/disdex-v96-order-quantity.ts` defines the conversion:

1. compute USD delta from account equity and target weight;
2. use ask for BUY and bid for SELL;
3. calculate requested base quantity as `abs(deltaNotionalUsd) / executionPrice`;
4. cap reduce-only quantity to the current position quantity;
5. call `AsterDirectTradeExecutor.normalizeMarketQuantity`;
6. floor to Aster `MARKET_LOT_SIZE`/`LOT_SIZE` step;
7. reject quantities below `minQty` or `MIN_NOTIONAL`;
8. persist the normalized quantity before order submission.

Orders use One-way Mode semantics (`positionSide=BOTH`), deterministic `v96-` client order IDs, durable pending state and reconciliation. Direction changes must close reduce-only before opening the opposite side. Partial fill or unknown status stops automatic progression and requires review.

## V96 durable state

The V96 state schema is independent of V46 and includes:

- schema version;
- V96 strategy ID;
- frozen configuration fingerprint;
- runner mode;
- pending order and phase;
- completed executions;
- idempotency key;
- failure history;
- Forward Evidence counters;
- bootstrap and manual-review status.

State writes use a temporary file plus atomic rename and mode `0600`. A strategy-ID, schema-version or configuration-fingerprint mismatch blocks automatic reuse.

## Forward Evidence approval

The minimum repository policy is defined in `DISDEX_V96_FORWARD_REQUIREMENTS`:

- 30 completed calendar days;
- 120 completed decision bars;
- at least 2 closed Long trades;
- at least 2 closed Short trades;
- zero Gross-cap breaches;
- zero UNKNOWN-order events;
- zero state-recovery failures;
- observed minimum active PENGU clip at least 0.50;
- frozen configuration fingerprint;
- SHA-256-bound evidence artifact.

These are minimum technical promotion requirements, not a guarantee of profitability. Evidence must come from future observations after the configuration is frozen. Reused 2026H1 research data does not satisfy this gate.

The approval manifest is loaded from `DISDEX_V96_FORWARD_EVIDENCE_FILE` and must match `DisDexV96ForwardEvidenceApproval`.

## Execution-parity approval

The approval manifest is loaded from `DISDEX_V96_EXECUTION_PARITY_FILE` and must match `DisDexV96ExecutionParityApproval`.

Approval requires all of the following:

- matching V96 strategy ID;
- matching configuration fingerprint;
- frozen research and production commit SHAs;
- SHA-256-bound golden-vector artifact;
- allocation parity passed;
- signal chronology parity passed;
- Aster order-quantity parity passed;
- restart/recovery parity passed;
- named reviewer and review timestamp.

## LIVE promotion sequence

LIVE must not be enabled merely because the runner and Aster route exist. Promotion requires a separate reviewed commit that:

1. ports and proves V95 Weight Band/Strong Boost parity;
2. freezes the production commit and golden vectors;
3. records approved Forward Evidence;
4. records approved execution parity;
5. changes `DISDEX_V96_RUNTIME.liveTradingEnabled` from `false` to `true`;
6. runs all V35, V46 and V96 validation;
7. performs VPS preflight with the actual account flat for managed symbols and with zero open orders;
8. uses an explicit operator handoff to stop any old service controlling the same Aster account.

Even after promotion, LIVE startup requires:

- `DISDEX_V96_RUNNER_MODE=live`;
- `DISDEX_V96_LIVE_EXECUTION_ENABLED=true`;
- `DISDEX_V96_LIVE_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK`;
- valid Forward and Parity approval files;
- Aster credentials;
- repository `liveTradingEnabled=true`.

Any missing condition blocks startup before an order executor can be used.

## VPS commands

Paper/Forward installation after merge:

```bash
sudo DISDEX_V96_DEPLOY_MODE=paper \
  DISDEX_V96_REPO_ROOT=/path/to/-ai-dex-manager \
  bash scripts/install-disdex-v96-systemd.sh
```

LIVE installation is intentionally blocked in the current repository state. Do not report V96 as VPS-deployed, running, or trading unless the VPS command was actually executed and `systemctl` plus journal output were checked.

## Required completion report

A future VPS promotion report must include:

- exact Git commit SHA;
- VPS repository path and checked-out branch;
- systemd unit name and active PID;
- test commands and results;
- runtime mode and LIVE flags;
- Forward and Parity artifact hashes;
- Aster account mode and bootstrap result;
- managed positions and open-order reconciliation result;
- first target Gross, normalized quantity and actual submitted order result;
- unresolved risks or manual-review state.
