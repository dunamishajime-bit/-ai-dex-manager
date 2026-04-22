# ZEC + DASH Outlier-Excluded Backtest

## Baseline

- mode: RETQ22
- end_equity: 82553.59
- CAGR: 108.22%
- MaxDD: -45.27%
- WinRate: 51.72%
- PF: 1.69
- Trades: 58

## Blocked windows

- ZEC: 2025-09-22T12:00:00.000Z -> 2025-10-03T00:00:00.000Z
- DASH: 2025-10-11T00:00:00.000Z -> 2025-11-05T00:00:00.000Z

## Comparison

| variant | end_equity | CAGR % | MaxDD % | WinRate % | PF | trades | delta equity | delta CAGR | delta MaxDD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ZEC + DASH, max-profit windows blocked | 71267.36 | 97.85 | -56.23 | 52.46 | 1.91 | 61 | -11286.23 | -10.37 | -10.96 |
| ZEC + DASH, raw reference | 82886.83 | 108.51 | -56.23 | 53.33 | 2.13 | 60 | 333.24 | 0.29 | -10.96 |

## Details

### ZEC + DASH, max-profit windows blocked

- mode: RETQ22
- end_equity: 71267.36
- CAGR: 97.85%
- MaxDD: -56.23%
- WinRate: 52.46%
- PF: 1.91
- Trades: 61

- contribution: {"DASH":-7611.472467929996,"ETH":13767.58578345,"ZEC":29699.346777639985,"SOL":-363.2929187999898,"AVAX":25775.192933699997}

### ZEC + DASH, raw reference

- mode: RETQ22
- end_equity: 82886.83
- CAGR: 108.51%
- MaxDD: -56.23%
- WinRate: 53.33%
- PF: 2.13
- Trades: 60

- contribution: {"DASH":-3052.5151382899985,"ETH":13767.58578345,"ZEC":36759.856280249995,"SOL":-363.2929187999898,"AVAX":25775.192933699997}
