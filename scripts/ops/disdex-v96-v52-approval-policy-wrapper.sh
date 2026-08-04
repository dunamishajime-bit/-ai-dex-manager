#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

policy_script="$(pwd -P)/scripts/ops/disdex-v96-v52-live-policy.sh"
[[ -f "$policy_script" && ! -L "$policy_script" ]] || {
  printf 'fixed LIVE policy script missing\n' >&2
  exit 1
}
# shellcheck source=scripts/ops/disdex-v96-v52-live-policy.sh
source "$policy_script"
disdex_apply_v96_v52_fixed_live_policy
disdex_assert_v96_v52_fixed_live_policy

sha="${DISDEX_V96_APPROVED_COMMIT_SHA:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'approval wrapper requires an exact commit SHA\n' >&2
  exit 1
}

/usr/bin/bash scripts/ops/disdex-v96-v52-renew-approvals.sh

override_file="${DISDEX_V96_OPERATOR_OVERRIDE_FILE:?DISDEX_V96_OPERATOR_OVERRIDE_FILE is required}"
DISDEX_POLICY_APPROVAL_FILE="$override_file" \
DISDEX_POLICY_APPROVED_SHA="$sha" \
  /usr/bin/node <<'NODE'
const fs = require("node:fs");
const path = process.env.DISDEX_POLICY_APPROVAL_FILE;
const sha = process.env.DISDEX_POLICY_APPROVED_SHA;
if (!path || !sha) throw new Error("policy approval validation inputs are missing");
const approval = JSON.parse(fs.readFileSync(path, "utf8"));
const exact = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
};
exact(approval.status, "APPROVED", "status");
exact(approval.approvedCommitSha, sha, "approvedCommitSha");
exact(Number(approval.initialPenguGrossCap), 1.15, "initialPenguGrossCap");
exact(Number(approval.maximumPortfolioGross), 1.5, "maximumPortfolioGross");
exact(Number(approval.maximumDailyLossPct), 5, "maximumDailyLossPct");
if (!/^[0-9a-f]{64}$/i.test(String(approval.artifactSha256 || ""))) {
  throw new Error("artifactSha256 is invalid");
}
process.stdout.write(JSON.stringify({
  status: "DISDEX_V96_V52_FIXED_APPROVAL_POLICY_PASS",
  approvedCommitSha: approval.approvedCommitSha,
  initialPenguGrossCap: approval.initialPenguGrossCap,
  maximumPortfolioGross: approval.maximumPortfolioGross,
  maximumDailyLossPct: approval.maximumDailyLossPct,
  combinedPortfolioGrossCap: 2.5,
  reservedFirstStockGross: 1.0,
}) + "\n");
NODE

# Re-run authenticated read-only validation after the shared artifact has been
# installed, with the fixed policy applied after every EnvironmentFile value.
DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
  /usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly

printf 'DISDEX_V96_V52_APPROVAL_POLICY_WRAPPER_PASS\n'
printf 'approvedCommitSha=%s\n' "$sha"
printf 'v96CryptoSleeveGross=1.5\n'
printf 'combinedPortfolioGross=2.5\n'
printf 'reservedFirstStockGross=1\n'
printf 'initialPenguGrossCap=1.15\n'
printf 'maximumDailyLossPct=5\n'
printf 'requiredInitialLeverage=5\n'
printf 'requiredMarginType=cross\n'
printf 'penguDualMode=LIVE\n'
printf 'ordersSent=false\n'
printf 'cancelSent=false\n'
printf 'positionChangesSent=false\n'
