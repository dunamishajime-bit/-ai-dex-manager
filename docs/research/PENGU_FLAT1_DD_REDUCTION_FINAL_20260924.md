# PENGU Flat1 DD Reduction — Final Research Report (2026-09-24)

## Fixed contract

This research does **not** reduce PENGU order size.

- Logic: `COMBINED_FILTERED` fixed.
- PENGU maximum Gross: `1.0`.
- Every executed PENGU entry: `Gross = 1.0`.
- Existing signal hierarchy and route definitions remain fixed.
- Aster Futures completed H1 data and Aster funding.
- NORMAL: 6 bps fee per side.
- SEVERE: NORMAL costs + 35 bps adverse slippage per side.
- No Production merge, VPS deployment, order submission, position resize, or LIVE activation.

Baseline flat1 results:

| Window | Mode | Return | WR | PF | Max DD |
|---|---|---:|---:|---:|---:|
| Formal 2025-08-10..2026-08-10 | NORMAL | +1307.91% | 73.24% | 3.979 | -20.82% |
| Formal | SEVERE | +769.78% | 70.42% | 3.147 | -22.60% |
| Rolling365 through 2026-09-23 | NORMAL | +978.20% | 68.92% | 3.024 | -32.17% |
| Rolling365 | SEVERE | +550.88% | 66.22% | 2.437 | -39.56% |

## Root cause of DD

The Rolling365 maximum drawdown is not a single-route failure. It is a cross-route loss cluster concentrated mainly from 2026-07-06 through 2026-09-15.

Baseline route loss contribution over Rolling365:
- BASE_V64_LONG: 12 trades, 5 losses, loss sum -40.75%, route DD -22.52%.
- RECOVERY_V8: 37 trades, 12 losses, loss sum -53.76%, route DD -20.43%.
- SHORT_V20: 21 trades, 6 losses, loss sum -35.27%, route DD -21.40%.

The same hostile market state repeatedly permits different PENGU routes to re-fire. Tightening every stop indiscriminately was not the solution.

## Rejected / weaker protection approaches

- Tighter V64 stop/trailing: small Formal improvement, worsened Rolling365.
- Tighter Recovery V8 protection: degraded return and Rolling365 DD.
- Tighter Short V20 protection: reduced return materially.
- All three tighter protections together: materially reduced profit.
- Global 48h hard-stop cooldown: useful but weaker than route-specific quarantine.
- 8/10/12% global strategy-DD governors with long 168h pauses: DD reduction came at excessive opportunity cost.

## Strongest structural control: same-route hard-stop quarantine

After a route exits via Hard Stop, only **that same route** is prevented from opening again for a bounded period. Other PENGU routes remain eligible.

### Q60 results

Policy:
- Hard Stop on route R at time T.
- Block new entries from route R until T + 60h.
- Other routes remain active.
- Existing positions/protection are unaffected.
- No size reduction: every accepted entry remains Gross1.0.

| Window | Mode | Baseline Return | Q60 Return | Baseline DD | Q60 DD | PF |
|---|---|---:|---:|---:|---:|---:|
| Formal | NORMAL | +1307.91% | **+1536.60%** | -20.82% | **-15.05%** | **4.609** |
| Formal | SEVERE | +769.78% | **+926.48%** | -22.60% | **-16.99%** | **3.629** |
| Rolling365 | NORMAL | +978.20% | **+1149.08%** | -32.17% | **-21.73%** | **3.524** |
| Rolling365 | SEVERE | +550.88% | **+676.38%** | -39.56% | **-29.20%** | **2.827** |

DD reduction:
- Formal NORMAL: +5.76pt.
- Formal SEVERE: +5.61pt.
- Rolling365 NORMAL: +10.44pt.
- Rolling365 SEVERE: +10.36pt.

Formal three-fold robustness remained positive in every fold:
NORMAL: +250.23%, +202.73%, +54.36%.
SEVERE: +198.30%, +157.64%, +33.56%.

### Q58 / Q60 / Q62 neighborhood

- Q58 and Q60 produced identical results in this hourly data set.
- Q62 changes the next eligible H1 signal and is weaker, but still materially improves baseline.
- This shows the useful plateau is approximately 58–60h for the observed signal timing; it is not a single exact 60.000h arithmetic optimum.

## Supplemental tail-risk governor

Route quarantine removes ordinary repeated route losses but the SEVERE path can still experience a deep multi-route cluster.

Causal supplemental rule:
- Track PENGU **closed-trade realized equity only**.
- Track peak of that realized equity.
- If current PENGU closed-equity drawdown reaches a threshold, block all **new** PENGU entries temporarily.
- Existing positions, stops, reduce-only protection and exits are untouched.
- No future information is used.

### Robustness grid

Tested DD thresholds:
- 16.5%, 17.0%, 17.5%, 18.0%.

Tested global pause:
- 60h, 72h, 84h.

All combined with same-route Q60.

The 17.0–18.0% / 72–84h neighborhood is stable on this data:
- Formal NORMAL DD stays -15.05%.
- Formal SEVERE DD stays -16.99%.
- Rolling365 NORMAL remains around -21.45% to -21.73%.
- Rolling365 SEVERE is -21.49% for 17.0–18.0% with 72–84h pauses.

### Selected research candidate: Q60 + DD17/H72

| Window | Mode | Return | WR | PF | Max DD |
|---|---|---:|---:|---:|---:|
| Formal | NORMAL | **+1536.60%** | 75.36% | **4.609** | **-15.05%** |
| Formal | SEVERE | **+843.24%** | 72.06% | **3.397** | **-16.99%** |
| Rolling365 | NORMAL | **+1149.08%** | 71.43% | **3.524** | **-21.73%** |
| Rolling365 | SEVERE | **+764.58%** | **70.00%** | **3.046** | **-21.49%** |

Versus flat1 baseline Rolling365:
- NORMAL return: +978.20% -> +1149.08% (**+170.87pt**).
- NORMAL DD: -32.17% -> -21.73% (**10.44pt improvement**).
- SEVERE return: +550.88% -> +764.58% (**+213.70pt**).
- SEVERE DD: -39.56% -> -21.49% (**18.06pt improvement**).
- SEVERE WR: 66.22% -> 70.00%.
- SEVERE PF: 2.437 -> 3.046.

The DD governor materially alters the SEVERE path while leaving the NORMAL Q60 path unchanged. This is desirable for a tail-risk overlay.

## Mechanism

The main improvement comes from avoiding immediate re-use of a route whose premise just failed:
- Recovery V8 Hard Stop -> Recovery V8 quarantined, but V64/Short routes can still act.
- V64 Long Hard Stop -> Base V64 Long quarantined, but Recovery/Short can still act.
- Short V20 Hard Stop -> Short V20 quarantined, but Long/Recovery can still act.

This directly addresses the observed multi-route DD cluster without shrinking winning trade size.

The DD17/H72 overlay is secondary. It is only an emergency new-entry hold when realized PENGU closed-equity drawdown becomes unusually deep.

## Current conclusion

The strongest research contract is:

```
PENGU logic                = COMBINED_FILTERED
PENGU maximum Gross        = 1.0
every accepted entry Gross = 1.0

on HARD_STOP:
  quarantine SAME route for 60h
  do not disable other PENGU routes

strategy closed-equity governor:
  track causal realized PENGU equity peak
  if DD <= -17%:
      block NEW PENGU entries for 72h
      preserve all existing protection/exits
```

This is a research result, not a Production/LIVE claim. Before Production activation it still requires:
1. production implementation using durable state,
2. restart-safe quarantine/DD-governor state,
3. same-bar ordering and H1 boundary tests,
4. fail-closed handling for missing/corrupt governor state,
5. integrated portfolio replay with V12/Q102/FET/V52 and Shared Gross/Governor,
6. LIVE preflight and Aster reconciliation.
