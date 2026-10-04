# V56 Production parity evidence — 2026-08-25

## Evidence boundary

The frozen research source is `a9ec3a257de3034972a6e130edfd8fcb6b2b570f`.
The research replay is Run `32814696622`, Job `97700540133`, Artifact
`9550992596`. Its preferred aggregate case is PENGU Long `1.25x` / Short
`1.00x`, with 254 full events, Return `+751.07413135%`, PF `3.50601577`,
MaxDD `-12.84885779%`, and maximum Gross values of 2.5 / 1.5 / 1.5.

The artifact contains aggregate case summaries and the boundary table, not the
underlying per-event timestamps, symbols, directions, entry/exit reasons, or
requested/allocated Gross ledger. Therefore this release does not claim exact
event-timestamp parity from that artifact.

## Contract parity proven in Production

The offline Production parity self-test proves the frozen implementation
contract directly:

- PENGU signal/exit predicates remain unchanged; only side sizing is applied.
  Long maximum requested Gross is `0.75 x 1.25 = 0.9375`; Short is `0.75 x 1.00 = 0.75`.
- V50 Rank1 is `1.00x` at `65bps/5bps` and `1.25x` at `100bps/15bps`.
- V50 Rank2 is `0.25x` only at `85bps/10bps` or better; below is rejected.
- V50 maximum hold is `4h`; basis stop is `1.75x`; adverse basis limit is `10bps`;
  partial convergence remains disabled.
- V11 sizing is `0.75x / 1.00x / 1.25x / 1.50x` at the frozen tiers.
- Hard caps remain Global `2.5x`, Stock `1.5x`, Crypto `1.5x`, V50 concurrent `2`,
  and V50 daily entries `3`.
- AccountOrderLock/durable reservation, bounded transient retry, Kill Switch,
  Fail Closed, Margin Guard, and reconciliation paths remain in the runner.

The CI self-tests are offline-only and report test orders, cancels, and settles
as zero. No LIVE/VPS/production mutation is performed by parity CI.
