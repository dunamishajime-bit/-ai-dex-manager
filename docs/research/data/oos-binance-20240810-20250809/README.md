# Immutable, reusable Binance USD-M prior-year source data
Research period: 2024-08-10 UTC through 2025-08-09 UTC inclusive.
Warmup: 2024-01-01 UTC. Original official monthly ZIP responses,
normalized H1 and funding, and SHA256 manifests are preserved separately.
This data was not downloaded from or filled by Aster. Missing historical
listings/gaps are recorded; do not synthesize candles.
Reassemble: cat normalized-binance-h1-funding.tar.gz.part-* > normalized.tar.gz
Verify: sha256sum -c normalized-parts.sha256
Extract: tar -xzf normalized.tar.gz -C YOUR_DATA_ROOT
Repeat for raw-original-binance-archives.tar.gz.part-* to inspect original ZIPs.
The run never modifies LIVE runners or production configuration.
