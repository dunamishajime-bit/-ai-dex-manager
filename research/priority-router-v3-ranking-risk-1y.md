# Priority Router V3 research contract

This is an offline, research-only comparison. It does not alter production
strategy code, LIVE settings, VPS state, approvals, accounts, positions,
orders, or Open Orders.

The frozen Champion streams and one-year window are reused from the prior
Router V1/V2 research implementation. The requested `2025-07-01` through
`2026-07-01` window is evaluated as a re-evaluation of the existing evidence;
it is not used to tune the V3 policy and is not claimed as new holdout proof.

## V3 policy

* SOL and LINK remain the two priority symbols, with two maximum positions and
  priority preemption of ETH/BNB/AVAX.
* ETH, BNB, and AVAX are all valid complement candidates. No Shadow metric can
  reject an otherwise valid complement entry.
* Closed Shadow history is used only when ranking simultaneous complement
  candidates. Only exits at or before the decision timestamp are included.
* `Router V3 Ranking-only` is the explicit no-quality-stop form of the existing
  wide-participation ranking policy. Its parity with Router V1 is intentional.
* `Router V3 Ranking + Risk Scaling` uses a pre-declared, non-OOS-fitted rule:
  normalized signal strength `< 1.0` receives 50% of the available complement
  sleeve; otherwise it receives 100%. The entry remains allowed and remains
  shadow-tracked. This is allocation control, not a gate.
* BTC is reference-only and never receives position, order, PnL, or allocation.

Normal conditions use the prior 10 bps round-trip cost and zero execution
delay. Stress uses the prior 30 bps round-trip cost and one-bar delay. Both
are applied to the same frozen candidate streams.

The workflow uploads a JSON artifact containing variant metrics, hourly MTM
equity, real trades, shadow diagnostics, skipped reasons, preemption, and
contribution attribution.
