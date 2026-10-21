# Q102 time-exit loss and profit protection — continuation after fixed V4 (2026-10-22)

> Research only. V12 V4 LONG/SHORT all four accepted rules kept fixed. No current VPS/LIVE/venue modifications.

## Source and comparison

Historical interval 2025-08-10..2026-08-10, initial ¥10,000, no contributions, 8-strategy native dynamic admission, 10bps and stress 30bps; no signed venue evidence.

V4 frozen anchor: 10bps ¥191,750,055, DD -14.60331% PF 3.1750; 30bps ¥74,740,268, DD -15.77815% PF 2.5811.

The already-existing Q102 +2% confirmed-M5-close -> +0.5% protective STOP remains unchanged.

## Added 5 × 2 completed full8 causal dynamic portfolio BT cases

| Variant | JPY 10bps | MaxDD 10bps | JPY 30bps | MaxDD 30bps | Additional Q102 exits 10/30 |
|---|---:|---:|---:|---:|---|
| Q102_PB3H_LOSS_PLUS_HV_SHORT_PROFIT3_TO1 | ¥195,452,680 | -14.60331% | ¥82,997,204 | -15.75383% | 9/9 |
| Q102_HV_72H_EARLY_TIME_RESCUE_24H | ¥199,152,715 | -14.60331% | ¥65,954,944 | -15.94389% | 5/5 |
| Q102_MR_SHORT_TIME_RESCUE_12H | ¥189,283,074 | -16.51427% | ¥67,750,234 | -17.50488% | 9/9 |
| Q102_MR_SHORT_H1_2CLOSE_BELOW2_AFTER12H | ¥185,706,702 | -16.51427% | ¥65,677,448 | -17.50488% | 9/9 |
| Q102_HV_LONG_H1_2CLOSE_BELOW3_AFTER12H | ¥194,578,560 | -14.60331% | ¥77,296,639 | -15.77815% | 1/1 |

## Causal MR/HIGH_VOL H1 exit hypothesis (screen, not economics)

| Family / Side | Confirmed H1 rule | 10bps previously losing TIME exits | 10bps originally winning trades also cut |
|---|---|---:|---:|
| MR / SHORT | after 12h; two completed UTC H1 closes each <= -2.0% gain, no prior Q102 +2% confirmed 5m profit arm | 8 | 0 |
| HIGH_VOL / LONG | after 12h; two completed UTC H1 closes each <= -3.0% gain, no prior Q102 +2% confirmed 5m profit arm | 1 | 0 |

### Interpretation

- These counts are **screen-only** uses of already-realized winner/loser labels to assess separability; no outcome labels enter actual proposed triggers. The full8 dynamic candidate reallocation results above determine economic merit.
- Profit protection at Q102 +3% close -> +1% should NEVER replace +2% close -> +0.5% base stop: it must layer above and only ratchet protection monotonically. Gaps/spread and readback can realize below quote floor.
- Any extra early Q102 exit changes shared gross and may worsen portfolio MTM DD even if all affected original Q102 trades were historical losers.
- All tests retain V4 LONG37 -5% after +2%, LONG X3 +3% to +1% H1x2; V4 SHORT 12h initial +2.5% adverse and 12h same-symbol admitted-fill cooldown; SHORT TIME37 +5% to +2% H1x2.
- Production signed-venue STOP readback, partial fills, duplicate-stop avoidance and latest independent TypeScript Task9 full8 parity are NOT certified. This repo contains no authorized current LIVE changes.
- Research winner/loser thresholds were selected on historical data; independent post-selection holdout or forward shadow required before promotions.

### Source artifact receipt

- Historical already-adopted pinned V4 SHA 4081eb37fe23f884a4d1fa93e2b608e388bf7071.
- Q102 original detailed nine-trial analysis SHA b9ee034d7d085647f146689475920223c53fb2f1.
- Source code paths and SHA256 in accompanying machine-verifiable JSON. Full native historic ledger and M5 source archive remain on owner Windows PC; evidence coverage verified.
