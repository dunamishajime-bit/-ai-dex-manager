# 1H GPT Gate Comparison

| Variant | End Equity | CAGR | MaxDD | Win Rate | PF | Trades | Exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| no_gpt | 7401.30 | -7.24% | -94.29% | 26.29% | 0.94 | 445 | 61.46% |
| gpt_proxy | 5700.10 | -13.10% | -93.76% | 26.92% | 0.85 | 416 | 60.14% |

## Notes

- Entry is evaluated on 1H bars.
- Exit is only allowed at 12H boundaries after a 12H minimum hold, except stop loss.
- `gpt_proxy` is a deterministic local proxy because no OpenAI key is configured in this workspace.