# FET gates and real-time ranking

## Scope

UI-only observation added to the production UI baseline `0ebc831b98aaf43cce0b87e8e08503cddb983162`. Trading source, services, parameters and state are not deployment targets. XServer `professional-dismanager.net` is the deployment target.

`/realtime` refreshes every120 seconds; `/decision-status/fet` adds a gate panel refreshed every60 seconds. Both APIs require the existing UI auth cookie and return private/no-store responses. The server uses singleflight and bounded caches, invalidated at FET clock/hour boundaries. Client clock evaluation expires previous-hour FET market evidence.

## Ranking definition

Known execution blocks sort behind candidates without known execution blocks. Within each group, score is the average of observed signal gate completion, with supported numerical proximity for unfinished gates. Unknown signal evidence and stale market data receive no score.100 requires all observed signal gates to pass. This is a monitoring heuristic, not a calibrated probability or profitability forecast; gate counts and completeness differ by logic. Unknown account capacity is explicitly unresolved.

Stable row identity is logic/symbol/direction. Existing rows moving rank flash translucent gold for1.1 seconds. New ranked rows show NEW. Initial loading and unchanged ranking do not flash. Reduced-motion uses a stationary outline.

## Sources

- Current release marker and allowlisted runtime policy values via `loadCurrentProductionRuntime`.
- V12 persisted all-candidate snapshot and runner state; authoritative final signal remains authoritative.
- Q102 persisted selector/ranking diagnostics, with source timestamp bounds and stage gates.
- PENGU distinct LONG/SHORT observed eligibility and Short setup state. Current snapshot lacks its own SHA; current heartbeat SHA is separately verified and that snapshot limitation is displayed.
- FET public Aster H1 klines, completed-only and continuous; current audited config and signal source SHA256 must match. Read-only persisted holding/pending/idempotency, shared kill and current complete daily risk state. Balance/residual gross/quantity final checks remain unknown until the runner executes them.
- HYPE existing public candle observer plus runtime state; stale public market evidence cannot rank.
- Idle per-symbol generic/route decisions and residual long diagnostics; shared capacity remains unknown.
- V52 configured stock universe merged with telemetry. Market closed and unobserved final order eligibility are unranked, not assumed failures.

FET audited config SHA256 `59a3b754b7041387a4e3c783877fd9aa948cbe285554fb87e6e2955c27b07d51`; signal source SHA256 `73a1aa519b7db69ac8f4771f422530a6d40d2ec712116be806fdebc58911f30f`. Policy/source changes fail closed as observation unknown until reviewed.

## Verification

11 pure tests pass, including strict breakout equality, volume boundary, completed/future bars, missing/duplicate data, entry cutoff, source timestamp skew, hour expiration, execution block ranking, stable ties and movement detection.

Linux production dependency install, full TypeScript check and Next16.2.6 production build passed in an isolated staging directory. Existing source needed explicit callback type annotations with the locked dependencies; these do not alter trading logic.

Isolated preview APIs returned401 without cookie and successful read-only/tradingMutation0 responses with cookie.49 symbol/logic/direction rows were observed: V12 14, Q10219, PENGU2, FET1, HYPE1, Idle Short5, Idle Long2, V525. Desktop/mobile rendered; no page errors or horizontal overflow. Gold rank flash tested with a browser-only mocked changed ranking; reduced-motion animation disabled correctly. Preview browser blocked mutation requests and used a synthetic local UI profile.

Deployment evidence is recorded in `realtime-ranking-deployment.md` after the UI service switch.
