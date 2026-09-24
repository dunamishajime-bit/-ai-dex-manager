# Canonical integrated BT status — 2026-09-24

## Result

`STATUS: BLOCKED_MISSING_CANONICAL_SOURCE`

No formal integrated comparison is reported from this branch. The checked-in
headline values are treated as reference-only until the original event ledger,
allocator, and input hashes are available.

## Evidence checked

- Handoff branch: `codex/canonical-integrated-bt-engine-20260924`
- Handoff commit: `8b639e7d215f7dcb569a13fb2d7a1840f1c2d539`
- Production anchor branch: `codex/top3-fet-q102gov-live-20260920`
- Production anchor commit: `d02de5c9bfc759376162c8c81a8770d0beb6f62c`
- PENGU research branch: `research/pengu-flat1-dd-reduction-20260924`
- PENGU research commit: `0a5b8e99de44752f4bee6f3c452a98cbec2d6a37`
- Historical integrated capture branch: `research/pengu-gross1-full-integrated-20260924`
- Historical integrated capture commit: `82bcc2f1428c72d9dc19d8ff5ebb0185f56fb916`

The checked-in `top3-fet-q102gov-integrated-20260920.json` contains the
published summary matching the requested headline values, but it does not
contain the causal event ledgers or the original allocator inputs required to
replay them.

The GitHub Actions runs examined for the Top3/FET/Q102 anchor were rejected
before job creation (`jobs=0`), so they are not formal successful run
artifacts. The current canonical-engine run is a green provenance-gate run,
not a formal BT; its explicit result is `BLOCKED_MISSING_CANONICAL_SOURCE`.

## Missing replay inputs

The generated historical engine references the following external inputs, but
the exact paths are not present in the current workspace or fetched GitHub
trees:

- original allocator / canonical source engine under the historical
  `performance-restoration-20260905` research state;
- current PENGU causal ledger (`pengu-hard-cd24.json`);
- Q102 one-slot causal input (`candidate-1slot.csv`);
- the exact stock cache used by the anchor;
- the complete V12/FET/Q102/V52/global event ledgers and their SHA256 manifest.

The exact V12 summary ledger available in a local research cache is not enough
to certify the portfolio result: it does not supply the other sleeves, the
original event ordering, or the shared allocator state. Summary JSON and a
generated result JSON are therefore rejected by the new source-bundle gate.

## Safety behavior

The branch now has an executable `discover-source` gate. It accepts a source
bundle only when every declared ledger/input is a non-empty regular file with
the declared SHA256, and when all six event ledgers are explicitly declared.
Missing files, hash mismatches, and summary-only bundles return
`BLOCKED_MISSING_CANONICAL_SOURCE` and never produce formal results.

No Production, LIVE, VPS, Aster, or order state was changed.
