# THREE gate causal validation audit — 2026-11-11

## Conclusion

- IDLE rel24 alone is not causally robust in the saved train/validation/forward screen.
- The single robust IDLE JUP rule is volumeRatio >= 1.2568362211142174 AND rel24 >= -0.04089204262472046.
- PENGU V8 btc24h <= 0.011611625094354983 is a saved robust standalone rule.
- Q102 FET ret14 <= 0.048722800378429465 is the saved coarse robust rule.

## Evidence

IDLE JUP robust rule: Train30 n=8 WR=75% PF=1.8095; Valid30 n=6 WR=66.67% PF=1.6331; Forward30 n=7 WR=71.43% PF=3.9986.

PENGU V8: Train30 n=19 WR=73.68% PF=3.0494; Valid30 n=16 WR=68.75% PF=1.7909; Forward30 n=4 WR=75% PF=1.7121.

Q102 FET: Train30 n=15 WR=66.67% PF=1.3613; Valid30 n=16 WR=56.25% PF=1.0822; Forward30 n=14 WR=57.14% PF=1.6001.

## Source SHA256

- idle_jup_train_validation_forward_gate_search_20261110.json: EC707585237E28933B7237991E02B586FEEB586F51F49FC7CDC90539E4AD17BE
- pengu_v8_train_validation_forward_gate_search_20261110.json: 4EDB564D13F89B5C93B0C377635F561794F24B29DAD22875955CD22738F4D911
- q102_fet_coarse_train_valid_forward_screen_20261110.json: 3653D9BA366C5A0D102FAE93E80E30C7F9BF511D014BC6D23FF5D4C967A3B88D

## Next test

Use a separate causal harness so the locked 7-case A/B evidence remains untouched.

1. IDLE_JUP_ROBUST: block JUP when rel24 fails OR volumeRatio fails.
2. CAUSAL_THREE: robust IDLE two-feature rule + existing PENGU V8 + Q102 FET rules.

Target-period A/B remains research-only; this audit only improves the causal basis of the frozen rules.
