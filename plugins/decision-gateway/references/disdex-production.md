# DisDex production profile

Use Decision Gateway as a read-only advisory layer. Existing fail-closed runtime logic remains authoritative.

Typical hard checks before calling a state healthy:
- deployed/runtime SHA matches the intended Production SHA
- required trading/risk services are active
- shared kill switch is inactive
- Margin Guard is HEALTHY and ordersAllowed is true
- no unresolved operator review or malformed/pending state
- state migration/reconciliation checks required by the changed component pass

When an open position exists, verify its managed protective orders separately.
A missing, contradictory, stale, or inaccessible hard check must not be converted to PASS.
Unknown production evidence should stay UNKNOWN or NEED_SOL.

Do not let this plugin place, cancel, resize, or restore orders.
Do not let it clear a kill switch or operator-review requirement.
