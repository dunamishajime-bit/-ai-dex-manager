# Formal five-logic BT handoff evidence — 2026-09-27

## Source and archived inputs
The pinned production source is a09ea45ca3cbd72100f9eb0eaae499039c40b6a0. All 90 audited source files passed exact SHA256 parity. The immutable private input archive stays root-only on VPS at /var/lib/disdex/research-bt-formal/a09-new-data-36276406027.tgz, SHA256 90c0f55bcf72fd8fa8bebf385d51a6d7a5341e2ed2091f8c4d50a0f3383b729f. It includes 32/32 Aster H1 instruments, 32/32 historical funding inputs, 381345 bars, and 410 ECB-derived daily USD/JPY observations. ECB is explicitly not the initially requested FRED DEXJPUS.

## Independently reconstructed causal candidates (not trades)
V12: 1459 selected signal observations. PENGU: 52. Q102: 101, with 4345 incomplete historical-input timestamps out of 8785. FET: 26; the first FET instrument bar in this run was January 2026 and earlier periods are excluded. Total: 1638 selected signal occurrences, not 1638 independent orders or closed trades.

## Formal result and exact blocker
All four formal NORMAL/SEVERE and proxy/ASTER-only historical execution scenarios remain NOT_VERIFIABLE. The formal engine has no historically verified complete entry-and-exit execution ledger and deliberately leaves final equity, PF, return, DD and win rate null. The first four spot-probed public historical Binance Futures, Bybit and Aster L2 archives were update-only without full seeded snapshots and cannot prove same-time fills. The historical Aster account fee tier and executable Aster stock-perpetual pricing and matching V52 reference quotes also remain unverified.

## Supplemental non-authoritative OHLC model
The separate research/formal_five_bt/ohlc_proxy.py is labeled MODELED_RESEARCH_ONLY_NOT_FORMAL_VERIFIED. It uses assumed next-H1-open fills and fixed assumed costs, approximate V12 H1 ATR exits rather than actual live H2 rules, Q102 time exits rather than exact family-specific stops, simplified shared gross allocation, and excludes V52. It must never be compared with the previous canonical integrated BT or used to tune live gates. Tests verify no-lookahead candidate entry, rejection of unsupported future outcome bars, adverse short stops, shared symbol ownership and research-only labeling. Its NORMAL and SEVERE output ledger hashes matched across two completely fresh isolated reruns:
- NORMAL: fa7d5bae4eae98cb17984c38e5ceffbef1ebc8699447e0d2b20582827913d8b8
- SEVERE: c70fab585a9f0a358a18e9cf4c81bf7182ac4711a544c2487ff302fbb6524498

The complete locally reconstructed decision logs, null-result formal runs, monthly modeled NAV and separate supplemental ledger are preserved as a root-owned private VPS archive at /var/lib/disdex/research-bt-formal/a09-private-results-36288219108.tgz, 41,429,104 bytes, SHA256 e86decec5a3ab2e3286d62aacf1ad090ca5fcfd47f9e935c3499cf18c288547d. Source data is preserved independently in the source archive above. No raw provider data were uploaded to public GitHub.

Reproduction and archive verification: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36288219108

## Non-negotiable requirements before calling the BT complete
1. Collect a verified complete historical executable book at each selected signal and protection-exit time: native Aster or exact same-contract proxy, valid seeded snapshot, continuous update sequence, mapping and fee provenance.
2. Reproduce exact production trade lifecycle for V12, PENGU, Q102, FET, stock V52; including protective stop/trail/partial exits, deterministic shared priority, real cash, margin and realized-event DD governor.
3. Obtain actual Aster stock-perpetual quotes/order books and matched historical reference quotes to replay V52. Stock-share Yahoo/Alpaca prices alone are not equivalent to perpetual fills.
4. Finish a five-logic chronological baseline with confirmed verified fills and full trade-ledger reconciliation, monthly JPY results, NORMAL and SEVERE, then and only then compare gate variants.
5. HYPE and ZEC were not approved or active in this a09 production source and cannot be silently injected into the baseline. Freeze any subsequently verified production SHA before adding them.

These are documented evidence limitations, not a claim of zero strategy performance. Production trading code, VPS live runner services, actual positions and current gates were not changed.
