# HYPE train-only gate falsification (2026-11-11)

Source: 39 Binance UM pre-target proxy candidates, 2025-06 to 2025-09. Pinned signal and validated M5 exit model, **not** Aster fill parity. Costs 30bps round-trip subtracted per candidate.

Protocol: fit single-feature thresholds ONLY to June–July 2025 (19 candidates); inspect August validation (11) and September prehold (9) afterward. Nine features, both threshold directions, seven training quantile cutoffs each, minimum 8 retained train samples. Ranking by training mean return; this is exploratory multiple-comparison search, not a pre-registered confirmation.

Top train gate: hypeRet24 <= 0.07412294898; train 6/8 wins (75%), mean +2.9253%, PF 9.467; validation 0/6 wins, mean -1.8194%, PF 0; prehold 1/5 wins (20%), mean -0.4992%, PF 0. 
Alternative hypeRet24 <= 0.08277415644; train 9/12 wins (75%), mean +2.7874%, PF 8.796; validation 0/7 wins, mean -1.8731%, PF 0; prehold 1/7 wins (14.29%), mean -0.7566%, PF 0.41.
RegimeDistanceBps <= 1126.18624566; train 7/10 wins (70%), mean +2.5506%, PF 6.945; validation 0/7 wins, mean -1.7427%, PF 0; prehold 1/4 wins (25%), mean -0.2168%, PF 0.81.

Baseline: train 9/19 (47.37%), validation 0/11, prehold 2/9 (22.22%).

Decision: NO NEW GATE ADOPTED. No validation improvement. Small sample sizes and proxy venue limit certainty. No target-year tuning. Need independent data and full portfolio DD, fill/STOP/funding parity before acceptance.

No live trades, production config, Runner, STOP or Kill Switch changed.
