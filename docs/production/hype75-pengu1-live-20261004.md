# HYPE75 + PENGU fixed gross 1.0 deployment overlay

Base: exact active Production commit 53eeff5417636369d4709fddfd47d7916ddcf3b1.
Authorized scope: the operator requested implementation and real-money LIVE activation of HYPE revised + Pengu1.0 on the Xserver VPS on 2026-10-04.

HYPE: completed-hour EMA240 growth over 24 hours must be at least 75 basis points (0.75%), previously 25. Existing ATR exits, sizing and shared safety remain enforced. Backport the upstream flat pre-request rate-budget denial recovery so a harmless local queue denial holds entries instead of poisoning runner state. Owned positions, pending submissions and post-read failures still fail closed.

PENGU: all new accepted ordinary long, short and recovery entries request gross 1.0. A planner allocation below 1.0 holds the entry; available balance remains collateral checked by the 5x CROSS executor. Existing position exits are preserved. Recovery at gross 1.0 halves to 0.5; legacy recovery gross 0.5 halves to 0.25 and is still loadable. Gross denotes the target before exchange lot rounding and later mark-to-market changes.

Deployment evidence scope: this overlays the existing production Core settings. It does not promote the separate research Core with Q102 BRK/MR 0.75 and FET 1.0. The prior diagnostic BT ending JPY 3.2836 billion and HYPE 16/22 wins is therefore not a certified performance claim for this full production configuration. Existing Idle certificates attest their frozen historical replay contracts and unchanged Idle source, not a fresh integrated HYPE75/PENGU1 backtest.

Validation: 80 HYPE/PENGU tests passed; TypeScript passed; PENGU ordinary, SHORT_V20, recovery/protection/parity, dynamic analytical and gross selftests and HYPE shadow selftest passed. Full suite 425/429 passed. The same four failures reproduce on the unmodified base: two cloud OS/user fixtures and two stale strict-planner fixtures.

Cutover: stage an exact-SHA release without disturbing the legacy working tree, preserve protective orders and the existing PENGU short, back up states and root activation artifact, reconcile against fresh authenticated read-only exchange snapshots, recover only the known flat pre-request HYPE rate-budget review, migrate runner lineage, revalidate the frozen Idle certificates with unchanged-source evidence, apply release-local runtime wiring, and verify unified running SHA and safety after activation. No private keys or exchange credentials are copied into source control.
