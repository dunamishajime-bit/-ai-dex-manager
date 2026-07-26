# Aster-only V48 Frozen Three-Window Stress Audit Protocol

## Frozen candidate

`REV_C75_H1_G0.1_SHORT_ONLY__CLOSE_CROSS_LONG__BLOCK_SAME`

Architecture:

- V11-EQ has first priority;
- without V11-EQ, the fixed Long residual core may trade at 10:30;
- otherwise a Short-only Opening Reversal may trade with Gross 0.10;
- V19 remains available at 12:30 when no overlap exists;
- the fixed Cross-Residual Long closing overlay may trade at 15:00 after all earlier positions exit;
- same-symbol reuse is blocked;
- maximum concurrent Gross is 1.0 and maximum concurrent positions is one;
- Hyperliquid is not used.

## Disclosure

This candidate was identified after reviewing V47 diagnostics. Therefore V48 is not an independent Holdout and cannot promote the strategy to Production. A pass permits only orderless Forward Shadow monitoring.

## Stress tests

- repeat every V47 strict hurdle;
- custom 50 and 60 bps round-trip cost;
- leave-one-symbol-out for AMZN, META, MSFT, NVDA and TSLA;
- remove the residual core, reversal and closing component separately;
- test 18 neighboring variants across confirmation 50 / 75 / 100 bps, holding one / two hours and reversal Gross 0.05 / 0.10 / 0.15.

## Pass requirements

- the frozen candidate passes all V47 strict checks;
- Normal and P95 exceed the frozen V22 lines;
- fallback Normal and P95 exceed V19;
- 50 and 60 bps custom-cost results remain positive;
- every leave-one-symbol-out and component-ablation result remains Normal/P95 positive;
- at least 12 of 18 neighboring variants remain positive;
- at least six neighboring variants exceed the frozen Normal/P95 lines.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
