# V71/V35 V95 fixed-run audit

This file marks the start of a reproducibility run on an isolated branch.

The V95 workflow must:

- build all V35 Core variants from one immutable checkout and one data snapshot;
- verify that repeated calls to the same V90 Growth configuration produce identical equity metrics;
- compare V71 baseline, V85 Balanced/Defensive, V94 Growth and V94 Resilient under the same dependency versions;
- rank large-wave-excluded normal and Severe results before full-period return;
- preserve V67 target Gross 1.15 and total observed Gross <=2.0;
- report 2026H1, best-trade removal, best-month removal and cap diagnostics;
- make no Production, LIVE, VPS or order changes.
