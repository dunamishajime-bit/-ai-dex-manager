# Aster-only V21 Broad Universe Strict Result

## Status

`ASTER_ONLY_V21_INSUFFICIENT_BROAD_UNIVERSE_DATA`

The fixed 20-symbol broad-universe experiment could not produce a valid exact one-year comparison because only five Aster stock perpetuals had at least 120 aligned cash/Aster sessions.

## Eligible symbols

- AMZNUSDT
- METAUSDT
- MSFTUSDT
- NVDAUSDT
- TSLAUSDT

Each had 255 aligned sessions from 2025-07-15 through 2026-07-24.

## Insufficient-history symbols

The remaining requested underlyings had substantially shorter Aster histories, generally beginning during 2026:

- ADBE: 23 aligned sessions;
- AMD: 44;
- AMAT: 29;
- ARM: 40;
- ASML: 25;
- AVGO: 44;
- CRM: 27;
- GOOGL: 84;
- INTC: 119;
- MRVL: 44;
- MU: 119;
- ORCL: 42;
- PLTR: 44;
- QCOM: 30;
- TSM: 75.

The frozen minimum of 120 sessions was not lowered after observing the data. Recent listings were not backfilled or presented as one-year instruments.

## Conclusion

Expanding the universe cannot currently be used to prove a one-year +50% Aster-only strategy. A future broad-universe study becomes valid only after the newer listings accumulate sufficient aligned history or a trustworthy historical listing archive becomes available.

## Evidence

- PR: `#87`
- Workflow run: `30173421097`
- Artifact: `8623544805`
- Artifact SHA-256: `b9b837c7246f8b5a6e6a8066de80347fd626ce13b286c69e315ef81826ed006b`
- CI and safety validation: success

## Safety

Research only. Production, LIVE, VPS, credentials, orders and positions were not changed.
