# V96 + V52 implementation status

- Runtime code: implemented.
- V11-EQ slot: implemented with legacy-state migration.
- V50 slot: implemented for frozen `POST_EARLY3__B75__H3__BOTH__NONE`.
- Entry windows: 11:30, 12:30, 13:30 New York.
- V50 exit checks: hourly, maximum three hours, fail-closed if a checkpoint is missed after restart.
- Gross allocator: Crypto 1.0, Stock 1.5, V11 1.0, V50 1.0, Portfolio 2.5.
- Same-symbol overlap: blocked.
- Pending order state: persisted; unresolved startup state fails closed for operator review.
- Shared Kill Switch and combined daily loss: retained.
- V96 migration and activation marker: retained.
- Pyth/IEX reference validation: retained.
- Hyperliquid and V13D: excluded.
- Default environment: Paper and order submission disabled.
- VPS connection/deployment: not performed by this GitHub change.
