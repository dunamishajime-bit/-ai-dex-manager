# PENGU SHORT V20 — Owner-selected research candidate: conditional Gross 0.5 or skip
2026-11-22 JST

## Status
OWNER PREFERENCE FOR NEXT RESEARCH PRIORITY ONLY. **Not an approval for LIVE deployment, Gross changes, STOP modifications, or order actions.**
Pinned original V20 source SHA: `1657e173d250ad58f53e62f7bb0a3428fb405496`. Code/exit selection must retain pinned Native V20 original source and as-of data.

## Candidate state machine, frozen for further research
- Native V20 source entry is the first necessary condition.
- In a non-systemic-bull regime, allow Gross **0.75** as the existing research reference.
- If confirmed systemic bull: Aster/Binance BTC weekly (prior 4 fully closed weeks) and Binance ETH weekly/daily market uptrend from P71, require **both Aster and Binance PENGU relative/weak trend evidence** as defined in P73 `MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT`. If met, allow Gross **0.50**; otherwise **reject entry (Gross 0)**.
- If data are unavailable/uncertain or risk gate fails: reject. **Never use Gross 0.25.**
- Gross 1.0 is not approved; study separately only after independent validation.
- V20 native profit exits and original protective STOP unchanged. Proposed two-stage -5%/-8% stop is a separate unadopted research line.
- Keep existing account Shared Risk/Gross caps; these candidate size tiers are not permissions to bypass them.

## Reproducible source research numbers
ASTER native source 53 natural signals, original one-slot 33, Gross0.75 baseline 18 wins / 33, 30bps max M5 price-mark DD 25.10%, end ¥14,193.07. Candidate conditional Gross0.5-or-skip 18 wins / 30 (60.0%), DD 15.490302%, end ¥15,683.87, +100bps extra cover DD 17.569858%.

Binance USD-M independent Native V20 source 62 natural signals on same calendar, **not identical native entry times or a second Aster market**:
- Full P74 Aug01–Nov14 original 38/21, M5 high DD 29.14295%, end ¥16,237.27; candidate 33/19, DD 18.95153%, end ¥14,574.08 and +100bps extra cover DD 21.572206%.
- Restrict to Aster Native53 first-to-last entry timestamps: original 35/20, DD 29.14295%, end ¥17,769.89; candidate 30/18 (60%), DD 14.734187%, end ¥15,949.71, stressed +100bps DD 16.669811%. Candidate **reduces Binance NAV vs original baseline despite meeting strict DD in narrow calendar**.
- Aster/Binance V20 both fire at exactly same hour for 27 original source signal intents: 15 both win, 12 both lose. Their native outcome correlation is 0.999219; they are not 27 independent Aster+27 independent Binance observations.
- P77 cross-market 19 predeclared no-0.25 policies: **0** simultaneously satisfy baseline NAV retention for each market and +100bps stress M5 price-DD <=20% in both.

## Research adoption gate
Accept as *priority hypothesis*, not deployed trading logic. Do not retune the threshold from the same historical examples. Freeze formal as-of features and validate new truly unseen ASTER market dates with contemporaneous Binance feeds, quote/STOP priority, positive-volume M5 gaps, actual fees/funding, signed fills, source/native parity and 10/30bps plus +100bps stress. Reject production promotion until original winners and realistic return retention, max DD <=20%, and multi-runner account gross controls demonstrate a robust result.

## Artifacts
- `research/prism7/p73-p77/P73_P77_NO025_DUAL_VENUE_FINAL_RESEARCH_DECISION_20261122.md`
- `research/prism7/p73/prism7_p73_no025_dualmarket_score_veto_half_full_20261122.py`
- `research/prism7/p75/prism7_p75_binance_native62_same_calendar_no025_policy_20261122.py`
- `research/prism7/p77/P77_CROSS_VENUE_19_POLICY_STRICT_PROFIT_DD20_GATE_20261122.json`

Production/Runner/Order/STOP/Kill Switch/Gross/master modifications: **NONE**.
