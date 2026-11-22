# P107: FET 11 and IDLE 183 -> 184 pure pinned source entry parity, 2026-11-23

The exact pinned source SHA is 7688ed7c93a1918d8b44837339b7da5584a868f5. ASTER official H1 raw files were used for signal-only source-native TypeScript evaluation. The files include market input SHA256, code and raw result events.

FET: 11 raw signals regenerated, 11/11 identical keys. Entry anchor, next bar opening reference price, 72h return, 48h prior high and volume ratio all match to rounding tolerance; zero feature mismatches. Early FET ASTER public history is absent and is not fabricated.

IDLE: exact pinned computeIdlePriorityFeatures, evaluateIdleGenericCandidate, evaluateIdlePriorityShort on five symbols with a 12h per-symbol *generic candidate* lifecycle. The correct complete-history warmup of 74h produces **184 raw SHORT candidates**. The old 2026-11-08 tape has 183, all 183 included in new native source and exact features match; missing one JUP Short at 2026-01-12 18:00 UTC (entry one hour later).

Root cause: legacy generator native-idle-fet-replay-20261108.mjs checks i>=74 but slices arr.slice(i-80,i). For i=74...79 the JavaScript negative array start is interpreted relative to end of entire input array, producing empty history and skipping 6 eligible hours. Repeating the legacy effective 80-bar prewarm gives exactly 183 old candidates and no extra. Use a properly bounded 74h source input when reconstructing the standalone native candidate tape. Save 184 source candidates in a separate JSONL; do not overwrite the old 183 event history.

WARNING: accepted generic prefilters and route candidates are not signed orders and do not apply actual baseline ownership, cooldown after fills, Shared Risk, Gross, STOP, Funding or cross-runner scheduling. This is not 184 actual IDLE fills. The non-HYPE H48 study remains unadopted in Production. Full P107 still BLOCKED.
