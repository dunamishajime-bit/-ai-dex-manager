# Real-time ranking implementation plan

**Goal:** Approved FET OK/NO diagnostic display and all monitored symbol ranking, refreshed every 120 seconds, deployed only to XServer UI.

**Architecture:** Read current runtime policy and persisted observation snapshots. Cache public FET candles. Pure helpers produce gate observations and deterministic rank changes. Separate client components render the existing black/gold visual style.

**Constraints:** No trading code, parameters, runtime state or trading service changes. Missing evidence is unknown. Closeness is not probability. No secrets in responses. Auth required.

## Tasks

- [x] Test and implement `lib/realtime-ranking.ts`: strict breakout, volume boundary, finished bars, continuity, clock, stale handling, stable ties, movement flash.
- [x] Implement read-only FET diagnostics from current Production policy/source and persisted operational evidence.
- [x] Implement aggregate ranking adapters for V12, PENGU, Q102, FET, V52, HYPE and Idle routes; preserve unavailable coverage and source timestamps.
- [x] Implement FET gate panel, ranking page with top three, filters, expanded gates, countdown and reduced-motion gold flash; link below dashboard.
- [x] Run tests/typecheck/build and inspect isolated preview: 11 tests passed; Linux typecheck and Next production build passed; desktop/mobile browser passed, no horizontal overflow/page errors; simulated rank movement flash and reduced-motion fallback passed; auth 401 and 49 live rows verified.
- [x] Deploy isolated UI release, verify public endpoints and unchanged trading release, document deployment. Public pages200, unauthorized APIs401, authenticated49 rows with no source errors; deployed desktop/mobile and simulated flash checks passed.

## Review focus

Expired observations must not occupy top ranks. Incomplete operational gates must not imply entry eligibility. Route scores are normalized gate completion only and are not directly profitable expectancy. Clock cutoff and volume equality match audited FET source. Partial source failure preserves all other sources and reports affected coverage.
