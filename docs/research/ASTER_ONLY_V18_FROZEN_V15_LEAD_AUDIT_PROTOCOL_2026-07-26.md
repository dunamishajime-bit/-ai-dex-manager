# Aster-only V18 Frozen V15 Lead Audit Protocol

## Frozen lead

`TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE`

The lead was selected before the July Holdout and was the only frozen representative to pass the V17 July rule. V18 changes no trading parameter.

## Logic

- AsterDEX only;
- one Stock-perpetual position total;
- observe each symbol's cash/Aster Basis at 12:30 New York;
- compare the current Basis with that symbol's prior 20-session 12:30 Basis distribution;
- require absolute Z-score at least 2.0 and absolute residual at least 35 bps;
- select the largest absolute qualified Z-score;
- if Aster is rich to cash, short Aster; if Aster is cheap to cash, long Aster;
- require observable expected edge after cost of at least 10 bps;
- reject entry when observable round-trip cost exceeds 60 bps;
- exit at +0.75%, -1.00%, or after two hours;
- no Hyperliquid leg and no overnight position;
- Gross 1.0.

## Frozen evidence windows

- Development: first 50% of pre-July aligned sessions;
- Validation: next 25%;
- final reused-history diagnostic: last 25% before 2026-07-01;
- July Holdout: 2026-07-01 through 2026-07-22;
- full diagnostic: all aligned sessions through 2026-07-22.

No window may be removed or shifted after the result.

## Cost scenarios

- Forward median: 24 bps;
- Normal: 40 bps;
- P95: 44 bps;
- Severe: 100 bps with no entry above the 60 bps cost limit.

## Fixed robustness checks

Normal and P95 results are reported for:

- full trade set;
- best individual net trade removed;
- best calendar month removed;
- each leave-one-symbol-out portfolio;
- Long-only trades;
- Short-only trades.

## Shadow-candidate criteria

The lead is classified as an Aster-only V13D replacement Shadow candidate only when all are true:

- Development Normal and P95 positive;
- Validation Normal and P95 positive;
- final reused-history Normal and P95 positive;
- July Holdout Normal and P95 positive;
- full Normal and P95 returns exceed frozen V13D;
- full Normal has at least 20 accepted trades, PF above 1.30 and DD no worse than -10%;
- full Normal capital efficiency exceeds frozen V13D;
- best-trade-removed and best-month-removed Normal/P95 remain positive;
- every leave-one-symbol-out Normal and P95 result remains positive;
- Severe remains non-negative through fail-closed behavior.

Long-only and Short-only results are diagnostics, not mandatory pass criteria because the frozen strategy explicitly trades both directions.

A pass authorizes only implementation of a Pyth/IEX plus Aster order-book Forward Shadow runner. It does not authorize Production or LIVE orders.

## Limitations

- historical cash data are Yahoo 60-minute bars rather than Pyth ticks;
- historical Aster data are 30-minute candles rather than exact order-book and fill evidence;
- the final pre-July segment has been exposed to other Stock research;
- July contains only 15 sessions;
- historical results do not guarantee future profit.
