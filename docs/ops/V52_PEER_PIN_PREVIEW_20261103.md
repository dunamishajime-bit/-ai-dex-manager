# V52 peer identity preview

The V52 release `4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81` compares Q102's
state SHA to `DISDEX_RUNTIME_COMMIT_SHA`, which belongs to V52. The same
planner makes the corresponding assumption for FET and IDLE ownership. On
2026-11-02 14:59:57 UTC the Q102 mismatch caused the shared Kill Switch to
activate. Q102's state SHA and live unit both matched `ef1ab178e26a7bf5bddb6473467765edba242e1d`.

This branch prepares a source-only preview of the existing V52 planner with
the three peer SHA comparisons bound to their respective root-managed runner
pins. It also checks the peer systemd PID, working directory, release marker,
and state SHA; any missing or conflicting evidence fails closed. The original
position, STOP, freshness, gross-cap, and Kill Switch logic is not replaced by
the preview builder. A Q102 state with no position but a pending entry now
blocks V52 accounting instead of being treated as flat; this conservative
change can delay V52 decisions until pending is reconciled. The builder does
not create an immutable release or approve,
start, stop, or change any service.

On 2026-11-02, a read-only VPS probe run as `deploy` passed for the Q102,
FET, and IDLE pins. The probe also passed in a transient systemd unit with
`ProtectSystem=full`, `ProtectHome=read-only`, `PrivateTmp=yes`,
`NoNewPrivileges=yes`, and read-only releases. It did not replace the running
V52 unit or exercise its complete order lifecycle. The live planner and V52
engine files both matched the SHA-256 hashes of their `4d33...` Git blobs.

The existing Q102 release directory and marker were observed to be writable by
`deploy`; SHA and marker agreement alone do not prove an immutable release.
Actual deployment additionally needs trusted release contents, source parity,
systemd sandbox and Linux integration tests, fresh signed venue reconciliation,
pending and risk validation, an authorized deployment plan, and a compatible
rollback. The active Kill Switch and protected holdings must be retained until
the cause is corrected and its separate authorized recovery procedure passes.

To run the local source tests:

```
python -m unittest tests.test_v52_q102_independent_pin tests.test_v52_q102_preview -v
```

The `4d33...` Git object must be available locally. CI fetches it by full SHA.
