# Idle-Capital / Unused-Gross Research Design

## Status

Completed research-only replay. The recovered exact lineage is accepted after hashing the formal artifact, V12/PENGU ledgers, 90-row causal Q102 payload, 90-row evidence file, and stock cache. No LIVE, VPS, production, or order path is imported or changed.

## Objective

Compare the current formal integrated portfolio with causal, lower-priority, preemptible residual crypto overlays using the same period, costs, capital contributions, shared-risk latches, and unchanged core exits. The comparison must cover FLAT_BOOST, FIXED_0P5_RETURN, REQUIRED_ONLY_PREEMPTION, and residual allocator targets of 1.5x, 2.0x, 2.5x, and 3.0x.

## Authoritative baseline

The baseline contract is the finalCombined section of docs/research-results/v52-final-validated-logic-20260917.json, created by commit c7350e03. The formal contract reference is 5740ec86.

Expected integrated results:

| Scenario | Ending asset JPY | PF | DD | Trades | V52 events |
| --- | ---: | ---: | ---: | ---: | ---: |
| NORMAL | 69,373,656.13931108 | 3.70258068 | -17.59935397% | 1165 | 143 |
| SEVERE | 8,729,157.74295382 | 2.62470185 | -19.24473938% | 1023 | 0 |

Architecture: V12 Top2 1.0x per position / 1.5x aggregate; PENGU 0.85x with a 24-hour hard-stop cooldown; validated Causal V4 Q102 at 1.5x and one slot; V52 final basis 60 / convergence 20 / stop 1.75 / net-edge 7.5; crypto gross 3.0x; stock gross 1.5x; total gross 3.5x; shared crypto daily loss 7.5%; and 5x Cross.

## Lineage gate

The runner must prove all of the following before any scenario is executed:

1. The formal artifact and its period, architecture, and result values match the c7350e03/5740ec86 contract.
2. The V12 and PENGU raw ledgers cover 2025-08-10 through 2026-08-10 and expose causal entry/exit timestamps and returns.
3. The Q102 input is an independently identified validated Causal V4 payload with 90 upstream candidates and integrated base-priority/capacity behavior that can yield 69 fills. A 102-row frozen/recovered historical fixture, manual row deletion, or downstream-only aggregate is invalid.
4. The stock candidate/cache lineage is available for the same period and cost scenarios.
5. A CURRENT run using exactly those inputs reproduces both formal rows and routing counts before any overlay is considered.

If any condition is missing, the runner writes a machine-readable blocked result and a concise report naming the missing artifact, expected identity, observed identity, and why the available substitute cannot be accepted. With the recovered inputs, the gate passes: V12 is 874/871, PENGU is 66/66, and causal Q102 routing is 90 upstream to 69 integrated in both modes.

## Valid execution model

Once the lineage gate passes, the formal integrated artifact remains the authoritative CURRENT equity/PF/DD/trade anchor, while the recovered event ledgers and stock-cache entry timing drive the residual-capacity replay. The overlay is added as a lower-priority candidate stream:

- V12, PENGU, and Q102 core signals retain priority and unchanged exits.
- Overlay entries use only causal eligible signals already present in validated strategy candidate inputs; no lookahead or synthetic positive return is allowed.
- Overlay positions are preemptible. REQUIRED_ONLY_PREEMPTION trims only the exact gross required for a later core signal.
- RESERVE_0P5_REQUIRED_ONLY preserves 0.5x crypto capacity for later core signals and allocates only excess residual capacity.
- Shared crypto daily-loss latches apply to overlay PnL exactly as to core crypto PnL.
- Gross conflict, entry ordering, and core-fill parity are measured rather than inferred.

## Evidence outputs

Valid JSON reports every requested case/scenario with ending asset, PF, DD, executions/trades, average or time-weighted crypto gross, unused gross-hours, utilization, preemption trim count/gross, shared-loss latches, core-fill parity, and gross conflicts. It stores input hashes, formal parity, scenario configuration, and safety flags. The formal CURRENT row is preserved exactly; higher-target overlay rows scale only the recovered realized candidate net returns by causal allocated gross and do not invent price paths.

A blocked report states NO_VALID_SCENARIO and contains no uplift estimate.

## Safety boundary

All outputs are research artifacts. The implementation must not import or invoke LIVE/VPS order executors, write production configuration, or send orders. It records ordersSent=false, liveChanged=false, vpsChanged=false, and productionChanged=false.
