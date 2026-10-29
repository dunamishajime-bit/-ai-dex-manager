# DisDex Unified Owner-Approved Deployment - Staged (2026-10-30)

STATE: SOURCE READY FOR CI REVIEW. NOT LIVE.

This branch adds a proposed unified workflow entry point and a time-limited,
Ed25519 owner approval verifier. It does NOT change LIVE systemd, orders,
STOPs, gross, kill switch, or any VPS operator artifact.

## Authorization model

The owner and the owner's expressly authorized GPT GitHub App principals may
prepare or request deployments. Only the owner can approve real-money LIVE.

A password is required on the owner's trusted device to decrypt an encrypted
Ed25519 signing key. GitHub Actions receives only a signed public authorization
token: repository, SHA, exact scope, immutable plan SHA-256, operator, nonce, issue time and expiry
(maximum 300 seconds). Neither the password nor private key is sent to GPT,
GitHub Actions inputs, repository files, VPS or logs.

Independent approval must ALSO happen through the GitHub protected Environment
named disdex-production. The owner must be its only required reviewer.
The environment secrets are released to the job only after that review.
If the sole owner starts and reviews the workflow, do not select the GitHub
Prevent self-review option.

## One-time owner setup required before enabling LIVE

1. Protect master, workflow files, approval code and deployment policy using
   GitHub branch/ruleset controls. The current production development branch
   differs materially from master. Only audited bootstrap files should be
   ported to master; DO NOT merge the whole trading branch into master.
2. Create GitHub Environment disdex-production, owner-only required reviewer,
   restrict to master, disable administrative bypass where possible.
3. Create a NEW forced-command deploy SSH key, without general root shell.
   Root-owned helper /usr/local/sbin/disdex-unified-production-deploy must
   independently validate:
   - owner approval signature and root-pinned public key;
   - signed SHA, scope, target, source and unique nonce (single-use journal);
   - current/next immutable markers and runner-specific SHA map;
   - exact scope; no trading owner or permission changes for peer-only update;
   - real signed Aster venue truth; STOP owner, protective qty, account budget;
   - shared 7.5% loss limit; fixed Gross, pending, lock; no double risk Writer;
   - no new synthetic tick markers; genuine writer/reader compatibility;
   - post-cutover three cycles and safe rollback with no unsafe STOP operations.
4. The root helper is NOT implemented in this source-phase branch. Without it
   the new workflow MUST fail before any production mutation.
5. Add to GitHub Environment secrets ONLY (not repository-level Secrets):
   DISDEX_PRODUCTION_SSH_HOST, DISDEX_PRODUCTION_SSH_PRIVATE_KEY,
   DISDEX_PRODUCTION_SSH_KNOWN_HOSTS,
   DISDEX_PRODUCTION_APPROVER_PUBLIC_KEY_PEM.
   Add Environment vars:
   DISDEX_PRODUCTION_OWNER_LOGIN, DISDEX_DEPLOY_ALLOWED_ACTORS (comma-separated),
   DISDEX_PRODUCTION_SSH_PORT.
6. DISDEX_DEPLOYMENT_POLICY_READY must remain UNSET. Set its value to
   OWNER_ENV_LOCKED_V1 ONLY once protected Environment, root helper, rollback,
   production permission checks, legacy workflow revocation and signed
   approval are fully verified.
7. After the new path works, remove old write-capable Actions workflows,
   rotate/revoke old repository-level root SSH credentials and old VPS
   sudo/authorized_keys deploy rights. Keep read-only audits and CI.

## Owner password / signing instructions (owner's device ONLY)

Requires OpenSSL 3 and Python 3:

  openssl genpkey -algorithm ED25519 -aes-256-cbc -out disdex-owner-private.pem
  openssl pkey -in disdex-owner-private.pem -pubout -out disdex-owner-public.pem

Encrypted private key must be backed up securely and NEVER copied to GPT.
Root-side helper and protected GitHub environment need only the public key.
Signing prompts locally for the key password:

  python scripts/ops/deploy/disdex_owner_approval.py sign \
    --key disdex-owner-private.pem \
    --repository dunamishajime-bit/-ai-dex-manager \
    --sha EXACT_40_CHARACTER_SHA \
    --scope SHARED_CRYPTO_RISK_ONLY \
    --plan-sha256 SHA256_OF_CANONICAL_IMMUTABLE_DEPLOY_PLAN \
    --operator YOUR_GITHUB_LOGIN

Paste the signed token (not the password) into the workflow_dispatch
owner_signed_token input. A token is bound to SHA and scope and expires
after five minutes; root nonce journal must reject reuse.

## Supported deployment scopes

FULL_PROJECT, V12_V4, QUALITY102_CAUSAL_V1, V52, PENGU_V8,
FET_BRK48_RESIDUAL, HYPE_TREND_LONG, IDLE_PRIORITY_SHORT,
SHARED_CRYPTO_RISK_ONLY, MARGIN_GUARD_ONLY, API_MONITORS,
HP_ONLY, ROLLBACK.

For SHARED_CRYPTO_RISK_ONLY, ensure old/new Writer mutual exclusion and leave
all other services, peer order permissions and protective orders unchanged.
Never use the existing all-runner disdex-current-runtime-wiring --apply for
this specific scope.

## Honest limitations

Environment protection settings, SSH secrets, root deployment helper,
password/key generation and live activation require the repository owner and
an authorized VPS operator. They have NOT been performed. This PR provides
a signed-approval verifier plus a workflow that FAILS CLOSED until all such
requirements are met. There is no claim of LIVE_VERIFIED or a finished
single-path deployment. The old workflows must not be deleted before a tested
replacement and rollback exist.

Signed planSha256 must equal a root-verified immutable deployment plan hash
covering every runner SHA, STOP owner, target service and HP release. The
VPS helper must recompute this hash from the pinned plan, not trust a caller-
supplied hash. This prevents FULL_PROJECT multi-SHA substitution.

## Legacy paths inventory
Use python scripts/ops/deploy/audit_legacy_deploy_paths.py to enumerate
GitHub Actions workflows that reference legacy VPS root secrets or SSH.
It only reports filenames, not secret values. Enable --require-retired only
after the new, independently verified deployment and rollback work. The
presence of old root keys is a SECURITY BLOCKER for exclusive control.

## Canonical exact-scope plan hash
The root helper must generate two validated plan JSON files: current actual
runner SHA map obtained from systemd and desired immutable target. Run
  python scripts/ops/deploy/disdex_deployment_plan.py --desired plan.json --current current.json
and approve the printed SHA-256 plan hash. The owner must independently
inspect the full plan before signing, and root must independently reconstruct
and re-hash it before changing any service. Source policy refuses out-of-scope
runner changes for individual deployments and HP/monitor-only updates.
