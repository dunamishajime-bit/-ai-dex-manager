# Five improvement research — approved scope

User authorized all five proposals on 2026-10-08 JST. Execute research inline in an isolated branch. No renewed scope approval required.

Research comparison, not automatic promotion: (1) audit M05 shadow outcomes, retain observation only until independent evidence; (2) FET earlier exits from current +5%/+3% floor baseline; (3) causal cross-strategy same-side loss governor; (4) Q102 route-specific earlier exits; (5) ex-ante confidence classes and held-out validation. Success means trustworthy downside/return comparison, and reject unsupported changes.

Use current-vps-no-dca-20261007 source-checked candidates, pinned engine and market inputs. Reproduce 10,000 JPY/no deposits/365d/current observed venue constraints baseline: 201,392,633 JPY, PF3.9785, DD -14.5963%, 1362 trades. Old 4.06736bn JPY uses different deposits/sizing and is historical context only.

Keep V12 entry conditions, Q102 HIGH_VOL SHORT0.60x, PENGU Production eligibility unchanged. Governor research requires distinct strategy losses in preceding6/12h, same-side crypto gross>=1.0, and BTC3h reversal against proposed direction>=1% with preceding3h nonadverse; test requested gross multipliers0.60/0.75. No future loss/outcome input.

FET: preserve current floor and entry stream; compare 2%/3% trailing activated after5% MFE, 2% trailing only after7%/8%, and 12h/18h momentum fade at nonpositive3h return with MFE>=2%. H1 trailing uses previous completed-bar high; activate for next bar, open-gap fills, stop-first ambiguity. Only earlier lifecycle exits.

Q102: HIGH_VOL SHORT 3h rebound1%/2% after6h; REV SHORT after2%/4% favorable close return, exit on50% giveback; PB LONG adverse BTC3h1%/2% and nonpositive position return. Evaluate completed bars and fill at next boundary open; only before original exit.

Confidence: classify on completed entry-time price features and known route metadata. First half train/second half validation; publish class counts, Wilson intervals and failures. No automatic size promotion based on a small high-WR subgroup.

All alternatives rerun full portfolio ownership, gross competition, preemption, fees/funding/FX/MTM. Costs10/20/30bps for promising candidates. Frozen eligibility/lifecycle inputs do not reconstruct all newly eligible signal opportunities; do not call this complete LIVE replay or proof of achievable returns. Save sources/results/manifests to branch and push. No deployment without successful baseline reproduction, independent validation and existing exact-SHA operator requirements.

Additional sensitivity: FET3% trail from5%, tighten to2% at7%/8%; Governor previous21h trend versus current3h adverse shock. Both stay research only.
