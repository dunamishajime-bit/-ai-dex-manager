# Simulated BT HP gameplay specification — 2026-11-11

Status: FUTURE_PLAN / DO_NOT_IMPLEMENT_YET

Purpose:
Create an HP backtest page that lets the owner freely select pre-registered fixed trading logics and symbols, generate reproducible synthetic markets, and visually inspect how the account and each logic behave over accelerated simulated time.

## Core configuration

- Logic catalog is fixed/registered in advance. Owner can add/remove enabled logic entries from the catalog, but cannot inject arbitrary code from the BT page.
- Select one or more logics.
- Select one or more symbols/currencies.
- Select simulated period such as six months.
- Button: generate simulated charts/prices for every selected symbol.
- Synthetic prices are derived from existing BT market data but altered enough to produce distinct scenarios rather than replaying the original path.
- Preserve valid OHLC structure and realistic temporal behavior.
- Preserve configurable cross-asset correlation where useful, while allowing regime divergence.
- Support different market patterns: strong uptrend, weak uptrend, range, weak decline, downtrend, crash, rebound, high volatility, low volatility, false breakout, regime transition.
- Reproducible random seed must be stored so the exact scenario can be rerun.
- Keep REAL-DATA BT and SYNTHETIC/STRESS BT clearly separated in UI, storage, labels and reporting.

## Real-time / game-like playback

Primary requirement: the owner should be able to watch the BT unfold like a real-time game after pressing a "Start simulated chart" button.

- Time advances automatically in accelerated playback.
- Adjustable playback speed / fast-forward.
- Account balance/equity must update continuously with simulated time.
- The user must be able to visually see when balance/equity turns positive or negative.
- Show current cash/equity, realized PnL, unrealized PnL, drawdown and open exposure during playback.
- Playback controls should include at least start, pause, resume, speed change and reset/replay with the same seed.

## Representative BTC chart

Use BTC as the representative overview chart even when multiple symbols are being tested.

- Display BTC candlestick/price chart synchronized with simulated time.
- When any logic fires, put a visible marker (circle or equivalent) on the BTC chart at that timestamp.
- Marker label must identify the logic, e.g. "V4発火", "PENGU発火", "Q102発火".
- When a position exits, put another marker at the exit timestamp.
- Exit marker should immediately show whether that completed trade was positive or negative and its PnL.
- Entry/exit markers must be clickable/selectable to reveal the actual traded symbol, side, entry/exit price, reason, active gates, STOP/TP state, realized PnL and account state at that timestamp.
- Multiple simultaneous logic events must remain distinguishable.

BTC is only the representative timeline. The actual traded symbol can differ, so event details must always show the true symbol.

## Loss investigation / replay

A major purpose is to investigate negative periods after the run.

- Mark negative trades and major equity drawdown segments.
- Allow jumping from the equity curve or trade list directly to the corresponding simulated timestamp.
- Replay a selected losing interval in slow motion.
- Show which logic fired, which market/regime conditions were seen, why the gate passed, subsequent MFE/MAE, STOP/TP/exit path and interaction with Shared Risk/Gross/capacity.
- Compare a losing interval against the same scenario with another registered logic/gate configuration.
- Allow attaching notes/tags such as false-long, false-short, range-misclassification, late-exit, premature-stop, capacity-block, shared-risk interaction.
- Preserve the seed and event ledger so a discovered failure can be reproduced exactly during future logic improvement work.

## Scenario robustness use

The page is intended to test whether a logic misclassifies many different market patterns, not merely to maximize profit on one generated chart.

- Batch mode should eventually support many seeds/scenarios, e.g. 10/50/100 simulations.
- Summarize failure frequency by logic, symbol, direction and regime.
- Important outputs: win rate, max DD, PF, trade count, final equity, loss concentration and misclassification count.
- Highlight scenarios where a logic behaves materially worse than the current reference.
- Do not auto-promote a logic because one synthetic scenario is profitable.

## Architecture / parity

- Reuse the canonical BT execution core rather than creating a separate HP-only strategy implementation.
- HP should mainly provide configuration, synthetic-data generation, playback, visualization and drill-down.
- Entry/exit/risk decisions must come from the same canonical logic implementation used by reproducible BT.
- Store simulation seed, selected logic versions/SHA, symbol set, period, generated-data hash, BT engine SHA and event ledger.
- A completed simulation must be reproducible from these artifacts.
- Synthetic BT must never place LIVE orders or mutate Production runners, STOPs, positions, Kill Switch or live risk state.

## UX goal

The intended feel is a real-time strategy/game replay:
1. choose fixed logic(s) and symbol(s);
2. generate a synthetic market;
3. press Start;
4. watch simulated time advance;
5. watch balance/equity fluctuate;
6. see logic entry/exit markers appear on the BTC overview chart;
7. identify where/why losses occurred;
8. jump back into those moments and use them to improve false market-direction judgments and risk behavior.

This document is a persistent future-design requirement. Current priority remains completing and validating the canonical BT/research work before implementing this HP feature.
