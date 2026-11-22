# P66-P69 | PENGU SHORT V20 five-timeframe point score and original gross risk

Research only: no adoption, no production change. Pinned original Native53 price signals and exits identical.

Predefined score: PENGU W5, D4, 12H3, 4H2, 1H1, only fully completed H1-derived timeframe candles, two consecutive declining closes. Lax sizing 0-3 points reject,4-6 gross0.5,7-10 gross0.75,11-15 gross1.0.

| Research market | Strategy | Price-source one-slot closed | Wins | Drawdown | Initial 10k final NAV |
|---|---|---:|---:|---:|---:|
| Aster 2025Aug-2026Nov | Native gross0.75 | 33 | 18 | 25.10% M5 high | 14,193 |
| Aster 2025Aug-2026Nov | Frozen 15pt LAX | 28 | 17 | 13.71% M5 high | 14,935 |
| Binance 2025Jan-Jul | Native gross0.75 | 23 | 13 | 17.56% realized only | 14,398 |
| Binance 2025Jan-Jul | SAME frozen 15pt LAX | 20 | 11 | 21.17% realized only | 11,438 |

The apparent Aster benefit does not transfer to the different Binance market; drawdown definitions are not cross-market comparable. Score 11-15 gave Aster 2 wins/4 source candidates and Binance 6 wins/18, not a monotonic short win predictor.

P67 original Aster POINTS_LAX with Native exit had DD13.71%, NAV14935; adding conditional 5-8 stop instead produced DD15.01%, NAV14899. Entry classification is more important to study before modifying the exit.

Global bull market not tested: BTC W and D jointly UP by strict two-consecutive-rises definition occurred in zero Aster cases and one Binance case. A weekly bull trend can persist despite temporary daily decline. Do not assert this gate works.

Next design: W/D define BTC+ETH macro market regime and PENGU relative weakening, H12 tests downleg versus exhaustion, 4H/1H test rebound rejection. Separate points for directional regime, execution timing, confidence and gross sizing instead of summing all lower closes; independent unseen Aster data required. No Live / Risk / STOP modifications.
