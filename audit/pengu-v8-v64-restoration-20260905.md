# PENGU V8 / V64 restoration verification — 2026-09-05

Base HEAD: `5c32e55d7ee9ba9e443eec6947c01f9ac316fd32`
Period: 2025-08-10T00:00:00Z to 2026-08-10T00:00:00Z
Capital: JPY 10,000 initial + JPY 10,000 monthly x12; total contribution JPY 130,000; full compounding.

## Q102 universe check

The current 13-symbol causal HIGH_VOL universe was compared against the recovered 20 non-base scanner symbols and all 30 recovered scanner satellites using identical data, costs and logic.

- 13 symbols: 58 trades, +112.6475%, PF 2.5884, DD -11.7298%.
- 20 symbols: 67 trades, +98.8887%, PF 1.9914, DD -19.6907%.
- 30 symbols: 70 trades, +82.9033%, PF 1.7713, DD -19.6907%.

Decision: do not expand Q102 to 20/30 symbols. The missing historical performance is not recovered by universe expansion alone.
## PENGU V8 parity

Frozen Recovery V8 parity reproduces 70 trades, +574.2299% Normal return, PF 4.3312 and DD -12.8489%. Severe reproduces +395.5576%, PF 3.4432 and DD -14.7736%.

The restored V64 path includes the regime72-only supplemental Long gate, breakout/ATR floor `0.510560996033169`, Long multiplier `1.25`, raw Long request up to `0.9375x`, low-risk request `0.1875x`, `SHORT_FIRST` priority, and Recovery handoff to the V64 base Long path. Portfolio allocation remains capped at `0.75x`.

## Integrated one-year DCA comparison

Current PENGU + current 13-symbol Q102 reproduces the previous baseline exactly: Normal JPY 882,837.57 and Stress JPY 300,601.13.

With PENGU V8 restored and all other sleeves unchanged:

- Normal ending asset: JPY 1,773,132.59; PF 3.1495; closed-event TWR DD -14.2959%.
- Stress ending asset: JPY 504,673.89; PF 2.1291; closed-event TWR DD -17.8805%.
- All V12, PENGU, Q102, crypto, stock and total Gross checks passed.

Decision: push the PENGU V8/V64 restoration only. Q102 universe expansion is rejected by BT. Recovery V8 LIVE promotion remains fail-closed; this research push does not send orders, alter VPS services or change LIVE activation.