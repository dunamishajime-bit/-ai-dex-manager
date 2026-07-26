# Aster-only V49 Standalone Residual Engine Result

## Status

`ASTER_ONLY_V49_NO_VALIDATED_STANDALONE_50PCT_ENGINE`

V49 evaluated 216 candidates as a single AsterDEX-only strategy. No V11-EQ, V19, V48, V96 or other strategy return was included.

## Best observed candidate

`REVERSAL__O100__I150__R25__B75__SHORT_ONLY`

- Normal: -13.448492%
- P95: -13.964534%
- Normal trades: 38
- Normal PF: 0.251534
- Normal maximum DD: -13.619181%
- Development Normal: -3.005207%
- Validation Normal: -1.757927% with 4 trades
- Final reused Normal: -5.611989%
- July Holdout Normal: -3.769695%

Development survivors: 0.
Validation survivors: 0.

## Decision

V49 is rejected. V48 is also rejected as an independent strategy because its standalone contribution is far below the new +50% annual minimum. A portfolio or router return must not be presented as the return of one independent strategy.

The only currently identified Aster stock-perpetual strategy exceeding the standalone +50% exact-year threshold is V11-EQ, at Normal +59.791949% and P95 +56.497767%. V11-EQ still lacks enough frozen Validation trades and exceeds the 40% concentration limit, so it remains Forward-Shadow evidence rather than Production approval.

## Evidence

- Workflow run: `30193033332`
- Artifact: `8629208050`
- Artifact SHA-256: `8391bb902e4c444f871d823676d8bb8279e040ad3059e7413af04eb0086462af`
- CI backtest: success
- CI safety validation: success

## Safety

Research only. Production, LIVE, VPS, credentials, orders and positions were not changed.
