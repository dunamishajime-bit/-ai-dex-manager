# V4 bounded evidence refresh contract

The v3 certificate continues to seal all five evidence files by their exact
original hashes. A refresh must not silently modify that contract. The root
refresh worker therefore refuses apply unless a separately issued exact-SHA v4
certificate explicitly selects `BOUNDED_ROOT_REFRESH_V1` and acknowledges
`I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS_WITH_BOUNDED_DYNAMIC_REFRESH`.
No existing certificate is converted or re-dated by this code.

The v4 certificate seals the same release, routes, risk caps and static evidence.
Only its three mutable evidence payloads may come from a root-owned atomic
`/etc/disdex/v12-v4-evidence/refresh-commit.json`. The bundle contains each payload,
its actual SHA-256, a common generation/capture timestamp and the original bounded
lease identity, plan digest and expiry. Runtime validates every payload hash and
the normal evidence content before use. It reads one atomic bundle, so it cannot
combine old and new generations while the worker replaces standalone evidence
files. Release-static proofs remain SHA/hash sealed; mutable proofs expire in
15 minutes. The certificate's own validity and separate operator activation are
unchanged by refreshing evidence.

The worker samples shared runtime after its sequential signed GETs, rechecks the
same lease immediately before publication, and refuses another release's existing
targets. It preserves the evidence reader group with mode 0640, keeps its private
output 0600, and fsyncs staged bytes. It never writes the Production certificate,
orders activation, Kill Switch, pending registry, strategy state or runner pins.
Its timer uses ten minutes plus bounded jitter to refresh before the fifteen-minute
freshness boundary. Service failure triggers the existing health-alert service;
delivery still requires operational verification.

An expired genuine lease or stale genuine bundle keeps new orders blocked and
lets the daemon retry with heartbeat distinct from completed ticks. Malformed
authority, SHA drift, incorrect hashes, payload mutation claims and mixed
generations remain fatal. Root-owned filesystem checks are mandatory before any
bundle is trusted. An unprivileged application report cannot create this authority.

The lease remains limited to 24 hours. Renewal requires a new legitimate operator
authorization through the existing owner-signature or authenticated Codex root-SSH
route; a timer cannot reuse an approval nonce or extend its own lease. Certificate
issuance, lease issuance and order activation are separate operations. Deploying
this source or staging its reports does not perform any of them.
