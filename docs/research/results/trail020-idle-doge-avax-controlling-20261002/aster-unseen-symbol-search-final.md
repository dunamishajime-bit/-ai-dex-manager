# AsterDEX Unseen Symbol Search Final — 2026-10-02

Status: RESEARCH_COMPLETE_NOT_LIVE

## Universe
- Aster USDT trading symbols: 572
- Previously seen/local-research symbols: 53
- Initially unseen: 519
- Unseen crypto candidates with current 24h quote volume >=100k USDT: 54
- Additional unseen crypto candidates with 20k-100k USDT: 101
- Of those, 61 were listed >=120 days before the 2026-08-10 OOS boundary.

Priority contract:
formal production stack > DOGE supplemental > AVAX supplemental > new symbol.
New routes never displace DOGE/AVAX and are preempted by higher-priority signals.

## Higher-liquidity unseen scan
Only 2Z, XPL and ZAMA survived DEV/VAL/HOLD.
Fresh untouched OOS eliminated XPL and ZAMA.

2Z MOM_SHORT:
- formal integrated 10bps: JPY981.56M vs DOGE+AVAX JPY852.25M
- 20bps: JPY313.68M
- 30bps: JPY88.90M
- fresh OOS route: 7 trades, PF4.35 at 10bps, PF3.67 at 20bps, PF3.16 at 30bps
- extended OOS cost stress: PF2.41 at 50bps, 1.71 at 80bps, 1.40 at 100bps

But current 2Z liquidity is inadequate:
- 24h quote volume ~136k USDT
- current observed top-of-book spread ~77bps
- depth within +/-0.5% only ~2.5k bid / ~2.8k ask USDT
Therefore 2Z is research-only, not a current LIVE candidate.

## 20k-100k quote-volume extension
14 routes survived pre-OOS DEV/VAL/HOLD.
Fresh OOS rejected BANK, AVNT, ZEN, PYTH, ALLO, MET, POWER and others.
TAKE/EDGE/GIGGLE had no valid new OOS signals/data in the untouched window.

BLUAI was the only meaningful OOS survivor:
BLUAI REL_SHORT:
- formal integrated 10bps: JPY1.887B
- 20bps: JPY581.57M
- 30bps: JPY158.99M
- fresh OOS route: 24 trades
- OOS PF: 1.58 / 1.50 / 1.43 at 10/20/30bps
- OOS PF: 1.30 at 50bps, 1.13 at 80bps, 1.03 at 100bps

Current BLUAI quote volume was ~75k USDT/day at discovery time.
Aster returned HTTP 418 when a fresh depth check was attempted after the large historical download batch, so current spread/depth was not certified.
Given turnover and the rapid decay toward PF~1 at 100bps, BLUAI remains research-only until depth/spread execution evidence is available.

## Practical conclusion
No completely unseen symbol with clearly adequate current liquidity survived the full chain:
DEV -> VAL -> HOLD -> integrated portfolio -> untouched OOS -> cost stress -> execution-quality screen.

Research-only discoveries:
1. 2Z MOM_SHORT — strong signal persistence, fails current liquidity/spread screen.
2. BLUAI REL_SHORT — very strong formal compounding and positive OOS, but too thin to promote without execution proof.

Practical supplemental candidate remains:
formal stack + DOGE Relative+Volume + AVAX REL_LONG.
AVAX is not a completely unseen symbol, but its supplemental route is new.
Recent execution snapshot:
- AVAX 24h quote volume ~1.08M USDT
- spread ~1.82bps
- +/-0.5% depth ~214k bid / ~198k ask
This is materially more executable than 2Z/BLUAI.

No LIVE change was made.
