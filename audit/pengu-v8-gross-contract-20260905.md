# PENGU V8 Gross contract audit - 2026-09-05

Historical source: GitHub Actions run `33110139791`, artifact `pengu-v8-ledger.json`.

Normal 70-trade requested Gross distribution:
- `0.50x`: 35 trades (Recovery V8)
- `0.75x`: 23 trades
- `0.9375x`: 11 trades
- `0.1875x`: 1 trade

Historical maximum requested Gross:
- Long: `0.9375x`
- Short: `0.75x`

The same historical integrated `result.json` declares `penguGrossCap=0.75` and reports `entryTimeMaxPenguGross=0.75`; all Gross checks are true.
Therefore the causal contract is `requestedGross=0.9375` for eligible V64 Long signals, followed by strict portfolio allocation capped at `0.75`.