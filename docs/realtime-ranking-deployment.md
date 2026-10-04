# XServer UI deployment —2026-10-04

- UI source commit: `0a67db6d92d65b7306bbfddee1da77081387e027`.
- Branch: `codex/realtime-ranking-20261004`.
- New UI release: `/home/deploy/disdex-trading/ui-releases/ui-realtime-ranking-0a67db6d92d6`.
- Previous UI release preserved: `/home/deploy/disdex-trading/ui-releases/ui-modern-newlogic-0ebc831b98aa`.
- Only service restarted: `ai-dex-manager-ui.service`.
- UI override backup: `/home/deploy/disdex-trading/backups/ui-realtime-20261004/90-current-ui-release.conf`.
- Trading release before/after: `b9a0c86d6cf72b0209e44edc8883e45e6d241c5b`; trading symlink, parameters, services and persisted trading state were not mutated.

## Public verification

- `https://professional-dismanager.net/realtime`:200.
- `https://professional-dismanager.net/decision-status/fet`:200.
- Both new observation APIs:401 without authentication, success with authentication, `readOnly:true`, `tradingMutation:0`.
- Ranking returned49 rows and no source errors: V1214, Q10219, PENGU2, FET1, HYPE1, Idle Short5, Idle Long2, V525.
- Deployed browser verification:49 board rows; desktop/mobile render; no mobile horizontal overflow; no JavaScript page errors; FET named gate inventory visible; simulated changed ranking produced gold flash; reduced-motion disabled animation.

The browser verification used an isolated local test profile and blocked all mutation requests. Rank-change simulation mocked only that browser's ranking response; it did not change any VPS state.

At verification FET market gates were passing (completed close0.2413 > previous48h high0.2369; volume ratio40.154 vs threshold1.2), while holding, processed-signal and closed entry-window constraints blocked a new entry. These are a dated observation, not fixed displayed values.

## Remaining observation limits

Account balance, residual capacity, quantity sizing and private venue order checks remain runner-time confirmation. PENGU snapshot has no SHA field, so the UI separately verifies current heartbeat lineage and shows the snapshot SHA as unknown. V52 final order eligibility is unknown where existing telemetry exposes only basis candidates; market-closed stocks remain listed and unranked. Closeness scores are a gate-completion monitoring heuristic and are not calibrated trigger probabilities.
