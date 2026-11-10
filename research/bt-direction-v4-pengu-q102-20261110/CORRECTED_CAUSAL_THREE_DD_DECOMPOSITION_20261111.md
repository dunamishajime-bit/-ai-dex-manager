# Corrected CAUSAL_THREE drawdown decomposition — 2026-11-11

## Locked research input

- Baseline: V52-capital-corrected canonical current-implementation replay
- Research bundle: CAUSAL_THREE
- Result:
  - 10bps: JPY 1,585,699.80 / DD -41.35% / Win 59.63% / PF 1.431
  - 30bps: JPY 579,086.35 / DD -50.60% / Win 58.26% / PF 1.322
- Determinism: 42/42 artifacts exact SHA256 match for the two causal A/B cases

## Maximum drawdown window

Both cost models peak on 2026-07-12 01:05 UTC and trough on 2026-09-22 11:00 UTC.

### 10bps

- Peak: JPY 2,151,911.28
- Trough: JPY 1,262,041.43
- DD: -41.35%
- Closed-fill PnL inside the window: JPY -689,007.37

By strategy inside the DD window:

- Q102: JPY -704,721.46
- IDLE: JPY -161,525.92
- HYPE: JPY -148,710.49
- PENGU: JPY -47,765.38
- FET: JPY +122,713.09
- V52: JPY +251,002.78

Largest route losses inside the DD window:

- IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2: JPY -289,958.54
- PENGU SHORT_V20: JPY -202,204.39
- Q102 HIGH_VOL ARB: JPY -166,400.84
- HYPE_TREND_LONG_PINNED: JPY -148,710.49
- Q102 NEAR BRK48: JPY -115,264.42
- Q102 HIGH_VOL SUI: JPY -91,706.10

### 30bps

- Peak: JPY 954,758.38
- Trough: JPY 471,609.36
- DD: -50.60%
- Closed-fill PnL inside the window: JPY -397,661.51

The same three sleeves dominate the loss: Q102, IDLE, HYPE.

## Full-period route decomposition

### 10bps strategy net

- Q102: JPY -351,769.31 / 101 fills / WR 55.45% / PF 0.752
- HYPE: JPY -30,580.17 / 49 fills / WR 26.53% / PF 0.931
- V4: JPY +13,557.45
- IDLE: JPY +128,174.58
- FET: JPY +214,661.05
- PENGU: JPY +600,583.07
- V52: JPY +934,994.23

### 30bps strategy net

- Q102: JPY -163,298.41 / 101 fills / WR 52.48% / PF 0.751
- HYPE: JPY -44,583.48 / 49 fills / WR 26.53% / PF 0.817
- V4: JPY +9,383.20
- IDLE: JPY +13,291.32
- FET: JPY +89,191.30
- PENGU: JPY +304,306.42
- V52: JPY +337,179.28

Worst full-period routes at 10bps:

1. IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2: JPY -170,488.96 / 24 / WR 54.17% / PF 0.449
2. Q102 HIGH_VOL ARB: JPY -166,400.84 / 2 / WR 0% / PF 0
3. Q102 FET PB72: JPY -135,912.29 / 2 / PF 0.059
4. Q102 UNI MR72: JPY -114,763.30 / 5 / WR 20% / PF 0.017
5. PENGU SHORT_V20: JPY -93,478.35 / 21 / PF 0.719
6. Q102 HIGH_VOL SUI: JPY -91,706.10 / 1
7. Q102 RENDER BRK168: JPY -87,516.42 / 3 / WR 0%
8. Q102 AVAX MR24: JPY -78,401.61 / 5 / PF 0.235
9. Q102 NEAR BRK48: JPY -57,667.77 / 5 / PF 0.500
10. IDLE_RENDER_RELATIVE_SHORT: JPY -54,178.36 / 31 / PF 0.426

## Interpretation

The remaining drawdown is no longer primarily a V52 modeling artifact. It is concentrated in crypto sleeves, especially Q102 plus the IDLE TAO route and HYPE.

The next research step should therefore be causal and route-specific:

1. Q102: determine whether the worst FET/ARB/UNI/SUI/RENDER/AVAX/NEAR losses can be filtered or cut earlier using features available before entry or current adopted exit-policy state.
2. IDLE TAO: search for a train/validation/forward-supported admission condition instead of deleting the route based only on target-period PnL.
3. HYPE: entry quality is structurally weak (49 fills, WR 26.5%); evaluate causal admission filters before changing exits.

No Production mutation was performed.
