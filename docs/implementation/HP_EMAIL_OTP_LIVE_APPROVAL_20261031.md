# HP Email-OTP Production Approval Route — 2026-10-31

## Status

SOURCE READY FOR REVIEW — NOT WIRED TO THE FINAL LIVE EXECUTE STEP.

This change adds an owner-facing approval surface to DisDexDeployer and preserves the existing deployment authorization contract:

- exact source SHA
- exact root-owned plan SHA-256
- scope fixed to `V12_V4`
- operator fixed to `dunamishajime-bit`
- route fixed to `GITHUB_ACTIONS`
- `ordersEnabled=true`
- Ed25519 signature
- maximum approval TTL of 300 seconds
- one-time redemption bound to one GitHub Actions run ID

The HP approval route does not itself execute a Production cutover in this branch.

## Flow

1. An allowed GitHub actor creates an exact request comment:

   `DISDEX_DEPLOY_REQUEST V12_V4 SHA=<40hex> PLAN=<64hex>`

2. `.github/workflows/disdex-v4-hp-approval-request.yml` validates the actor and exact grammar, then publishes a pending request to:

   `POST https://professional-dismanager.net/api/system/deploy-approval`

3. The admin page shows the exact SHA, plan hash, scope, requester, request ID, and expiry.

4. The owner presses **メール認証してLIVE切替を承認**.

5. The server sends a six-digit OTP to the configured administrator email.

6. OTP controls:
   - cryptographically secure code generation
   - 5-minute expiry
   - maximum 5 attempts
   - 30-second resend cooldown
   - HMAC-SHA256 storage using a separate OTP pepper
   - no plaintext OTP persistence

7. After successful OTP verification, the HP issues an Ed25519 token that is byte-compatible with:

   `scripts/ops/deploy/disdex_owner_approval.py`

8. The token is bound to the exact deployment identity and expires within 300 seconds.

9. The authenticated system bridge can redeem the token once. A retry by the same GitHub run ID is allowed during the same token lifetime; a different run ID is rejected.

## HP / Next.js required configuration

Production must configure the following server-side values.

### Existing mail configuration

One of:

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

or:

- `SENDGRID_API_KEY`

The approval receiver is:

- `ADMIN_CONTACT_EMAIL`, falling back to `GMAIL_USER`

### New approval configuration

- `DISDEX_DEPLOY_OTP_PEPPER`
  - high-entropy random value
  - separate from all GitHub, SSH, exchange, and signing credentials

- `DISDEX_HP_APPROVAL_BRIDGE_SECRET`
  - high-entropy random value
  - shared only with the GitHub approval-request workflow / future formal approval consumer
  - never place in client-side environment variables

- One of:
  - `DISDEX_HP_APPROVER_PRIVATE_KEY_PATH`
  - `DISDEX_HP_APPROVER_PRIVATE_KEY_PEM`

- Optional for an encrypted Ed25519 private key:
  - `DISDEX_HP_APPROVER_KEY_PASSPHRASE`

Prefer a dedicated HP approval Ed25519 key. Do not reuse the SSH private key, exchange API credentials, or another signing key.

### Persistent approval storage

Preferred:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN`

or compatible Upstash aliases.

Filesystem fallback is supported for development. Production should use durable restricted storage.

## GitHub configuration

Required for the request-publish workflow:

- Repository secret:
  - `DISDEX_HP_APPROVAL_BRIDGE_SECRET`

- Repository variable:
  - `DISDEX_DEPLOY_ALLOWED_ACTORS`

The HP signer public key should be installed as the public verifier key used by the formal Production authorization path before final LIVE wiring.

## VPS configuration

The public half of the dedicated HP Ed25519 signing key must be installed into the root-owned verifier location used by the formal deployment helper.

The private key must never be copied into the Git repository or GitHub Actions runner.

## Final formal workflow wiring

The final Production workflow integration should:

1. accept an `approval_id`,
2. redeem the approval through the authenticated HP system bridge,
3. verify exact:
   - request ID
   - SHA
   - plan SHA-256
   - scope
   - status
   - GitHub run ID binding,
4. mask the returned token,
5. verify it with `disdex_owner_approval.py verify`,
6. pass the same token through stdin to the root-owned preflight and execute helper,
7. destroy all ephemeral token/public-key/SSH material in `always()`.

Do not bypass the existing root-owned canonical plan, runner pins, venue evidence, protective STOP, Shared Risk, Kill Switch, pending-exposure, or peer-health gates.

## Test

Run:

`npm run deploy:hp-approval:selftest`

The selftest generates a temporary Ed25519 keypair, issues a token using the HP TypeScript implementation, and verifies it with the existing Python Production verifier. It also confirms that a mismatched plan hash is rejected.

## Current boundary

This branch intentionally stops at authenticated owner approval + signed proof generation + one-time redemption API.

It does not modify or execute the final `ordersEnabled=true --execute` Production step.
