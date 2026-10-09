# V12 V4 high-profit case: production and position parity audit — 2026-10-09

STATUS: **BLOCKED_PRODUCTION_PARITY** — account position ownership reconciled; V4 real-order/Exit/Gross/Billing parity NOT certified. No LIVE actions were performed.

## Fixed authoritative anchors

- Current Xserver VPS release link and marker: `ce1edeead8d0f9e5d88e829d415057117502a335`.
- Selected research policy: `V2_M150_D05_CORE_NATIVE`; 41 routes and complete-year hindsight-based rank table (not an out-of-sample-trained policy).
- Prepared, **non-ordering Shadow/HP code**: `codex/v12-v4-v2-m150-implementation-20261009`, commit `0956bb2b1c5f887a998b7f4364a2ec8b84527a9c`.
- Git ancestry proof: the deployed `ce1edeea` SHA is an ancestor of the candidate branch, 6 commits behind. It does **not** prove live strategy parity.
- Independently rerun price-model research portfolio: `research/v12-v4-forward-robustness-20261009`, commit `a835a68b`, 12/12 JSONL/metrics SHA256 match, 10/20/30bps. Research model scope ≠ current VPS runtime.

## Authenticated Aster read-only account and exact ownership evidence

Executed the existing `scripts/disdex-aster-readonly-account-diagnostic.ts` from the currently deployed release using its normal service environment, with **GET-only** client calls. No orders, cancellations, margin changes or position mutations.

| Account item | Aster readback | VPS state | Certification |
|---|---|---|---|
| TSLAUSDT | +0.38 LONG @ 372.64 | V52 runner: `V50_POST_OPEN_BASIS` route, `TSLA` | **PASS** identity; quantity additionally recorded in `asterQty` |
| PENGUUSDT | -7,718 SHORT @ 0.008574 | PENGU Dual LS V2 runner: SHORT V20, side=-1, qty=7,718, entry 0.008574, gross=1 | **PASS** |
| PENGU close protection | Exactly one open `BUY STOP_MARKET` order, `reduceOnly=true`, quantity 7,718 | PENGU residentStop: BUY, qty 7,718, readBackStatus=VERIFIED, stopPrice in runner state 0.009259 | **PASS** order direction/quantity/purpose; stopPrice on venue was not separately sampled |
| XRPUSDT V12 stale pending | No XRP position, no open XRP order; authenticated `getOrder` lookup for pending client ID returned 400/-2013 (not found) | V12 has stale `pending` ENTRY SHORT for XRPUSDT 42.1919029293 | **PARTIAL**: no contemporaneous exposure, but persisted pending must be reconciled, not blindly deleted |

Additional read-only `getUserTrades('XRPUSDT')` request starting two hours before the pending timestamp returned zero rows. Do not treat this as proof of every possible historical order/fill; use documented idempotency reconciliation before unlocking V12.

Current holdings were **two** positions, not two guaranteed runner entities named V52 and PENGU: TSLA position's *internal subroute* is V50_POST_OPEN_BASIS, owned by the V52 family runner.

## Operational gates and configuration comparison

| Gate | Actual LIVE evidence | Selected V2 BT contract | Verdict |
|---|---|---|---|
| Release coherent | current marker `ce1edeea` on active runners | new V2 LIVE order bridge not present in current release | **FAIL for V2** |
| V12 running | `disdex-v12-x1-all@ce1edeea.service` **failed** since 2026-10-09 07:13 JST | V12 must actively produce 41-route independent candidates and exits | **FAIL** |
| Shared Kill Switch | `active=true`, `action=HOLD_PROTECTED`, `recoverable=true`; originated at V52 TSLA quote stale HTTP503, 39,504ms vs 30,000ms maximum quote age | No entry while protected hold | **BLOCKED** |
| Global order lock | `account-order.lock` contains a currently refreshed, nonexpired owner lease, not an orphan to remove | serialized account/order admission and gross reservation | **DO NOT DELETE** |
| V12 gross | `V12_GROSS_CAP=2.0`, `V12_DYNAMIC_GROSS_CAP=2.0` | **3.0x** | **MISMATCH** |
| Crypto gross | `CRYPTO_GROSS_CAP=3.0` | **3.5x** | **MISMATCH** |
| Total gross | `TOTAL_GROSS_CAP=4.25` | **4.75x** | **MISMATCH** |
| Recovery family gross | no matching effective explicit live V2 family admission identified | **2.5x** | **NOT PROVEN** |
| PENGU position safety | 1.0 gross SHORT and exact active reduce-only STOP | preserve 1.0 gross + existing exit ownership | **PASS existing leg** |
| V52 position safety | TSLA +0.38 long under V50 subroute | preserve stock position/exit and slot ownership | **PASS existing leg** |
| V4 41-route Entry parity | `lib/v12-v4-v2-shadow.ts` accepts typed source features; second pass requires causal entry-time H1 features; no live H1 feature adapter in this implementation | exact two-pass source and entry timestamp predicates | **NOT PROVEN** |
| V4 virtual-leg Exit parity | shadow only emits `plannedExitPolicy` text, not executable live Exit, recovery leg state or venue order reconcile | executable 41-route Exit/residency/preemption | **FAIL** |
| Real order ownership | all V2 snapshots: `orderEnabled=false`, `tradingMutation=0`, `realOrderEnabledV4=0` | production LIVE execution with invariant checks | **NOT IMPLEMENTED** |
| Venue quantities/fills | V2 source price-model replay used `strict_quantity=false`; H1 price model not L2 verified | exact live minNotional/minQty/precision, post-only? slippage/order status/funding | **NOT PROVEN** |
| Q102 historical selector | replay partial HIGH_VOL + noncolliding candidate stream | current fully implemented Q102 source/selector history | **NOT PROVEN** |
| External-period robustness | Y06 route-level n=102, PF about 0.30 at 10bps | acceptable forward evidence | **FAILED** |
| DD goal 20% | 10bps -20.4200%; 20bps -20.9659% | DD within 20% | **FAILED** |

Other current runners observed active: PENGU/Q102/V52/FET/HYPE/IDLE plus Shared Risk and Margin Guard. Runtime includes an IDLE RESIDUAL LONG feature in the IDLE runner, not a separate RESIDUAL service. These active states alone do not certify parity with the historical unified backtest stream.

## Minimal safe closure sequence before Production

1. Keep PENGU SHORT + Reduce-Only stop and V52 TSLA LONG in place. Independently verify V52 Exit ownership and any pending/margin reservations; obtain a fresh authorized venue readback just before any release change.
2. Resolve `V12 pending XRPUSDT` via official idempotency + signed `getOrder`/trades reconciliation; preserve before/after immutable evidence. Do not delete a state record by hand.
3. Address the V52 TSLA quote-staleness incident and `HOLD_PROTECTED` via the **documented operator-controlled safe recovery**. No manual kill-switch flip, arbitrary lock deletion or forced restart.
4. Build and prove an executable live V4 H1 data adapter, exact two-pass candidate/rank/Exit lifecycle, same-symbol ownership, pending/reservation and equity DD policies. Test on historical fixtures and Forward Shadow with real strategy signals. **Do not** attach the current shadow directly to real orders.
5. Normalize the entire live Gross-cap family through the shared portfolio risk engine (V12 3.0, Crypto 3.5, Total 4.75, Recovery family 2.5), with PENGU and V52 existing exposure subtracted at admission. Do not modify caps in isolation.
6. Replay and compare exact currently deployed non-V12 programs against the BT engine (PENGU, Q102, V52, HYPE_LONG, FET, IDLE, RESIDUAL), entry/Exit/gross/fees/funding/event-by-event. Require 10bps as ordinary modeling, 20/30bps stress, out-of-period robustness and quantity filters.
7. Finish operator activation for the **new** SHA, review current account positions and protective orders, then perform reversible release/HP deployment with explicit rollback and no unapproved test trade. Do not claim LIVE until the new runner SHA and actual venue state were rechecked.

Result: **position inventory and PENGU protection certified. The selected 291,326,103 JPY V2 portfolio is not certified equivalent to the currently running VPS and is not safe to promote as-is.**
