# Final BT checkpoint — S3_HH_TH_RB — 2026-11-12

Status: FINAL RESEARCH CHECKPOINT / NO PRODUCTION CHANGE

## Scope
- Period: 2025-10-01T00:00:00Z to 2026-10-01T00:00:00Z, end exclusive
- Initial capital: ¥10,000
- Cost models: 10bps and 30bps round trip
- Current research case: S3_HH_TH_RB
- Canonical simulator SHA256: eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6
- Generated simulator SHA256: cc72e9f9c2e545e0d9dc5e721049fddd2fa7bca48a0c395c27db80d6a2db8841
- Final wrapper SHA256: dcba1dd0df2f09b2c532e27497c5e7e2e00dd085fafc59677046457cd615d527
- Output manifest SHA256: df5627f7f99be11368bae36f30eeb7e149378e7b857112159dfa8f70f1d86c1b

## Determinism
Two consecutive full runs produced 21/21 identical artifact SHA256 hashes.

| Cost | Final JPY | Max hourly DD | Fills | Win rate | PF |
|---|---:|---:|---:|---:|---:|
| 10bps | ¥4,704,435.48 | -23.81% | 855 | 61.87% | 1.827 |
| 30bps | ¥1,627,379.00 | -24.57% | 853 | 59.67% | 1.649 |

## Accepted incremental changes
1. HYPE gross x0.5 — pretarget instability; one frozen non-predictive risk response. Do not retune sizing from target outcomes.
2. IDLE TAO gross x0.5 — same-frequency integrated improvement; 30bps final equity, PF and DD improve.
3. Block Q102 RENDER|BRK168_H12_V1.2 — weak pretarget, weak independent forward and target agreement; integrated final equity and PF improve without DD deterioration.

## Baseline progression
| Case | Cost | Final JPY | DD | Fills | WR | PF |
|---|---:|---:|---:|---:|---:|---:|
| STABLE3_HYPE_HALF | 10bps | ¥4,380,032.76 | -23.81% | 857 | 61.73% | 1.727 |
| S3_HH_TH | 10bps | ¥4,442,161.58 | -23.81% | 857 | 61.73% | 1.783 |
| S3_HH_TH_RB | 10bps | ¥4,704,435.48 | -23.81% | 855 | 61.87% | 1.827 |
| STABLE3_HYPE_HALF | 30bps | ¥1,484,977.13 | -24.77% | 854 | 59.60% | 1.567 |
| S3_HH_TH | 30bps | ¥1,536,510.07 | -24.57% | 854 | 59.60% | 1.617 |
| S3_HH_TH_RB | 30bps | ¥1,627,379.00 | -24.57% | 853 | 59.67% | 1.649 |

## Rejected / keep-native
- PENGU RECOVERY_V8: RSI<=22 rejected; deleting current BTC24 gate rejected. Keep current.
- IDLE TIA: early-loss exits, half-risk, ret12/BTC24/volume changes rejected.
- IDLE TAO: ATR gate rejected; keep half-risk.
- IDLE RENDER: frozen gate lowered PF and fills while DD was unchanged. Reject.
- Q102 HIGH_VOL ARB/SUI: 150 structural candidates, robust=0. Keep native.
- Q102 FET: no defensible pretarget route stop. Keep native.
- Q102 DOGE: MR48 independent sample too small; MR72 positive/stableKeep evidence. Keep native.
- V4 X02/X12/G3/X10/Y08/Y15 corrections failed final unseen; X07 unresolved. Keep native.
- Portfolio F0/HB/V4Q4/V52H: reject. V4Q4 DD gain is too small versus fill/final-equity loss.

## End-boundary treatment
One Q102 SUI LONG, route HIGH_VOL|SUIUSDT, entered 2026-09-29T04:00:00Z and has a modeled exit on 2026-10-02T03:00:00Z. The BT ends on 2026-10-01T00:00:00Z exclusive, so the future exit is not imported. The position remains terminal-open and is marked to market at the boundary.

## DD objective
The <=20% DD objective is not achieved. Current validated DD is -23.81% at 10bps and -24.57% at 30bps. No further change survived the anti-overfit process without material loss of frequency/economics.

## Safety
Research only. No LIVE order, cancel, position, STOP, Kill Switch, Production runner or Production configuration was changed.
