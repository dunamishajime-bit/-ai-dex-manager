# PR #481 — Active LIVE pin versus source-model BT audit (2026-11-14)

**Status: BLOCKED_FULL_LIVE_PARITY. This is a research-read-only comparison, not a trade certification.**

## Evidence and method

- Repository: dunamishajime-bit/-ai-dex-manager; PR #481 remains Draft.
- VPS: professional-dismanager.net, owner-authorized root SSH with strict host-key checking.
- Source snapshot: `systemctl list-units --type=service --all --no-pager --plain` captured read-only.
- Snapshot SHA256: `ec9ecb27b5dbc5a1d6cc461a279e8a28113c811df464b8dcc13ccb131c993266`.
- Original model entry evidence: both 10bps and 30bps `*_MODEL_ENTRIES.csv` produced directly by the STABLE4 source-engine observer.
- Reproduce with `python scripts/bt_hp_live_pin_comparison.py --systemd-snapshot PRIVATE_SYSTEMD_SNAPSHOT.txt --model-entries PRIVATE_10BPS_MODEL_ENTRIES.csv PRIVATE_30BPS_MODEL_ENTRIES.csv --output PRIVATE_AUDIT.json`.
- The offline script never SSHes, sends orders, restarts services or edits production. Missing, duplicate, invalid or ambiguous SHA evidence fails closed.

## SHA comparison

| Runner | Active systemd release SHA | Source model SHA | Result |
| --- | --- | --- | --- |
| V4 | `795fefbbbb1c1176c80c7fd8391347578dadd0d5` | `53a0be396719f0284af4e11b35c66a4ac7d58f79` | PIN_MISMATCH |
| Q102 | `ef1ab178e26a7bf5bddb6473467765edba242e1d` | same | PIN_SHA_MATCH_ONLY |
| PENGU | `1657e173d250ad58f53e62f7bb0a3428fb405496` | same | PIN_SHA_MATCH_ONLY |
| FET | `7688ed7c93a1918d8b44837339b7da5584a868f5` | same | PIN_SHA_MATCH_ONLY |
| HYPE | `a7eee1f91d86d51f2333da117243d044ae1332dc` | `7688ed7c93a1918d8b44837339b7da5584a868f5` | PIN_MISMATCH |
| IDLE | `7688ed7c93a1918d8b44837339b7da5584a868f5` | same | PIN_SHA_MATCH_ONLY |
| V52 | `8495daf24e53a6cf0dd5e38f022008fa8f78c688` | same | PIN_SHA_MATCH_ONLY |

The running service identity is not proof that new orders are enabled or that its economics exactly match the historical model. V52's available historical model is still a price proxy, and code SHA equivalence cannot prove historical market data, exit, STOP, funding, execution, or full Shared Risk parity.

## Formal HP deployment readiness

Read-only VPS filesystem check: `/dev/vda1` 48 GB capacity, 46 GB used, about 1.4 GB free, 98% utilization. Active release symlink `/home/deploy/disdex-trading/current` points to `7688ed7c93a1918d8b44837339b7da5584a868f5`; other live runner units are pinned separately as above. Do not treat the common `current` symlink as every runner's SHA.

**Do not mark this BT CANONICAL_LIVE_PARITY or merge/deploy this PR merely because the 10bps/30bps replays pass schema validation.** Correct prerequisite sequence:

1. Identify economic and lifecycle differences between V4 53a0 vs 795f, and HYPE 7688 vs a7eee; rebuild against the exact intended active releases or prove code-equivalence using audit evidence.
2. Revalidate entry, exit, STOP, Funding, fees, Shared Risk/Gross arbitration, source quantities and no-look-ahead behavior under pinned as-of inputs.
3. Re-run the source-engine model position observer and strict adapter against corrected research data, regenerate private replays and SHA256 index, verify non-fabricated quantity and category-Gross attribution.
4. Restore safe VPS disk headroom and verify private data directory permissions, owner-only authentication and URL/CSP isolation.
5. Run browser E2E, owner-approved GitHub Actions production workflow and separate post-deploy read-only checks. Never bypass the owner approval gate.

Production services/positions/orders/STOP/Kill Switch were not modified for this audit. The model Gross replay is a research visualization only.