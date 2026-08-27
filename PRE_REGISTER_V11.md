# PENGU V11 pre-registration — untouched Bybit holdout

Candidate: `COUNTERWIND_PROGRESS_FAIL_REENTRY`

Frozen before any Bybit PENGU performance data is fetched.

- Candidate count: 1
- No threshold sweep
- No entry filtering
- No removal of current PENGU opportunities
- Base Short signal remains production PENGU V2
- Counterwind regime is structural and zero-boundary only: `btcEma168Distance >= 0 OR btcReturn24h >= 0`
- In that regime only: `unit=min(entry ATR24 ratio, production 8% hard stop / 2)`, arm=`1*unit`, goal=`min(2*unit,8%)`, progression failure if hourly close profit `<=0.5*unit` before goal
- On progression failure, exit the first Short leg at next H1 open
- Allow exactly one Short re-entry only after PENGU closes below the first-leg low-water mark and below EMA72; re-enter next H1 open
- Re-entry yields to the next baseline PENGU opportunity
- Outside the counterwind regime, production PENGU V2 is unchanged

Untouched final holdout:
- Venue: Bybit PENGUUSDT perpetual
- Period: 2024-12-24T00:00:00Z through 2026-08-01T00:00:00Z

Promotion contract:
- baseline trades >=20
- candidate trades >= baseline trades
- >=2 re-entries
- candidate win rate >= baseline +5 percentage points
- Normal Return/PF/DD no worse
- Severe Return/PF/DD no worse
- improvement remains after removing the best re-entry
- >=3/4 chronological folds non-worse for win rate and Return
- research only; no orders, LIVE, VPS, or production changes
