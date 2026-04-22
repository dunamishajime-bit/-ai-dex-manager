# ZEC Sanity Check

## Summaries

### Current RETQ22 engine

- mode: RETQ22
- end_equity: 82553.59
- CAGR: 108.22%
- MaxDD: -45.27%
- WinRate: 51.72%
- PF: 1.69
- Trades: 58

### Expanded engine, ETH/SOL/AVAX only

- mode: RETQ22
- end_equity: 95033.95
- CAGR: 118.66%
- MaxDD: -39.08%
- WinRate: 52.08%
- PF: 1.81
- Trades: 48

### Expanded engine + ZEC

- mode: RETQ22
- end_equity: 171639.35
- CAGR: 168.52%
- MaxDD: -40.92%
- WinRate: 57.89%
- PF: 3.00
- Trades: 57

### Expanded engine + ZEC, max-profit window blocked

- mode: RETQ22
- end_equity: 150227.49
- CAGR: 156.37%
- MaxDD: -40.92%
- WinRate: 56.90%
- PF: 2.63
- Trades: 58

### Expanded engine + ZEC, actual top ZEC trade blocked

- mode: RETQ22
- end_equity: 79271.14
- CAGR: 105.31%
- MaxDD: -40.92%
- WinRate: 55.17%
- PF: 1.73
- Trades: 58

### Expanded engine + ZEC, full Sep-Oct ZEC surge blocked

- mode: RETQ22
- end_equity: 88431.73
- CAGR: 113.26%
- MaxDD: -40.92%
- WinRate: 56.14%
- PF: 1.92
- Trades: 57

## Comparison vs expanded-base

| variant | end_equity | CAGR % | MaxDD % | PF | trades | delta equity | delta CAGR | delta MaxDD | contribution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Expanded engine, ETH/SOL/AVAX only | 95033.95 | 118.66 | -39.08 | 1.81 | 48 | 0.00 | 0.00 | 0.00 | {"ETH":43576.03132395999,"SOL":18286.657463600004,"AVAX":23171.264960000008} |
| Expanded engine + ZEC | 171639.35 | 168.52 | -40.92 | 3.00 | 57 | 76605.39 | 49.86 | -1.84 | {"ETH":27105.786797390017,"ZEC":73649.28994702,"SOL":24768.951983700008,"AVAX":36115.31962399999} |
| Expanded engine + ZEC, max-profit window blocked | 150227.49 | 156.37 | -40.92 | 2.63 | 58 | 55193.54 | 37.71 | -1.84 | {"ETH":27105.786797390017,"ZEC":59856.26234702999,"SOL":17150.12514209999,"AVAX":36115.31962399999} |
| Expanded engine + ZEC, actual top ZEC trade blocked | 79271.14 | 105.31 | -40.92 | 1.73 | 58 | -15762.81 | -13.35 | -1.84 | {"ETH":11393.921796190009,"ZEC":4611.778093619994,"SOL":17150.12514209999,"AVAX":36115.31962399999} |
| Expanded engine + ZEC, full Sep-Oct ZEC surge blocked | 88431.73 | 113.26 | -40.92 | 1.92 | 57 | -6602.23 | -5.40 | -1.84 | {"ETH":11242.399900869996,"ZEC":22159.418646379992,"SOL":8914.587730499998,"AVAX":36115.31962399999} |