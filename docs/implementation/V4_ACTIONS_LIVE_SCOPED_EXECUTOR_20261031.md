# V4 GitHub Actions exact-scope LIVE executor (source implementation)

## Objective
Use the existing disdex-production owner-reviewed GitHub Actions environment
and its restricted forced-command SSH identity to activate an exact V12_V4
immutable release only after independent root-controlled proofs pass.

**CURRENT STATUS: SOURCE IMPLEMENTED; NOT ACTIVE; NOT LIVE.** This change does not
modify production, owner keys, staged releases, positions or resident STOPs.

## Implemented contract
- Signed owner token with exact SHA/V12_V4 scope, ordersEnabled=true, plan digest,
  GITHUB_ACTIONS route, expiry and single-use nonce.
- Root-owned current/desired plans and exact V4-only SHA delta; peer SHA and
  STOP ownership pinned.
- Immutable SHA-local executable and readiness, short-lived root-only V4
  activation with explicit acknowledgement.
- Fresh independent root-owned signed GET/STOP/risk evidence before mutation;
  never manufacture evidence to satisfy this requirement.
- Nonblocking root-wide deployment lock (Actions and CODEX_SSH).
- Stop+mask old V4, update only V4 pin/plan/activation, start candidate, verify
  three distinct after-cycle venue records; on failure roll back changes.

## BLOCKERS until first production deployment
1. Owner-controlled, passphrase-protected Ed25519 signer for the existing
   owner_approval.py tool. Deploy its PUBLIC PEM to both the protected GitHub
   environment Secret DISDEX_PRODUCTION_APPROVER_PUBLIC_KEY_PEM and the root-only
   VPS owner-approval-public.pem path. Do not upload private signer to GitHub.
2. Provision root-only current/desired plans and complete nine-runner pins from
   independent actual VPS systemd readback, never from guessed defaults.
3. Independently stage exact CI-certified immutable release and install
   updated root helper with a trusted root operator.
4. Implement an authentic Aster read-only signed account/STOP/risk witness
   writer for venue-before.json and 3 fresh, increasing after-cycle records.
   The fixture-only evidence booleans are not production attestations.
5. Prove the candidate cannot cancel or replace the resident DOGE STOP during
   startup/handover; candidate-specific root operator activation is necessary.
6. Move production workflow to master after review, confirm environment policy
   and forced-command restrictions. Do not set DISDEX_DEPLOYMENT_POLICY_READY
   to OWNER_ENV_LOCKED_V1 until all prerequisites pass.
7. Reconfirm Shared Risk, Kill Switch, margin, pending exposure and all peers
   from the live venue before approving first production deployment.

NO unattended LIVE orders. No production changes in this branch.
A green SSH transport check is not proof of LIVE authorization.

Production metadata permissions follow the actual root-owned layout:
runner-pins.json may be published 0644 in root-owned 0755 /etc/disdex;
the shared operator activation directory may be root-owned 0755 while the
v12-v4-full.json artifact itself remains atomically written 0600. This
does not relax owner approval, nonce, venue, or STOP checks.
