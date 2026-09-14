# PENGU Dual-Engine V39 Result

## Status

`PENGU_PARTIAL_SIDE_ONLY`

PENGU remains a required return engine, but Long and Short are promoted independently.

## Short candidate — passed

`S_BREAKDOWN_F6_S24_T0p0_A0p0_V0p8_FR0p0_BRISK_TIME24`

- Logic: 24-hour low breakdown, negative 6-hour confirmation, volume ratio >= 0.8, BTC risk filter
- Hold: 24 hours
- Development: 18 trades / +17.1942% / PF 1.9009 / Severe +14.9135% / DD -9.1904%
- Validation: 8 trades / +10.5027% / PF 1.8587 / Severe +9.5448% / DD -6.6697%
- Frozen Holdout: 4 trades / +7.5496% / PF 3.3580 / Severe +7.0854% / DD -3.1965%

The Short rule passes the numeric gate, but the Frozen Holdout sample is only four trades. It is a Paper/Forward candidate, not a live-qualified rule.

## Long candidate — failed Frozen Holdout

`L_TREND_F24_S168_T1p0_A0p0_V1p0_FR0p0008_BDIRECTION_ATR4_SL2_H72`

- Development: 32 trades / +17.1329% / PF 1.3414 / Severe +13.5063% / DD -21.4958%
- Validation: 22 trades / +16.2092% / PF 1.5193 / Severe +13.8668% / DD -11.6884%
- Frozen Holdout: 15 trades / -12.6694% / PF 0.6184 / Severe -13.8635% / DD -15.7787%

The Long trend rule is rejected. It must not be enabled merely to make the system symmetrical.

## Combined result

- Development: +37.2730% / PF 1.4867 / Severe +30.4341% / DD -14.9209%
- Validation: +28.4144% / PF 1.6168 / Severe +24.7352% / DD -12.7806%
- Frozen Holdout: -6.0764% / PF 0.8622 / Severe -7.7604% / DD -11.8819%

The combined engine fails because the selected Long rule fails.

## Next Long design

The next PENGU Long study will prioritize the stable low-drawdown Breakout cluster rather than the failed 168-hour trend selection. Historical Long generation will be separated from the forward-only microstructure VETO:

- Breakout/reclaim entry
- 24h or 48h holding period
- spread compression confirmation
- taker-buy confirmation
- reject extreme bid-depth imbalance because the first V30 audit found contrarian behavior in PENGU
- funding and basis overheat veto

No production, VPS, account, order or real-trading flag was changed.