# V4 direct recovery: observed state and remaining work

This is a point-in-time operational handoff, not a production approval or a
claim that the system remains flat. Re-read the venue and runtime before any
production action. The owner has authorized Codex to use direct root SSH; the
execution route does not replace risk, order, or STOP checks.

At 2026-11-02 05:24 UTC, the measured V4 pin was
`53a0be396719f0284af4e11b35c66a4ac7d58f79`; its systemd unit was failed with
PID 0. The candidate `3524e3676848b9260f53164e07257acdda7bcc5c` was staged,
but its V4 unit was inactive and was not cut over. `current` remained at
`7688ed7c93a1918d8b44837339b7da5584a868f5`.

The read-only Aster refresh at 05:14 UTC recorded no nonzero venue positions
and no open orders; active pending exposure was zero. This evidence is now
historical and must be refreshed under the shared rate budget before use.
The current evidence files were regenerated for candidate `3524...`, not for
the old V4 pin. Do not restart the old V4 assuming its evidence still matches.
The candidate refresh timer was disabled after an installer ownership error;
the V4 runtime directory was restored to `deploy:deploy 0700`.

## Remaining before any V4 order-enabled cutover

- Select an exact reviewed source SHA without merging the divergent PR #407
  wholesale; preserve current master and independently pinned peer releases.
- Separate root-owned refresh output from the deploy-owned V4 runtime
  directory. The tested proposal is local commit `b606c815` on the preserved
  #407 branch and is not deployed or validated against current master.
- Provision and validate the candidate-SHA runtime environment and effective
  systemd loader without restarting or changing unrelated runners. The
  `3524...` candidate had no `/etc/disdex/current-runtime/<sha>.env`, and
  its effective unit still used `node_modules/.bin/tsx`.
- Reconcile and transactionally migrate the durable V4 store from its actual
  old SHA to the selected SHA. It was root-owned mode 0600, while V4 runs as
  `deploy`. Three recorded legs were CLOSED with zero quantities and all nine
  intents were TERMINAL at inspection; preserve their history and verify fresh
  signed venue and pending evidence before changing ownership or lineage.
- Resolve peer attestation with verified runtime state. PENGU was inactive,
  FET was failed after an ENOSPC error, and V52 was inactive. A temporary
  PENGU no-order peer-stop certificate does not itself make V4's runtime peer
  attestation accept the stopped service. Do not infer service health from
  the certificate, and do not start other runners as a side effect of V4 work.
- Establish and test an order-disabled V4 startup and real tick/heartbeat
  audit before order authority is enabled. The old #407 executor constructs
  an orders-enabled activation before startup and its post-start witness does
  not by itself prove that no order happened between observations.
- For non-flat venue state, independently prove per-runner STOP ownership,
  partial fills and gross. The extracted witness deliberately refuses
  non-flat evidence instead of asserting ownership it has not proven.
- Verify the actual runner SHA, systemd effective configuration, fresh signed
  GET, 7.5% Shared Risk limit and UTC freshness, Margin Guard, Kill Switch,
  account lock, pending, heartbeat, and three post-cutover audit cycles.

PR #412 only carries isolated evidence-validation improvements. Its V4
witness is not yet wired into the production executor, and a green CI check
does not constitute a live deployment or order authorization.
