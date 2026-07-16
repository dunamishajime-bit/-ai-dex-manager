# DisdexManager Autonomous Research Lab

## Purpose

The autonomous loop searches for USD-M Futures Long / Short strategies targeting an OOS average monthly return above 30% without relaxing liquidation, drawdown, sample-size or execution-cost gates.

The target is a research objective, not a guaranteed return.

## Schedule

GitHub Actions runs four times per day:

- 03:17 JST
- 09:17 JST
- 15:17 JST
- 21:17 JST

Each scheduled cycle uses 20 rounds and 5 strategies per round, producing 100 evaluations. The daily target is therefore 400 strategy evaluations.

The concurrency group permits only one active cycle. A slow cycle is not cancelled by the next scheduled event.

## Autonomous cycle

1. Read the previous state from `research-autonomous-state`.
2. Load Binance USD-M Futures one-hour Klines and settled funding history.
3. Reject the run when the Futures source or Funding coverage is insufficient.
4. Combine previous Elite genomes with fresh strategies.
5. Run Train discovery.
6. Validate top strategies on Validation and untouched OOS windows.
7. Run Walk-forward tests.
8. Run Fee, Slippage and adverse Funding stress scenarios.
9. Reject strategies with liquidation, excessive drawdown, weak samples or directional imbalance.
10. Classify failure causes.
11. Mutate the next Elite population according to the failure profile.
12. Persist the next state and report.

## Automatic reflection rules

### Cost fragility

- Increase the minimum Edge / Cost ratio.
- Increase the momentum threshold.
- Reduce rotation frequency.
- Allow positions to capture a larger move before rotation.

### Return too low with controlled risk

- Increase requested leverage gradually.
- Increase risk per trade gradually.
- Increase maximum margin usage gradually.
- Increase the take-profit distance.

All values remain inside the configured hard limits.

### Drawdown or liquidation

- Reduce requested leverage.
- Reduce risk per trade.
- Reduce margin usage.
- Increase stop distance while preserving account-risk sizing.
- Increase cooldown.

### Too few trades

- Slightly reduce momentum and volume thresholds.
- Slightly relax the regime threshold.
- Keep the Edge / Cost gate active.

### OOS decay or weak Walk-forward performance

- Disable neutral-regime entries.
- Strengthen the BTC regime requirement.
- Increase the regime lookback.

### Direction imbalance

- Re-enable both Long and Short.

## Persistent state

The workflow writes only to the dedicated `research-autonomous-state` branch:

- `.research-state/autonomous-state.json`
- `.research-state/latest-report.md`
- `.research-state/latest-result.json`
- `.research-state/funding-coverage.json`
- `.research-state/forward-paper-candidates.json`
- `.research-state/forward-paper-candidates.md`

The state branch is isolated from the application deployment branch. Scheduled research does not commit generated results to `master`.

## Notifications

- A Forward Paper candidate creates a GitHub Issue automatically.
- A failed scheduled cycle creates or updates one failure Issue.
- A later successful cycle closes the failure Issue automatically.
- Every cycle uploads an Actions Artifact for 30 days.

## Promotion policy

A strategy can be written to the Forward Paper candidate file only after passing all configured final gates, including:

- OOS average monthly return at least 30%.
- OOS maximum drawdown within the active profile limit.
- Minimum OOS trade count.
- Long and Short activity.
- Zero liquidation events.
- Walk-forward pass rate at least 60%.
- Extreme execution-cost average monthly return at least 20%.
- Required OOS and Stress return-retention ratios.

## Safety boundary

The autonomous workflow does not have access to:

- AsterDEX order execution.
- Wallet signing.
- Trading API keys.
- Real account balances.
- Existing live positions.

Automation stops at research evidence and Forward Paper candidate creation. Real trading remains disabled.
