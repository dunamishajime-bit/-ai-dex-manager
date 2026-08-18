# V12 next execution window note

For the frozen V52 readiness code, US regular-session reference freshness is required on weekdays from 09:30 through 16:00 America/New_York. The next production activation attempt should be started only after that code-defined regular-session boundary when practical, so the migration does not depend on a transient 5-second IEX/Pyth freshness window. This does not disable reference connectivity checks and does not relax any risk, position, reconciliation, or Kill Switch gate.
