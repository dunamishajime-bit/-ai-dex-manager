# STABILITY_CONSENSUS_ROTATION_V2 Summary

Status: `NO_ROBUST_IMPROVEMENT`

- Stable Development candidates: 4
- Validation evaluated / passed: 1 / 0
- Frozen Holdout: not evaluated
- Paper candidate: none
- Live candidate: none
- Production code, VPS, `.env`, live runner: unchanged
- Real trading: disabled

The only Validation candidate produced 10 trades, 20% win rate, average +0.37%, median -0.97%, PF 1.34, Stress PF 1.17, and 23% average-return retention. Its first Validation half averaged +2.04%, while the second averaged -0.49%.

The result depended on one +12.23% winner, approximately 84.5% of gross winning profit. Removing that trade implies approximately -0.95% average and PF 0.21. Capping it at +5% implies approximately -0.35% average and PF 0.67. It is therefore rejected without opening Frozen Holdout.
