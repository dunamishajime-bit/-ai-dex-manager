# STABLE3 remaining-loss and direction-misclassification audit — 2026-11-11

Status: TARGET-YEAR DIAGNOSTIC ONLY / NOT ADOPTION EVIDENCE

## Purpose

Quantify the negative-trade share remaining in STABLE3, then rank logic+symbol groups for causal pre-target investigation. A losing trade is NOT automatically a direction misclassification, so a second diagnostic checks whether the trade side is still wrong versus the market after 3h, 6h and 12h.

No target-year threshold, symbol blacklist or route block may be derived directly from this file.

## STABLE3 loss share

10bps:
- fills: 856
- losing fills: 328
- losing-fill rate: **38.32%**
- winning fills: 528
- gross loss pool: JPY 6,456,032

30bps:
- fills: 855
- losing fills: 346
- losing-fill rate: **40.47%**
- winning fills: 509
- gross loss pool: JPY 2,702,079

## Highest remaining loss contributors at 10bps

| Logic | Symbol | Trades | Losses | Loss rate | Share of all gross losses | Net PnL |
|---|---|---:|---:|---:|---:|---:|
| Q102 | FETUSDT | 15 | 6 | 40.0% | 14.0% | +JPY 4,712 |
| HYPE | HYPEUSDT | 48 | 34 | 70.8% | 13.8% | -JPY 113,753 |
| PENGU | PENGUUSDT | 38 | 10 | 26.3% | 12.4% | +JPY 1,516,877 |
| IDLE | TAOUSDT | 20 | 8 | 40.0% | 10.5% | -JPY 363,197 |
| IDLE | TIAUSDT | 18 | 7 | 38.9% | 9.2% | +JPY 502,368 |
| Q102 | ARBUSDT | 2 | 2 | 100% | 5.6% | -JPY 363,918 |
| Q102 | DOGEUSDT | 18 | 8 | 44.4% | 5.5% | -JPY 253,609 |
| FET | FETUSDT | 8 | 4 | 50.0% | 5.4% | +JPY 433,617 |
| Q102 | ONDOUSDT | 4 | 2 | 50.0% | 4.4% | +JPY 576,439 |
| Q102 | SUIUSDT | 1 | 1 | 100% | 3.8% | -JPY 246,984 |
| Q102 | RENDERUSDT | 3 | 3 | 100% | 3.4% | -JPY 217,981 |
| IDLE | JUPUSDT | 16 | 6 | 37.5% | 3.3% | +JPY 386,823 |
| IDLE | RENDERUSDT | 24 | 13 | 54.2% | 2.8% | -JPY 117,038 |

30bps preserves the same broad priority ordering: HYPE, Q102 FET, PENGU, IDLE TAO/TIA, Q102 ARB/DOGE, FET and Q102 ONDO dominate.

## Direction diagnostic among losing trades

The H3/H6/H12 diagnostic measures whether the realized market move from modeled entry remained opposite the trade side.

Important groups:

- **IDLE TAO**
  - 8 losing trades
  - wrong direction at H3: 87.5%
  - H6: 100%
  - H12: 100%
  - wrong at all H3/H6/H12: 87.5%
  - This is the clearest remaining direction-classification problem.

- **HYPE HYPEUSDT**
  - 34 losses / 48 trades
  - H3 wrong: 76.5%
  - H6 wrong: 88.2%
  - H12 wrong: 76.5%
  - persistent H3/H6/H12 wrong: 64.7%
  - Large sample + large loss share. Highest structural-priority research target.

- **Q102 FETUSDT**
  - 6 losses / 15 trades
  - H3 wrong: 66.7%
  - H6 wrong: 83.3%
  - H12 wrong: 83.3%
  - persistent: 33.3%
  - Strong evidence of wrong-direction subset, but the total logic+symbol is approximately flat/positive, so only the losing sub-regime should be studied.

- **PENGU PENGUUSDT**
  - 10 losses / 38 trades
  - H3 wrong: 70%
  - H6 wrong: 80%
  - H12 wrong: 70%
  - persistent: 50%
  - PENGU remains strongly profitable overall. Do not suppress the whole logic; find a causal losing-state classifier.

- **IDLE TIA**
  - 7 losses / 18 trades
  - H3 wrong: 71.4%
  - H6 wrong: 85.7%
  - H12 wrong: 57.1%
  - persistent: 42.9%
  - The recovery by H12 suggests timing/early-adverse behavior may matter in addition to pure direction.

- **Q102 DOGE**
  - 8 losses / 18 trades
  - H3 wrong: 50%
  - H6 wrong: 75%
  - H12 wrong: 87.5%
  - persistent: 50%
  - Late continuation against the entry is a major clue.

- **IDLE RENDER**
  - 13 losses / 24 trades
  - H3 wrong: 61.5%
  - H6 wrong: 92.3%
  - H12 wrong: 100%
  - persistent: 61.5%
  - Strong direction problem, but the previously found static RENDER gate worsened integrated 30bps DD. Need structural/regime logic, not another target-fit threshold.

- **Q102 RENDER**
  - 3 losses / 3 trades
  - H3 wrong: 100%
  - H6/H12 wrong: 66.7%
  - persistent: 66.7%
  - Too small for direct rule adoption; use only to generate hypotheses.

- **V4 DOGE / ADA / BTC / BNB**
  - losing trades frequently remain directionally wrong,
  - but their contribution to total gross loss is much smaller than HYPE/Q102/IDLE/PENGU because current portfolio sizing/risk controls limit their damage.
  - They remain secondary research targets after the large-loss groups.

## Research priority

Priority is NOT simply loss rate. Use:
1. gross-loss contribution,
2. sample size,
3. persistent wrong-direction rate,
4. independent pre-target evidence availability,
5. integrated DD effect.

Current priority:
1. HYPE HYPEUSDT
2. IDLE TAOUSDT
3. Q102 FETUSDT
4. PENGU PENGUUSDT losing subset
5. IDLE TIAUSDT
6. Q102 DOGEUSDT
7. IDLE RENDERUSDT
8. Q102 ARB / RENDER / SUI only after more samples or structural evidence

## Anti-overfit rule for every next change

For each logic+symbol:
- target-year losses identify WHAT to investigate only;
- candidate conditions must be constructed/frozen on independent pre-target data;
- validation and prehold must be untouched during training;
- true forward can veto but cannot create/tune the rule;
- after freezing, perform one integrated STABLE3 A/B;
- reject any local improvement that worsens integrated DD or materially damages robust profit/PF;
- never blacklist a symbol because it lost in the target year alone.

## Safety

No Production, LIVE orders, STOPs, positions, Kill Switches or runner state were changed.
