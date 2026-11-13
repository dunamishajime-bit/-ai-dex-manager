# Five-logic redesign integrated BT - 2026-11-13

Status: RESEARCH ONLY / NO PRODUCTION CHANGE

Period: 2025-10-01 00:00 UTC <= t < 2026-10-01 00:00 UTC
Initial capital: JPY 10,000
Exact STABLE3 source commit: b7133c209ad9e2f59b9b37d032bb1b3379258267

## Exact integrated comparison

| Case | Cost | Final JPY | Max DD | Fills | Win rate | PF | Delta Final vs STABLE3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| STABLE3 | 10bps | 4,512,970 | -26.06% | 856 | 61.68% | 1.668 | 0 |
| STABLE3 | 30bps | 1,454,530 | -28.08% | 855 | 59.53% | 1.513 | 0 |
| PENGU_R3 | 10bps | 5,435,516 | -26.06% | 853 | 61.20% | 1.639 | 922,546 |
| PENGU_R3 | 30bps | 1,765,365 | -28.08% | 850 | 59.06% | 1.493 | 310,835 |
| Q102_AVAX_H24_ONLY | 10bps | 751,209 | -42.33% | 534 | 61.24% | 1.649 | -3,761,761 |
| Q102_AVAX_H24_ONLY | 30bps | 251,946 | -45.62% | 520 | 58.85% | 1.467 | -1,202,584 |
| Q102_AVAX_H24_UNI_H24 | 10bps | 1,019,819 | -44.10% | 583 | 61.41% | 1.492 | -3,493,151 |
| Q102_AVAX_H24_UNI_H24 | 30bps | 383,695 | -50.90% | 575 | 59.83% | 1.378 | -1,070,834 |
| IDLE_VNEXT_1X | 10bps | 3,450,538 | -30.48% | 789 | 60.84% | 1.510 | -1,062,432 |
| IDLE_VNEXT_1X | 30bps | 236,038 | -35.56% | 425 | 55.53% | 1.361 | -1,218,491 |
| HYPE_H36_1X | 10bps | 3,542,060 | -23.60% | 840 | 61.55% | 1.691 | -970,910 |
| HYPE_H36_1X | 30bps | 624,036 | -25.09% | 684 | 58.19% | 1.518 | -830,494 |
| ALL5_CURRENT_STRESS | 10bps | 771,983 | -68.82% | 780 | 59.62% | 1.413 | -3,740,987 |
| ALL5_CURRENT_STRESS | 30bps | 132,324 | -65.97% | 373 | 56.30% | 1.298 | -1,322,205 |

## Findings

### PENGU SHORT_V20
Only SHORT_V20 was redesigned. PENGU V2 and Recovery V8 remain unchanged. Direction remains SHORT.
Current best exact-integrated gate: btc24h <= -0.010836782776818987 AND pengu72h <= -0.05237466490617382.
It is the only current redesign candidate that survives exact portfolio replay, improving final compounded JPY at both costs while baseline DD is essentially unchanged. Research-only.

### Q102 AVAX / UNI
The current from-scratch entry candidates fail portfolio integration. AVAX H24 alone triggers repeated Shared Risk cascades; adding UNI increases Q102 occupancy and suppresses other high-expectancy runners.
This is not a recommendation for permanent exclusion. Next design must add causal protection/STOP semantics and lower event density, then rerun this same exact simulator.

### HYPE
H36 from-scratch LONG was tested at 1.0x. It loses total portfolio return through occupancy/capacity interaction. HYPE remains a 1.0x redesign target; 0.5x is not the intended final design.

### IDLE
IDLE vNext was tested at 1.0x. Standalone and forward behavior is positive, but exact portfolio integration fails through opportunity-cost interaction. It needs formal-runner yield/preemption and density control. 0.5x is not the intended final design.

### All-five stress test
The current first-pass all-five combination is decisively rejected. The result is retained as falsification evidence to prevent rediscovering the same failed combination.

## Reproduction
The locked STABLE3 baseline can be replayed with REUSABLE_STABLE3_REPRO_20261113_V1/RUN_STABLE3_REPRO.ps1.
Input/source hashes and exact expected 10bps/30bps values are stored in STABLE3_REPRO_MANIFEST_20261113_V1.json.

## Safety
No Production runner, order, position, STOP, Kill Switch, Production config, or deployment was changed.
