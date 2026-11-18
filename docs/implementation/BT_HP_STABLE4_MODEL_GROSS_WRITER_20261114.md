# PR #481 — Research source-model Gross recorder (2026-11-14)

Scope: BT research only. Does not authorize Production deployment, LIVE orders or runner controls.

## Source and observer

Archived PC wrapper: C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113\portfolio_stable4_prod_caps_20261114.py
Source wrapper SHA256: 08be27e5c6064e2ff9ada7674697e7c168bdb341e604251ce266fdc3e3ff74ea
Instrumenter: scripts/bt_hp_instrument_research_engine.py

The observer injects into the generated research simulator at the exact equity sampling phase and at terminal END, with separate MODEL_ENTRIES.csv and POSITION_GROSS_SNAPSHOTS.csv.
The original source files are not overwritten. This is source-generated evidence rather than an inference from completed-only fills.

The archived simulator uses JPY model stake, not actual exchange quantity. The observer records model-native current JPY notional, mark, per-holding Gross x and equity, but does not manufacture quantity, contract multiplier or FX.
V52 uses the same v52_mark5 source oracle as the engine; all other positions use the same completed-H1 source mark as the engine.
Each sample recomputes Total/Crypto/Stock Gross from model holdings, enforcing 1e-8 tolerance against the authoritative portfolio Gross.
Flat snapshots have an explicit UTC sentinel. The model entry ledger includes entries without completed model fills.

## Running safely

Set DISDEX_Q102_ADOPTED_MODE=ON and DISDEX_PRETARGET_STABLE_CASE=STABLE3 in a research-only terminal.
Run python scripts/bt_hp_instrument_research_engine.py --wrapper PATH_TO_ARCHIVED_STABLE4_WRAPPER --verify-only
Then run without --verify-only to generate isolated output at STABLE4_OPPORTUNITY_PROD_CAPS_20261114_GROSS_CAPTURE_V1.

The HP adapter only accepts paired model admissions and Gross timepoint CSVs; verifies every original equity observation; reconciles source open count, model entry/exit identities, category Gross and equity.
Same-timestamp preemption can occur after the source equity sample; the adapter permits only timepoint-supported pre/post-close phases.
The evidence tier is SOURCE_MODEL_GROSS_ONLY_NO_QUANTITY_FX. It is deliberately separate from the stricter source position/quantity/FX contract.

## Verified research results

105121 equity timepoints per cost case; 10bps position observations 330319; 30bps position observations 328466.
Original versus instrumented equity, fills, decisions, Funding and PENGU partial CSV files: byte-identical SHA256 for both cases.
10bps: 1027 modeled closes, JPY 12442421.06 final modeled equity, maximum DD -22.60%, win rate 63.19%, PF 2.052.
30bps: 1023 modeled closes, JPY 4660537.64 final modeled equity, maximum DD -23.22%, win rate 60.41%, PF 1.853.
Private replay directory: C:\tmp\bt481-hp-replay-library-model-gross-v4-20261114

The HP replay can now display measured model per-holding Gross and mark as it advances, with quantity explicitly unknown.
Historical source research remains unverified against exact current LIVE pins, signed venue fills and real quantity/FX.
Never commit private research CSV or replay JSON to GitHub or public preview. Formal HP deployment remains separate owner-authorized work.

## Verified source category hardening

The portfolio replay now preserves source category=crypto|stock for each
model position instead of deducing classification from the ticker. The
browser rejects category-forged or unlabeled SOURCE_MODEL_LEDGER_MATCHED
frames when their per-position Gross does not equal source category/total
Gross. Legacy DEMO remains explicitly labeled and is not reclassified as
source evidence.

2026-11-14 private-library regeneration (not uploaded to Production):
- 10bps: 8,978 frames, 27,394 positions with source category/Gross,
  SHA256 bdccc0d9bcbfaddb8ff6e7a0babafbadb78c7320c41a7e80aa1f6d682c25d160.
- 30bps: 8,975 frames, 27,211 positions with source category/Gross,
  SHA256 35a9925c84994dfd0aa832ae9174749a8d6ac539f623b03fe92f309133e03142.
- No missing category and no category/Total Gross inconsistency; venue
  quantity remains explicitly unknown.

Production readiness (read-only SSH audit, 2026-11-14): Xserver VPS root
is accessible using an owner-managed key. Root filesystem 48 GB total,
46 GB used, about 1.4 GB free (98% utilization). The HP private model
replay files were **not** uploaded; do not merge or deploy until storage,
owner authentication, server private-path isolation and LIVE-pin parity
are verified. No LIVE services, orders, STOP or runtime configuration
were changed.
