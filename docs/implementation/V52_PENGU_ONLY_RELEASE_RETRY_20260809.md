# V52 + PENGU_DUAL_LS_V1 release retry marker

This commit creates a new immutable release identity after the previous deploy attempt for commit 3cf146bd68b03d655cf2616a1bd9d12f497407c9 returned an indeterminate Cloudflare 502 response.

No strategy logic changes are introduced by this marker commit.

Intended runtime composition:
- PENGU_DUAL_LS_V1 enabled as the crypto strategy
- V52 enabled as the stock strategy
- V96/V97 not started by the V52+PENGU-only supervisor

This marker exists solely to provide a new 40-character Git SHA for a single fresh deploy attempt under fail-closed bridge policy.
