# BT PR #481 — Complete Q102 S3/S4 native model input universe, synthetic feed v3 (2026-11-15)

## Scope and boundaries

This is an offline, isolated BT development change, not a LIVE Runner, order, STOP, owner approval, VPS deploy or Codex production implementation change. The output is **synthetic market input and source-pinned Q102 S3/S4 candidate shadow analysis only**. It does NOT prove complete Q102, STABLE4, Online Layer2/3, or real trade performance.

### Explicit versioned streams
- v1 unchanged: 23 instruments (15 crypto, 8 stock); identical seeded replay.
- v2 unchanged: 24 instruments (16 crypto including synthetic TIAUSDT, 8 stock); identical seeded replay.
- **v3 opt-in: 26 instruments** (18 crypto and 8 stock); appends APTUSDT and LDOUSDT after v2, leaving prior versions intact. New seeded draws change prices of v3 even with same seed: this is a distinct invented market, NOT an incremental investment benefit.
- The schema and source/replay labels separately identify v1/v2/v3. In the BT configuration page, select v3 to check synthetic 26-symbol data and the same pinned source Q102 S3/S4. The owner-only server H48 job continues to permit **v1 only** and is disabled by default. Browser-local simulator accepts versioned streams.

### Why APT and LDO were needed

Frozen native Q102 S3/S4 model table contains 11 symbols: AAVE, APT, AVAX, DOGE, DOT, FET, LDO, NEAR, RENDER, SOL, UNI. The v1/v2 data lacked APT/LDO and were accordingly flagged incomplete. v3 supplies both with synthetic five-minute ticks, volume and completed 1-hour bars.

No strategy or model thresholds were modified. The pinned upstream candidate generator and original quality gates operate on completed H1 observations with 336-hour warmup and UTC hour-modulo-4=1. No future bars or missing-source substitutions are allowed.

### Validation (2025-10-01T00:00Z to 2025-10-23T00:00Z; seed 20261115, volatile, v3)
- Native model symbols evaluated: **11/11**. Missing model symbols: **0**.
- Scheduled native decision hours: **132**; warmup: **84**, evaluated: **48**.
- Source-native raw S3/S4 candidates: **329**. Source-native gated candidates: **37**. Both are **candidate counts, not fills**.
- Simulated Q102 positions and orders: **0**; fully integrated Q102 and Online Layer2/3: **not connected**.
- Independent H48-only synthetic replay in v3 is still **2,880 frames**, with no TIA/APT/LDO synthetic fills.
- New test `scripts/bt-hp-v3-complete-q102-s34-universe-selftest.ts` checks exact seeded v1/v2 preservation, v3 deterministic 26-symbol stream, v3 H48-only provenance, 11/11 Q102 model input coverage, zero Q102 orders.
- Existing v2 test negative case changed from unsupported v3 to unsupported v4 because v3 is now a valid explicit version. Old version economics were not changed.
- TypeScript checks and Next.js full build PASS in isolated BT worktree.

### Data-truth disclaimer and next work

All generated OHLCV, volume, FX, Funding and securities sessions are invented. Quote/base-volume proxy conversion is NOT exchange exact. A source-pinned candidate signal means only the entry generator ran; no real-market lookahead/persistence/live parity is certified.

Pending: Q102 S1/S2 HIGH_VOL, online AVAX KNN/UNI recovery causal state and shadow outcomes, six other runner engines, native EXIT/STOP/pending lifecycle, all-runner Gross, Shared Risk and Layer3 opportunity, 6-month integrated artificial-market simulation, authenticated browser E2E, staging and formally approved production HP release. Codex LIVE worktree and Production remain unchanged.
