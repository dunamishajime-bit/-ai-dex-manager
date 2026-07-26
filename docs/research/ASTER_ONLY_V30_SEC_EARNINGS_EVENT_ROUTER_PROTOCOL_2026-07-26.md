# Aster-only V30 SEC Earnings Event Router Protocol

## Goal

Add a materially different information source to the AsterDEX-only Stock sleeve. V30 uses SEC filing publication timing for 10-Q, 10-K and earnings-related 8-K Item 2.02 filings, then requires observable cash-session confirmation before any Aster trade.

## Frozen event source

- SEC `data.sec.gov/submissions/CIK##########.json`;
- AMZN, META, MSFT, NVDA and TSLA CIKs are predeclared;
- no API key or authentication;
- declared User-Agent;
- filing families: 10-Q, 10-K and 8-K Item 2.02;
- first full aligned US cash session after publication and the following session are evaluated separately;
- duplicate earnings filings on the same session are deduplicated before trading.

## Frozen candidate families

1. Event gap plus first-session confirmation.
2. Event cash move with incomplete Aster follow-through.
3. Event gap reversal confirmed by the cash session.

Candidates vary only predeclared gap/move/lag thresholds, first or second post-filing session, 11:30 or 12:30 New York entry, one or two hour holding, and routing policy.

## Routing policies

- `EVENT_PRIORITY`: SEC event trade replaces V19 on the event day when accepted.
- `MAX_EDGE`: choose the accepted event or V19 row with the larger observable edge proxy.
- `SEQUENTIAL_THEN_V19`: a one-hour 11:30 event trade may finish by the frozen 12:30 V19 entry; maximum concurrent Gross remains 1.0.

V11-EQ remains first priority. Hyperliquid is not used.

## Frozen architecture

- exact trailing window: 2025-07-25 through 2026-07-24;
- AsterDEX only;
- maximum concurrent Gross 1.0;
- maximum concurrent Stock positions 1;
- TP +0.90%;
- SL -0.80%;
- Normal 40 bps, P95 44 bps and Severe 100 bps round-trip cost scenarios;
- no Production, LIVE or VPS promotion from this study.

## Candidate and selection discipline

- 432 candidates are predeclared before execution;
- Development selects at most 40;
- Validation selects at most one;
- Final reused and July Holdout are audit-only;
- Validation requires at least eight routed trades and at least four SEC-event trades;
- thresholds are not changed after seeing Validation, Final or Holdout.

## Final acceptance

A candidate must simultaneously:

- exceed frozen V22 Normal +72.276908% and P95 +68.080022%;
- produce SEC-event-only Normal above +7.813259% and P95 above +7.400908%;
- pass Validation trade/PF/return requirements;
- keep Final reused and July Holdout Normal/P95 positive;
- retain PF, drawdown, concentration and large-winner removal hurdles;
- fail closed in Severe;
- remain Aster-only with V11-EQ priority.

## Limitations

SEC filing presence and publication time are observable, but this study does not contain analyst consensus surprise. Cash data is Yahoo 60-minute history and Aster is candle-based, so exact spread, depth, queue and post-only fill behavior are not reconstructed.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ, V19, V13D, credentials, orders and positions must not change.
