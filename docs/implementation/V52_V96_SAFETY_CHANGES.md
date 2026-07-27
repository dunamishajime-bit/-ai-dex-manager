# V52/V96 execution safety changes

- Entry thresholds, symbol selection, Strong Boost, PENGU rules, gross caps, daily loss and Kill Switch semantics are unchanged.
- Passive reduce-only exits use ask for SELL and bid for BUY. Urgent reasons use reduce-only Market; a GTX rejection is treated as maker non-fill and falls back to the remaining quantity only.
- HTTP cooldowns are isolated for Aster public data, external references, and signed account/order calls.
- Reduce-only normalization keeps minQty/stepSize/maxQty and permits minNotional dust only for full reduction.
- Reference freshness is based on source timestamp, with future/clock-skew checks and an explicit timestamp fallback audit marker.
- Cached Book observations are deduplicated by event timestamp, so history observations represent distinct updates.
- V52 execution gross is recalculated immediately before Entry from available balance, crypto notional/margin, reserve, and portfolio capacity.
- Research trade retrieval covers V96 crypto and AMZN/META/MSFT/NVDA/TSLA stock symbols, exposes strategy/direction/order metadata, and pairs fills FIFO without treating a flat account as proof that every historical fill settled.

No VPS service, order, runtime state, credential, or generated cache is changed by this change set.
