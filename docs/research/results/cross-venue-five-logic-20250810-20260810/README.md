# Cross-venue five-logic robustness dataset

Period: 2025-08-10 through 2026-08-10 inclusive.

Crypto market inputs are acquired independently from Binance Futures and OKX swaps.
Each venue is replayed separately through the same audited V12/PENGU/Q102/FET logic.
Q102 BRK=0.75x, MR=0.75x, FET cap=1.0x and the two fixed pre-entry FET gates are
compared against cap-only and the unmodified baseline at 8bps and 10bps.

The normalized venue H1/funding archives are split into <=45MB parts for durable Git
storage. Reassemble in lexical part order, verify against *-normalized-parts.sha256,
then extract the tar.gz to reuse without reacquiring market data.

V52 is held as the same stock-reference component and is not replaced by Binance/OKX,
because those crypto venues do not provide the Yahoo equity reference universe.
This is a crypto-market robustness test with V52 methodology held fixed.
